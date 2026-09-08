-- ============================================================
-- HelixCar — 06 : informations manquantes (préparation sans Stripe)
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- STRIPE N'EXISTE PAS ENCORE. Ce modèle est volontairement INDÉPENDANT
-- du paiement : aucune colonne « payé », aucun statut de paiement,
-- aucune création automatique de mission. L'enchaînement
-- paiement -> complément -> mission reste DORMANT et devra être activé
-- dans un lot ultérieur, uniquement sur confirmation serveur fiable
-- (webhook Stripe signé) — jamais sur un état modifiable dans le
-- navigateur.

-- ------------------------------------------------------------
-- PRÉALABLE : lien entre une demande et le compte de son auteur.
-- Ce lien N'EXISTAIT PAS (public.clients ne portait aucun
-- auth_user_id) ; sans lui, aucune politique « le client voit ce qui
-- le concerne » n'est possible. Colonne ajoutée ici, nullable :
-- aucune demande déjà enregistrée n'est modifiée ni invalidée.
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists auth_user_id uuid references auth.users(id);

create index if not exists clients_auth_user_id_idx
  on public.clients (auth_user_id);

comment on column public.clients.auth_user_id is
  'Compte Supabase Auth du demandeur. NULL pour les demandes créées '
  'avant ce lien, et pour toute demande déposée sans compte.';

-- RATTACHEMENT DE L''HISTORIQUE — VOLONTAIREMENT NON EXÉCUTÉ.
-- Un rapprochement automatique par e-mail rattacherait des demandes à
-- un compte sur la seule foi d''une adresse : en cas d''homonymie ou
-- d''adresse réutilisée, cela exposerait la demande d''un tiers.
-- À décider explicitement par HelixCar, après vérification :
--
--   update public.clients c
--      set auth_user_id = u.id
--     from auth.users u
--    where c.auth_user_id is null
--      and lower(c.email) = lower(u.email);

-- ------------------------------------------------------------
-- est_proprietaire_demande(uuid) — le compte en cours est-il l'auteur
-- de cette demande ?
-- ------------------------------------------------------------
-- SECURITY DEFINER INDISPENSABLE. Les politiques ci-dessous doivent
-- interroger public.clients, mais le durcissement de la phase C
-- (91_durcissement_rls_clients.sql) n'accorde AUCUNE politique de
-- lecture au client sur cette table — il lit la vue v_mes_demandes.
-- Une politique qui interrogerait directement `clients` ne verrait donc
-- jamais aucune ligne : elle ne matcherait JAMAIS, sans erreur, et le
-- client perdrait l'accès à ses propres rubriques. Ce helper contourne
-- ce piège, exactement comme est_proprietaire_convoyeur() le fait déjà
-- pour les candidatures.
create or replace function public.est_proprietaire_demande(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.clients c
     where c.id = p_client_id
       and c.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.est_proprietaire_demande(uuid) from public;
grant execute on function public.est_proprietaire_demande(uuid) to authenticated;

create table if not exists public.demande_informations_manquantes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  cle           text not null,          -- identifiant technique stable
  libelle       text not null,          -- intitulé présenté au client
  statut        text not null default 'attendue'
                  check (statut in ('attendue', 'transmise', 'validee', 'a_corriger')),
  valeur        text,                   -- réponse réellement fournie
  commentaire   text,                   -- demande de correction éventuelle
  transmise_le  timestamptz,
  validee_le    timestamptz,
  validee_par   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, cle)
);

comment on table public.demande_informations_manquantes is
  'Éléments restant à compléter pour une demande. Aucun lien avec un '
  'paiement : Stripe n''est pas installé et aucune activation ne dépend '
  'de cette table.';

create index if not exists dim_client_idx
  on public.demande_informations_manquantes (client_id, statut);

-- Horodatage automatique des transitions réellement effectuées.
create or replace function public.tracer_information_manquante()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    if new.statut = 'transmise' then new.transmise_le := now(); end if;
    if new.statut = 'validee' then
      new.validee_le  := now();
      new.validee_par := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tracer_information_manquante on public.demande_informations_manquantes;
create trigger trg_tracer_information_manquante
  before insert or update on public.demande_informations_manquantes
  for each row execute function public.tracer_information_manquante();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.demande_informations_manquantes enable row level security;

-- Le client concerné voit ce qui lui est demandé, et peut y répondre.
-- Le lien passe par clients.auth_user_id (compte du demandeur).
drop policy if exists "infos manquantes : lecture client" on public.demande_informations_manquantes;
create policy "infos manquantes : lecture client"
  on public.demande_informations_manquantes for select to authenticated
  using (public.est_proprietaire_demande(client_id));

-- Le client renseigne sa réponse et passe l'élément en « transmise ».
-- Il ne peut jamais le valider lui-même : la validation est réservée à
-- l'administrateur (contrôlée par le trigger ci-dessous).
drop policy if exists "infos manquantes : reponse client" on public.demande_informations_manquantes;
create policy "infos manquantes : reponse client"
  on public.demande_informations_manquantes for update to authenticated
  using (public.est_proprietaire_demande(client_id))
  with check (
    public.est_proprietaire_demande(client_id)
    and statut in ('attendue', 'transmise')
  );

drop policy if exists "infos manquantes : lecture admin" on public.demande_informations_manquantes;
create policy "infos manquantes : lecture admin"
  on public.demande_informations_manquantes for select to authenticated
  using (public.est_admin());

drop policy if exists "infos manquantes : ecriture admin" on public.demande_informations_manquantes;
create policy "infos manquantes : ecriture admin"
  on public.demande_informations_manquantes for insert to authenticated
  with check (public.est_admin());

drop policy if exists "infos manquantes : modification admin" on public.demande_informations_manquantes;
create policy "infos manquantes : modification admin"
  on public.demande_informations_manquantes for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "infos manquantes : suppression admin" on public.demande_informations_manquantes;
create policy "infos manquantes : suppression admin"
  on public.demande_informations_manquantes for delete to authenticated
  using (public.est_admin());

-- Garde-fou : seul un administrateur valide ou demande une correction.
create or replace function public.garde_validation_information_manquante()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.est_admin() then
    return new;
  end if;
  if new.statut in ('validee', 'a_corriger') and new.statut is distinct from old.statut then
    raise exception 'La validation est réservée à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.libelle is distinct from old.libelle or new.cle is distinct from old.cle then
    raise exception 'Élément demandé non modifiable par le client.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_garde_validation_information_manquante on public.demande_informations_manquantes;
create trigger trg_garde_validation_information_manquante
  before update on public.demande_informations_manquantes
  for each row execute function public.garde_validation_information_manquante();

-- ------------------------------------------------------------
-- Progression, pour l'onglet « Informations à compléter ».
-- ------------------------------------------------------------
create or replace view public.v_informations_manquantes_progression as
select
  client_id,
  count(*)                                             as total,
  count(*) filter (where statut = 'validee')           as validees,
  count(*) filter (where statut = 'transmise')         as transmises,
  count(*) filter (where statut in ('attendue', 'a_corriger')) as restantes
from public.demande_informations_manquantes
group by client_id;

alter view public.v_informations_manquantes_progression set (security_invoker = on);

-- ------------------------------------------------------------
-- NON FAIT VOLONTAIREMENT (à traiter dans un lot ultérieur) :
--   * aucune colonne ni table de paiement ;
--   * aucun webhook, réel ou simulé ;
--   * aucune création automatique de mission ;
--   * aucun statut « payé » atteignable depuis le navigateur.
-- ------------------------------------------------------------

-- ============================================================
-- COMPLÉMENT — CALCUL SERVEUR DES INFORMATIONS REQUISES
-- ============================================================
-- Ajouté avec le chantier « espace client ». Toujours PHASE A :
-- purement additif, aucune RLS activée sur une table existante.

-- ------------------------------------------------------------
-- Privilèges de table
-- ------------------------------------------------------------
-- Comme pour 04 : posés explicitement. Sans eux PostgREST répondrait
-- « permission denied » AVANT que la RLS ne s'applique.
grant select, update on public.demande_informations_manquantes to authenticated;

-- ------------------------------------------------------------
-- Quelles informations sont requises, pour CETTE demande ?
-- ------------------------------------------------------------
-- Calculé côté serveur à partir des données réellement enregistrées,
-- jamais depuis le navigateur. Le statut est dérivé :
--   * une donnée déjà présente dans la demande  -> 'fournie'
--     (information NON DEMANDÉE : on ne la redemande jamais) ;
--   * une réponse du client                      -> 'transmise' ;
--   * une décision de l'administrateur           -> 'validee' / 'a_corriger' ;
--   * sinon                                       -> 'attendue' (manquante).
create or replace function public.informations_demande(p_client_id uuid)
returns table (
  cle          text,
  libelle      text,
  statut       text,
  valeur       text,
  commentaire  text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  d public.clients%rowtype;
  requis jsonb := '[]'::jsonb;
begin
  select * into d from public.clients c where c.id = p_client_id;
  if not found then
    return;
  end if;

  -- Le service détermine les rubriques. Une rubrique dont la donnée est
  -- déjà enregistrée est marquée « fournie » : elle compte dans la
  -- progression mais n'est jamais redemandée.
  if d.type_service = 'convoyage' then
    requis := jsonb_build_array(
      jsonb_build_object('cle','immatriculation','libelle','Immatriculation du véhicule',
                         'fournie', d.immatriculation is not null and d.immatriculation <> ''),
      jsonb_build_object('cle','marque_modele','libelle','Marque et modèle',
                         'fournie', d.marque_modele is not null and d.marque_modele <> ''),
      jsonb_build_object('cle','date_prise_en_charge','libelle','Date de prise en charge',
                         'fournie', d.date_prise_en_charge is not null),
      jsonb_build_object('cle','contact_pc_nom','libelle','Nom du contact sur place au départ',
                         'fournie', d.contact_pc_nom is not null and d.contact_pc_nom <> ''),
      jsonb_build_object('cle','contact_pc_tel','libelle','Téléphone du contact sur place au départ',
                         'fournie', d.contact_pc_tel is not null and d.contact_pc_tel <> ''),
      jsonb_build_object('cle','adresse_arrivee_rue','libelle','Adresse de livraison',
                         'fournie', d.adresse_arrivee_rue is not null and d.adresse_arrivee_rue <> '')
    );
  elsif d.type_service = 'stockage' then
    requis := jsonb_build_array(
      jsonb_build_object('cle','stockage_ville','libelle','Ville de stockage',
                         'fournie', d.stockage_ville is not null and d.stockage_ville <> ''),
      jsonb_build_object('cle','stockage_date_debut','libelle','Date de début de stockage',
                         'fournie', d.stockage_date_debut is not null),
      jsonb_build_object('cle','immatriculation','libelle','Immatriculation du véhicule',
                         'fournie', d.immatriculation is not null and d.immatriculation <> '')
    );
  elsif d.type_service = 'nettoyage' then
    requis := jsonb_build_array(
      jsonb_build_object('cle','nettoyage_details','libelle','Détail de la prestation de nettoyage',
                         'fournie', d.nettoyage_details is not null),
      jsonb_build_object('cle','contact_pc_nom','libelle','Nom du contact sur place',
                         'fournie', d.contact_pc_nom is not null and d.contact_pc_nom <> ''),
      jsonb_build_object('cle','contact_pc_tel','libelle','Téléphone du contact sur place',
                         'fournie', d.contact_pc_tel is not null and d.contact_pc_tel <> '')
    );
  elsif d.type_service = 'professionnel' then
    requis := jsonb_build_array(
      jsonb_build_object('cle','professionnel_details','libelle','Détail de la recherche de professionnel',
                         'fournie', d.professionnel_details is not null),
      jsonb_build_object('cle','contact_pc_nom','libelle','Nom du contact sur place',
                         'fournie', d.contact_pc_nom is not null and d.contact_pc_nom <> ''),
      jsonb_build_object('cle','contact_pc_tel','libelle','Téléphone du contact sur place',
                         'fournie', d.contact_pc_tel is not null and d.contact_pc_tel <> '')
    );
  else
    -- Création de compte, ou service non renseigné : rien n'est requis.
    return;
  end if;

  return query
  select
    (r ->> 'cle')::text,
    (r ->> 'libelle')::text,
    coalesce(
      i.statut,
      case when (r ->> 'fournie')::boolean then 'fournie' else 'attendue' end
    )::text,
    i.valeur,
    i.commentaire
  from jsonb_array_elements(requis) as r
  left join public.demande_informations_manquantes i
    on i.client_id = p_client_id
   and i.cle = (r ->> 'cle');
end $$;

revoke all on function public.informations_demande(uuid) from public;
grant execute on function public.informations_demande(uuid) to authenticated;

comment on function public.informations_demande(uuid) is
  'Rubriques requises pour une demande, avec leur statut dérivé. '
  'Calculé côté serveur à partir des données réellement enregistrées.';

-- ------------------------------------------------------------
-- Réponse du client — SEUL chemin d'écriture qui lui est ouvert
-- ------------------------------------------------------------
-- Passer par une fonction plutôt que par une écriture directe permet
-- de garantir, côté serveur :
--   * que l'appelant est bien le propriétaire de la demande ;
--   * qu'une rubrique NON REQUISE ne peut pas être créée ;
--   * qu'une rubrique déjà VALIDÉE n'est pas écrasée ;
--   * que les rubriques devenues obsolètes (conditions du formulaire
--     modifiées) sont RÉELLEMENT supprimées, sans valeur résiduelle.
create or replace function public.repondre_informations_demande(
  p_client_id uuid,
  p_reponses  jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer := 0;
  k text;
  v text;
begin
  if not public.est_proprietaire_demande(p_client_id) then
    raise exception 'Demande introuvable ou non autorisée.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Purge des rubriques devenues obsolètes : plus aucune valeur cachée
  -- ne subsiste si le service ou les conditions ont changé.
  delete from public.demande_informations_manquantes i
   where i.client_id = p_client_id
     and i.cle not in (select r.cle from public.informations_demande(p_client_id) r);

  for k, v in select key, value #>> '{}' from jsonb_each(coalesce(p_reponses, '{}'::jsonb))
  loop
    -- Rubrique non requise pour ce service : ignorée en silence.
    if not exists (select 1 from public.informations_demande(p_client_id) r where r.cle = k) then
      continue;
    end if;
    -- Rubrique déjà validée : conservée telle quelle.
    if exists (
      select 1 from public.demande_informations_manquantes i
       where i.client_id = p_client_id and i.cle = k and i.statut = 'validee'
    ) then
      continue;
    end if;
    if v is null or btrim(v) = '' then
      continue;
    end if;

    insert into public.demande_informations_manquantes
      (client_id, cle, libelle, statut, valeur, commentaire)
    select p_client_id, k,
           (select r.libelle from public.informations_demande(p_client_id) r where r.cle = k),
           'transmise', v, null
    on conflict (client_id, cle) do update
      set statut      = 'transmise',
          valeur      = excluded.valeur,
          commentaire = null;
    n := n + 1;
  end loop;

  return n;
end $$;

revoke all on function public.repondre_informations_demande(uuid, jsonb) from public;
grant execute on function public.repondre_informations_demande(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- Vue « mes demandes » — projection SANS donnée interne
-- ------------------------------------------------------------
-- Le client lit UNIQUEMENT cette vue, jamais public.clients : une
-- politique RLS filtre les LIGNES mais pas les COLONNES, et exposerait
-- donc tout le contenu administratif de la demande. La vue filtre
-- elle-même sur auth.uid() : un autre client n'y voit rien.
create or replace view public.v_mes_demandes as
select
  c.id,
  c.numero_client,
  c.type_service,
  c.statut,
  c.prenom,
  c.nom,
  c.email,
  c.telephone,
  -- Profil réutilisé pour une nouvelle demande : ces trois champs
  -- évitent de redemander au client ce qu'il a déjà déclaré.
  c.type_client,
  c.societe,
  c.siret,
  c.source_acquisition,
  c.source_acquisition_detail,
  c.nb_vehicules,
  c.ville_depart,
  c.ville_arrivee,
  c.date_prise_en_charge,
  c.stockage_ville,
  c.stockage_date_debut,
  c.created_at
from public.clients c
where c.auth_user_id = auth.uid();

grant select on public.v_mes_demandes to authenticated;

comment on view public.v_mes_demandes is
  'Demandes du client connecté, colonnes destinées au client uniquement. '
  'Aucune donnée interne, administrative ou de rémunération partenaire.';
