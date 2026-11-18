-- ============================================================
-- HelixCar — 108 : opportunités de missions privées, candidatures
--                  des partenaires, attribution N sur N
-- ============================================================
-- Dépend de : 00_helpers.sql (est_admin), 04_decisions_activites.sql
--             (convoyeur_decisions : la décision « validée » vaut 'oui'),
--             05_blocage_partenaire.sql (partenaire_actif),
--             90_durcissement_rls_partenaires.sql (RLS missions),
--             96_missions_nettoyage.sql (missions.type_mission),
--             100_activites_partenaire.sql (activites_partenaire),
--             103_nettoyage_horaires_obligatoires.sql (hc_vers_date,
--             hc_vers_entier).
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : trois tables fermées par RLS, deux vues, des
-- fonctions et un trigger. Aucune donnée existante modifiée, aucune
-- RLS affaiblie, aucun bucket ouvert, aucun objet Stripe.
--
-- LES MIGRATIONS 00 À 106 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT (lot O01)
-- ------------------------------------------------------------
--   1. Une mission privée (un client a commandé une prestation) ne
--      pouvait être proposée aux partenaires qu'en la rendant visible
--      « à tous », coordonnées comprises. Aucun moyen de publier un
--      BESOIN — catégorie, période, zone, nombre de professionnels —
--      sans livrer l'adresse ni le client.
--
--   2. Un partenaire ne pouvait pas se PORTER CANDIDAT : il acceptait
--      une mission entière, premier arrivé premier servi. HelixCar ne
--      choisissait rien.
--
--   3. Quand un besoin exigeait N professionnels, rien ne comptait les
--      retenus, rien ne clôturait à N, et rien n'empêchait un N+1.
--
-- ------------------------------------------------------------
-- DÉCISIONS DU PROPRIÉTAIRE, APPLIQUÉES ICI
-- ------------------------------------------------------------
--   C03 — DEUX états publics seulement : « À pourvoir » (a_pourvoir)
--         et « Pourvue / clôturée » (pourvue). JAMAIS de « partiellement
--         pourvue » : 6 retenus sur 9 reste « À pourvoir ». La clôture
--         est ATOMIQUE, à N retenus sur N, dans la MÊME transaction que
--         la N-ième sélection (decider_candidature).
--   C06 — La connexion au suivi de candidature ne vaut pas validation.
--         L'éligibilité repose sur convoyeur_decisions.decision = 'oui'
--         pour au moins une activité requise, et rien ici n'écrit
--         jamais une décision.
--   C11 — Journaliser sans faux « envoyé » : la table
--         opportunite_notifications ne reçoit que des INTENTIONS
--         ('a_envoyer'). AUCUN e-mail n'existe ni ne part dans ce lot.
--
-- E-MAILS MANQUANTS (à activer dans un lot ultérieur, jamais ici) :
--   * opportunité publiée      → chaque partenaire éligible ;
--   * partenaire retenu        → le partenaire ;
--   * partenaire non retenu    → le partenaire ;
--   * besoin entièrement pourvu → le client, UNIQUEMENT à N sur N.
--
-- ------------------------------------------------------------
-- CHOIX DOCUMENTÉS
-- ------------------------------------------------------------
--   * Le brouillon est créé AUTOMATIQUEMENT à chaque nouvelle mission,
--     jamais publié automatiquement : l'administrateur relit, corrige
--     et envoie. La description est un résumé dont les e-mails,
--     téléphones et adresses sont retirés par expression régulière ;
--     la relecture humaine reste obligatoire.
--   * Annuler un retenu (retenu → autre état) sur une opportunité déjà
--     pourvue la ROUVRE en « À pourvoir » : N sur N n'est plus vrai, et
--     un état « pourvue » qui ne le serait pas contredirait C03.
--     cloturee_le est effacé ; publiee_le est conservé.
--   * Aucune écriture directe depuis le navigateur sur les candidatures
--     ni sur l'état d'une opportunité : des triggers refusent toute
--     modification qui ne passe pas par les fonctions de ce fichier,
--     quel que soit le chemin (REST, RPC, SQL Editor).
--   * La vue partenaire montre les opportunités « À pourvoir »
--     éligibles à la session, ET celles où la session a déjà une
--     candidature (même clôturées) : un partenaire retenu doit pouvoir
--     relire sa sélection. Jamais les autres candidats, jamais le
--     client, jamais l'adresse exacte.

-- ------------------------------------------------------------
-- 1. RETIRER LES COORDONNÉES D'UN TEXTE
-- ------------------------------------------------------------
-- E-mails, numéros de téléphone et adresses postales numérotées sont
-- remplacés par une mention entre crochets. Fonction de forme, sans
-- lecture de données : ni security definer, ni accès à une table.
create or replace function public.hc_sans_coordonnees(p text)
returns text
language sql
immutable
strict
set search_path = pg_temp
as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(p,
                 '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
                 '[e-mail retiré]', 'g'),
               -- Numéros français (0X XX XX XX XX, +33 X XX XX XX XX)
               -- et internationaux (+ suivi de 8 chiffres ou plus).
               '(\+\s?[0-9]{1,3}[\s.-]?[0-9](?:[\s.-]?[0-9]{2}){4}|\m0[1-9](?:[\s.-]?[0-9]{2}){4}\M|\+[0-9]{8,})',
               '[téléphone retiré]', 'g'),
             -- « 12 rue …, », « 3 bis avenue … » : le numéro suivi d'un
             -- type de voie, jusqu'à la ponctuation suivante.
             '\m[0-9]{1,4}\s*(bis|ter|quater)?\s*,?\s*(rue|avenue|av\.?|boulevard|bd\.?|chemin|all[ée]e|impasse|place|route|quai|cours|square|voie|passage|lotissement|r[ée]sidence|zac|zi|za)\M[^,.;\n]*',
             '[adresse retirée]', 'gi'),
           -- Une voie nommée sans numéro (« rue des Lilas »).
           '\m(rue|avenue|boulevard|impasse|all[ée]e|quai)\s+(de\s+la\s+|de\s+l''|des\s+|du\s+|de\s+|d''|la\s+|le\s+|les\s+)?[^,.;\n0-9]{2,60}',
           '[adresse retirée]', 'gi')
$$;

comment on function public.hc_sans_coordonnees(text) is
  'Résumé sans coordonnées : e-mails, téléphones et adresses postales '
  'remplacés par une mention. Filet automatique — la relecture par '
  'l''administrateur reste obligatoire avant publication.';

-- ------------------------------------------------------------
-- 2. LES OPPORTUNITÉS
-- ------------------------------------------------------------
create table if not exists public.opportunites (
  id                  uuid primary key default gen_random_uuid(),
  mission_id          uuid not null unique references public.missions(id) on delete cascade,
  statut              text not null default 'brouillon'
                        check (statut in ('brouillon', 'a_pourvoir', 'pourvue')),
  intitule            text,
  categorie           text not null default 'convoyage'
                        check (categorie = any (public.activites_partenaire())),
  date_debut          date,
  date_fin            date,
  duree_texte         text,
  zone_generale       text,
  ponctuelle          boolean not null default true,
  statut_independant  boolean not null default true,
  badges_requis       text[] not null default '{}'
                        check (badges_requis <@ public.activites_partenaire()),
  nb_professionnels   integer not null default 1 check (nb_professionnels >= 1),
  description_publique text,
  publiee_le          timestamptz,
  cloturee_le         timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

comment on table public.opportunites is
  'Besoin publié aux partenaires pour une mission privée. AUCUNE '
  'rémunération, AUCUNE donnée client, AUCUNE adresse exacte : une '
  'catégorie, une période, une zone générale, des badges requis et un '
  'nombre de professionnels. Deux états publics : a_pourvoir et pourvue '
  '(« Pourvue / clôturée »). Jamais « partiellement pourvue » (C03).';
comment on column public.opportunites.zone_generale is
  'Ville ou département. JAMAIS une adresse exacte.';
comment on column public.opportunites.badges_requis is
  'Activités dont AU MOINS UNE doit être validée (decision = oui) chez '
  'le partenaire pour qu''il voie l''opportunité et puisse postuler.';

create index if not exists opportunites_statut_idx
  on public.opportunites (statut, publiee_le desc);

-- ------------------------------------------------------------
-- 3. LES CANDIDATURES
-- ------------------------------------------------------------
create table if not exists public.opportunite_candidatures (
  id              uuid primary key default gen_random_uuid(),
  opportunite_id  uuid not null references public.opportunites(id) on delete cascade,
  convoyeur_id    uuid not null references public.convoyeurs(id) on delete cascade,
  etat            text not null default 'a_etudier'
                    check (etat in ('a_etudier', 'preselectionne', 'retenu', 'non_retenu')),
  created_at      timestamptz not null default now(),
  decidee_le      timestamptz,
  decidee_par     uuid references auth.users(id),
  unique (opportunite_id, convoyeur_id)
);

comment on table public.opportunite_candidatures is
  'Candidature d''un partenaire à une opportunité. Une seule par '
  '(opportunité, partenaire). L''état ne change que par '
  'decider_candidature() ; la création ne passe que par '
  'postuler_opportunite().';

create index if not exists opportunite_candidatures_opp_idx
  on public.opportunite_candidatures (opportunite_id, etat);
create index if not exists opportunite_candidatures_conv_idx
  on public.opportunite_candidatures (convoyeur_id);

-- ------------------------------------------------------------
-- 4. LE JOURNAL DES INTENTIONS DE NOTIFICATION (C11)
-- ------------------------------------------------------------
-- Une ligne par fait à notifier. L''état 'a_envoyer' dit qu''un e-mail
-- DEVRAIT partir ; rien ici ne l''envoie, et aucune ligne ne prétend
-- jamais qu''il est parti. Un lot ultérieur pourra passer à 'echec' ou
-- 'acceptee_prestataire' — jamais ce fichier.
create table if not exists public.opportunite_notifications (
  id                 uuid primary key default gen_random_uuid(),
  opportunite_id     uuid not null references public.opportunites(id) on delete cascade,
  convoyeur_id       uuid references public.convoyeurs(id) on delete cascade,
  destinataire_role  text not null check (destinataire_role in ('partenaire', 'client')),
  evenement          text not null
                       check (evenement in ('publiee', 'retenu', 'non_retenu', 'pourvue_client')),
  etat               text not null default 'a_envoyer'
                       check (etat in ('a_envoyer', 'echec', 'acceptee_prestataire')),
  created_at         timestamptz not null default now()
);

comment on table public.opportunite_notifications is
  'Journal des INTENTIONS de notification. AUCUN e-mail n''existe ni ne '
  'part dans ce lot : chaque ligne a_envoyer est un e-mail MANQUANT '
  '(opportunité publiée, partenaire retenu, non retenu, besoin '
  'entièrement pourvu). Aucune ligne ne peut prétendre à un envoi.';

create index if not exists opportunite_notifications_opp_idx
  on public.opportunite_notifications (opportunite_id, created_at desc);

-- ------------------------------------------------------------
-- 5. PRIVILÈGES ET RLS : FERMÉ
-- ------------------------------------------------------------
-- Le socle Supabase accorde des privilèges PAR DÉFAUT à anon sur toute
-- nouvelle table : on les retire explicitement. Rien pour anon, nulle
-- part.
revoke all on public.opportunites               from anon;
revoke all on public.opportunite_candidatures   from anon;
revoke all on public.opportunite_notifications  from anon;
revoke all on public.opportunites               from authenticated;
revoke all on public.opportunite_candidatures   from authenticated;
revoke all on public.opportunite_notifications  from authenticated;

grant select, insert, update, delete on public.opportunites to authenticated;
grant select on public.opportunite_candidatures  to authenticated;
grant select on public.opportunite_notifications to authenticated;

alter table public.opportunites              enable row level security;
alter table public.opportunite_candidatures  enable row level security;
alter table public.opportunite_notifications enable row level security;

-- Opportunités : l'administrateur lit et écrit (brouillons). La
-- suppression n'est possible que sur un brouillon : une annonce publiée
-- et ses candidatures sont CONSERVÉES, même clôturées.
drop policy if exists "opportunites : lecture admin" on public.opportunites;
create policy "opportunites : lecture admin"
  on public.opportunites for select to authenticated
  using (public.est_admin());

drop policy if exists "opportunites : creation admin" on public.opportunites;
create policy "opportunites : creation admin"
  on public.opportunites for insert to authenticated
  with check (public.est_admin());

drop policy if exists "opportunites : mise a jour admin" on public.opportunites;
create policy "opportunites : mise a jour admin"
  on public.opportunites for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "opportunites : suppression brouillon admin" on public.opportunites;
create policy "opportunites : suppression brouillon admin"
  on public.opportunites for delete to authenticated
  using (public.est_admin() and statut = 'brouillon');

-- Candidatures : l'administrateur lit tout ; un partenaire ne lit que
-- LES SIENNES. Aucune politique d'écriture : tout passe par les
-- fonctions ci-dessous.
drop policy if exists "candidatures opportunite : lecture admin" on public.opportunite_candidatures;
create policy "candidatures opportunite : lecture admin"
  on public.opportunite_candidatures for select to authenticated
  using (public.est_admin());

drop policy if exists "candidatures opportunite : lecture par le partenaire" on public.opportunite_candidatures;
create policy "candidatures opportunite : lecture par le partenaire"
  on public.opportunite_candidatures for select to authenticated
  using (public.est_proprietaire_convoyeur(convoyeur_id));

-- Journal : lecture administrateur seulement.
drop policy if exists "notifications opportunite : lecture admin" on public.opportunite_notifications;
create policy "notifications opportunite : lecture admin"
  on public.opportunite_notifications for select to authenticated
  using (public.est_admin());

-- ------------------------------------------------------------
-- 6. HELPERS DE SESSION (SECURITY DEFINER, search_path figé)
-- ------------------------------------------------------------
-- La fiche partenaire de la session en cours, ou NULL.
create or replace function public.convoyeur_de_session()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id
    from public.convoyeurs c
   where c.auth_user_id = auth.uid()
     and c.statut is distinct from 'refuse'
   order by c.created_at desc
   limit 1;
$$;

revoke all on function public.convoyeur_de_session() from public;
grant execute on function public.convoyeur_de_session() to authenticated;

-- Les activités VALIDÉES (decision = 'oui', migration 04) de la session,
-- si elle est un partenaire actif non bloqué. Tableau vide sinon :
-- pour un client seul, pour un partenaire bloqué, pour un partenaire
-- connecté mais sans aucune activité validée (C06).
create or replace function public.activites_validees_partenaire()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(d.activite order by d.activite), '{}'::text[])
    from public.convoyeurs c
    join public.convoyeur_decisions d on d.convoyeur_id = c.id
   where c.auth_user_id = auth.uid()
     and c.statut is distinct from 'refuse'
     and coalesce(c.bloque, false) = false
     and d.decision = 'oui';
$$;

revoke all on function public.activites_validees_partenaire() from public;
grant execute on function public.activites_validees_partenaire() to authenticated;

comment on function public.activites_validees_partenaire() is
  'Activités dont la décision est « oui » pour le partenaire de la '
  'session, s''il est actif. Ne lit que auth.uid() : ne renseigne jamais '
  'sur un autre compte. Une connexion ne vaut pas validation (C06).';

-- ------------------------------------------------------------
-- 7. VERROUS : AUCUNE ÉCRITURE HORS DES FONCTIONS
-- ------------------------------------------------------------
-- Les fonctions posent un drapeau LOCAL à leur transaction avant
-- d'écrire, et le retirent ensuite. Tout autre chemin d'écriture —
-- REST, SQL Editor, rôle propriétaire compris — est refusé par ces
-- triggers, qui s'exécutent quel que soit l'appelant.
create or replace function public.verrou_candidature_opportunite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('hc.decision_opportunite', true), '') = '1' then
    return new;
  end if;
  raise exception 'Les candidatures ne se créent que par postuler_opportunite() et ne se décident que par decider_candidature().'
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists trg_verrou_candidature_opportunite on public.opportunite_candidatures;
create trigger trg_verrou_candidature_opportunite
  before insert or update on public.opportunite_candidatures
  for each row execute function public.verrou_candidature_opportunite();

-- Une opportunité se corrige librement tant qu'elle est en brouillon.
-- Ensuite, son état, sa publication, sa clôture et son nombre de
-- professionnels ne bougent plus que par les fonctions : un N modifié
-- après publication changerait le sens de « N sur N ».
create or replace function public.verrou_opportunite()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('hc.decision_opportunite', true), '') = '1' then
    return new;
  end if;
  if new.mission_id is distinct from old.mission_id then
    raise exception 'La mission d''une opportunité ne se change pas.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.statut      is distinct from old.statut
     or new.publiee_le  is distinct from old.publiee_le
     or new.cloturee_le is distinct from old.cloturee_le then
    raise exception 'L''état d''une opportunité ne change que par publier_opportunite() et decider_candidature().'
      using errcode = 'insufficient_privilege';
  end if;
  if old.statut <> 'brouillon' then
    raise exception 'Une opportunité publiée ne se modifie plus.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_verrou_opportunite on public.opportunites;
create trigger trg_verrou_opportunite
  before update on public.opportunites
  for each row execute function public.verrou_opportunite();

-- ------------------------------------------------------------
-- 8. LE BROUILLON, PRÉREMPLI DEPUIS LA MISSION
-- ------------------------------------------------------------
-- Lit la mission comme un document JSON : les colonnes de convoyage
-- (date_prise_en_charge, notes, type_vehicule…) existent en production
-- mais pas nécessairement partout ; ce qui manque est simplement vide.
-- Le nombre de professionnels vient de la demande client
-- (professionnel_details.nombre_professionnels) quand elle en porte un,
-- sinon 1. La description ne contient JAMAIS le client ni ses
-- coordonnées ; les textes libres passent par hc_sans_coordonnees().
create or replace function public.creer_brouillon_opportunite(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j          jsonb;
  v_cat      text;
  v_zone     text;
  v_dd       date;
  v_df       date;
  v_duree    text;
  v_desc     text;
  v_nb       integer;
  v_intitule text;
  v_dep      text;
  v_id       uuid;
  v_uid      uuid := auth.uid();
begin
  -- Depuis un trigger, auth.uid() peut être nul (SQL Editor, seed) :
  -- accepté. Depuis une session, seul un administrateur crée un brouillon.
  if v_uid is not null and not public.est_admin() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;

  select to_jsonb(m) into j from public.missions m where m.id = p_mission_id;
  if j is null then
    return jsonb_build_object('ok', false, 'code', 'MISSION_INTROUVABLE');
  end if;

  select o.id into v_id from public.opportunites o where o.mission_id = p_mission_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREE', 'id', v_id);
  end if;

  v_cat := case when j ->> 'type_mission' = 'nettoyage' then 'nettoyage' else 'convoyage' end;

  if v_cat = 'nettoyage' then
    v_dep  := substr(coalesce(j ->> 'code_postal_intervention', ''), 1, 2);
    v_zone := nullif(btrim(concat_ws(' ',
                nullif(btrim(coalesce(j ->> 'ville_intervention', '')), ''),
                case when v_dep ~ '^[0-9]{2}$' then '(' || v_dep || ')' end)), '');
    v_dd   := public.hc_vers_date(j ->> 'date_intervention');
    v_df   := public.hc_vers_date(j ->> 'date_fin_intervention');
    v_intitule := concat_ws(' — ', coalesce(nullif(btrim(coalesce(j ->> 'prestation', '')), ''), 'Nettoyage'), v_zone);
    v_desc := concat_ws(E'\n',
      nullif(btrim(coalesce(j ->> 'prestation', '')), ''),
      case when public.hc_vers_entier(j ->> 'nb_vehicules') is not null
           then (j ->> 'nb_vehicules') || ' véhicule(s) à traiter' end,
      case when nullif(btrim(coalesce(j ->> 'consignes', '')), '') is not null
           then 'Consignes : ' || public.hc_sans_coordonnees(j ->> 'consignes') end);
    v_duree := nullif(btrim(concat_ws(' · ',
      case when v_dd is not null and v_df is not null and v_df >= v_dd
           then (v_df - v_dd + 1)::text || ' jour(s)' end,
      case when nullif(btrim(coalesce(j ->> 'heure_intervention', '')), '') is not null
           then 'sur place ' || (j ->> 'heure_intervention') end)), '');
  else
    v_zone := nullif(btrim(concat_ws(' → ',
                nullif(btrim(coalesce(j ->> 'ville_depart', '')), ''),
                nullif(btrim(coalesce(j ->> 'ville_arrivee', '')), ''))), '');
    v_dd   := public.hc_vers_date(substr(coalesce(j ->> 'date_prise_en_charge', ''), 1, 10));
    v_df   := public.hc_vers_date(substr(coalesce(j ->> 'date_livraison', ''), 1, 10));
    v_intitule := concat_ws(' — ', 'Convoyage', v_zone);
    v_desc := concat_ws(E'\n',
      case when nullif(btrim(coalesce(j ->> 'type_vehicule', '')), '') is not null
           then 'Véhicule : ' || (j ->> 'type_vehicule') end,
      case when public.hc_vers_entier(j ->> 'distance_km') is not null
           then 'Distance : ' || (j ->> 'distance_km') || ' km' end,
      nullif(concat_ws(', ',
        case when (j ->> 'plateau') = 'true' then 'plateau' end,
        case when (j ->> 'urgence') = 'true' then 'urgent' end,
        case when (j ->> 'electrique') = 'true' then 'véhicule électrique' end,
        case when (j ->> 'nettoyage') = 'true' then 'nettoyage inclus' end), ''),
      case when nullif(btrim(coalesce(j ->> 'notes', '')), '') is not null
           then 'Informations : ' || public.hc_sans_coordonnees(j ->> 'notes') end);
    v_duree := case when public.hc_vers_entier(j ->> 'distance_km') is not null
                    then (j ->> 'distance_km') || ' km' end;
  end if;

  -- Nombre de professionnels : depuis la demande si elle le dit, sinon 1.
  v_nb := null;
  if (j ->> 'client_id') is not null then
    select public.hc_vers_entier(c.professionnel_details ->> 'nombre_professionnels')
      into v_nb
      from public.clients c
     where c.id = (j ->> 'client_id')::uuid;
  end if;
  if v_nb is null or v_nb < 1 then v_nb := 1; end if;

  -- Le résumé ENTIER repasse par le filtre : une coordonnée glissée
  -- dans la prestation ou la ville serait retirée aussi.
  v_desc := nullif(btrim(public.hc_sans_coordonnees(coalesce(v_desc, ''))), '');

  perform set_config('hc.decision_opportunite', '1', true);
  insert into public.opportunites
    (mission_id, statut, intitule, categorie, date_debut, date_fin, duree_texte,
     zone_generale, ponctuelle, statut_independant, badges_requis,
     nb_professionnels, description_publique, created_by)
  values
    (p_mission_id, 'brouillon', v_intitule, v_cat, v_dd, v_df, v_duree,
     v_zone, true, true, array[v_cat]::text[],
     v_nb, v_desc, v_uid)
  on conflict (mission_id) do nothing
  returning id into v_id;
  perform set_config('hc.decision_opportunite', '', true);

  if v_id is null then
    select o.id into v_id from public.opportunites o where o.mission_id = p_mission_id;
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREE', 'id', v_id);
  end if;
  return jsonb_build_object('ok', true, 'code', 'CREE', 'id', v_id);
end $$;

revoke all on function public.creer_brouillon_opportunite(uuid) from public;
grant execute on function public.creer_brouillon_opportunite(uuid) to authenticated;

comment on function public.creer_brouillon_opportunite(uuid) is
  'Crée le brouillon d''opportunité d''une mission, une seule fois '
  '(idempotente). Jamais publié automatiquement. Résumé sans '
  'coordonnées, à relire par l''administrateur.';

-- Le trigger : un brouillon par mission créée. Un échec du brouillon
-- ne doit JAMAIS faire échouer la création de la mission elle-même :
-- l'erreur est signalée en avertissement, et l'administrateur peut
-- rappeler creer_brouillon_opportunite() depuis le Dashboard.
create or replace function public.brouillon_opportunite_apres_mission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.creer_brouillon_opportunite(new.id);
  return null;
exception when others then
  raise warning 'Brouillon d''opportunité non créé pour la mission % : %', new.id, sqlerrm;
  return null;
end $$;

drop trigger if exists trg_brouillon_opportunite_apres_mission on public.missions;
create trigger trg_brouillon_opportunite_apres_mission
  after insert on public.missions
  for each row execute function public.brouillon_opportunite_apres_mission();

-- ------------------------------------------------------------
-- 9. MODIFIER UN BROUILLON (administrateur)
-- ------------------------------------------------------------
-- Liste blanche de champs, brouillon uniquement. Une opportunité
-- publiée ne se modifie plus (voir le verrou § 7).
create or replace function public.modifier_opportunite(p_id uuid, p_champs jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o public.opportunites%rowtype;
  v_badges text[];
begin
  if not public.est_admin() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  select * into o from public.opportunites where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;
  if o.statut <> 'brouillon' then
    return jsonb_build_object('ok', false, 'code', 'DEJA_PUBLIEE', 'statut', o.statut);
  end if;

  if p_champs ? 'badges_requis' then
    select coalesce(array_agg(x), '{}'::text[]) into v_badges
      from jsonb_array_elements_text(coalesce(p_champs -> 'badges_requis', '[]'::jsonb)) x;
    if not (v_badges <@ public.activites_partenaire()) then
      return jsonb_build_object('ok', false, 'code', 'BADGES_INVALIDES');
    end if;
  end if;
  if (p_champs ? 'categorie') and not ((p_champs ->> 'categorie') = any (public.activites_partenaire())) then
    return jsonb_build_object('ok', false, 'code', 'CATEGORIE_INVALIDE');
  end if;
  if (p_champs ? 'nb_professionnels')
     and coalesce(public.hc_vers_entier(p_champs ->> 'nb_professionnels'), 0) < 1 then
    return jsonb_build_object('ok', false, 'code', 'NB_PROFESSIONNELS_INVALIDE');
  end if;

  update public.opportunites set
    intitule             = case when p_champs ? 'intitule'             then nullif(btrim(coalesce(p_champs ->> 'intitule', '')), '') else intitule end,
    categorie            = case when p_champs ? 'categorie'            then p_champs ->> 'categorie' else categorie end,
    date_debut           = case when p_champs ? 'date_debut'           then public.hc_vers_date(p_champs ->> 'date_debut') else date_debut end,
    date_fin             = case when p_champs ? 'date_fin'             then public.hc_vers_date(p_champs ->> 'date_fin') else date_fin end,
    duree_texte          = case when p_champs ? 'duree_texte'          then nullif(btrim(coalesce(p_champs ->> 'duree_texte', '')), '') else duree_texte end,
    zone_generale        = case when p_champs ? 'zone_generale'        then nullif(btrim(coalesce(p_champs ->> 'zone_generale', '')), '') else zone_generale end,
    ponctuelle           = case when p_champs ? 'ponctuelle'           then coalesce((p_champs ->> 'ponctuelle')::boolean, true) else ponctuelle end,
    statut_independant   = case when p_champs ? 'statut_independant'   then coalesce((p_champs ->> 'statut_independant')::boolean, true) else statut_independant end,
    badges_requis        = case when p_champs ? 'badges_requis'        then v_badges else badges_requis end,
    nb_professionnels    = case when p_champs ? 'nb_professionnels'    then public.hc_vers_entier(p_champs ->> 'nb_professionnels') else nb_professionnels end,
    description_publique = case when p_champs ? 'description_publique' then nullif(btrim(public.hc_sans_coordonnees(coalesce(p_champs ->> 'description_publique', ''))), '') else description_publique end
  where id = p_id
  returning * into o;

  return jsonb_build_object('ok', true, 'code', 'MODIFIEE', 'id', o.id, 'statut', o.statut);
end $$;

revoke all on function public.modifier_opportunite(uuid, jsonb) from public;
grant execute on function public.modifier_opportunite(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------
-- 10. PUBLIER : brouillon → À pourvoir
-- ------------------------------------------------------------
create or replace function public.publier_opportunite(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o     public.opportunites%rowtype;
  v_n   integer := 0;
begin
  if not public.est_admin() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  select * into o from public.opportunites where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;
  -- Idempotente : déjà publiée, on le dit, sans rien réécrire.
  if o.statut = 'a_pourvoir' then
    return jsonb_build_object('ok', true, 'code', 'DEJA_PUBLIEE', 'statut', o.statut);
  end if;
  if o.statut = 'pourvue' then
    return jsonb_build_object('ok', false, 'code', 'CLOTUREE', 'statut', o.statut);
  end if;
  if o.nb_professionnels is null or o.nb_professionnels < 1 then
    return jsonb_build_object('ok', false, 'code', 'NB_PROFESSIONNELS_INVALIDE');
  end if;
  if nullif(btrim(coalesce(o.description_publique, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'DESCRIPTION_VIDE');
  end if;
  if nullif(btrim(coalesce(o.intitule, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'INTITULE_VIDE');
  end if;
  if coalesce(array_length(o.badges_requis, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'BADGES_REQUIS_VIDES');
  end if;

  perform set_config('hc.decision_opportunite', '1', true);
  update public.opportunites
     set statut = 'a_pourvoir', publiee_le = now()
   where id = p_id;

  -- E-MAIL MANQUANT « opportunité publiée » : une intention par
  -- partenaire éligible (actif, non bloqué, au moins un badge requis
  -- validé). Personne ne reçoit rien ici.
  insert into public.opportunite_notifications
    (opportunite_id, convoyeur_id, destinataire_role, evenement, etat)
  select p_id, c.id, 'partenaire', 'publiee', 'a_envoyer'
    from public.convoyeurs c
   where c.statut is distinct from 'refuse'
     and coalesce(c.bloque, false) = false
     and exists (select 1 from public.convoyeur_decisions d
                  where d.convoyeur_id = c.id
                    and d.decision = 'oui'
                    and d.activite = any (o.badges_requis));
  get diagnostics v_n = row_count;
  perform set_config('hc.decision_opportunite', '', true);

  return jsonb_build_object('ok', true, 'code', 'PUBLIEE', 'statut', 'a_pourvoir',
                            'notifications_a_envoyer', v_n);
end $$;

revoke all on function public.publier_opportunite(uuid) from public;
grant execute on function public.publier_opportunite(uuid) to authenticated;

comment on function public.publier_opportunite(uuid) is
  'Brouillon → À pourvoir. Refuse un nombre de professionnels < 1, une '
  'description, un intitulé ou des badges vides. Idempotente. Journalise '
  'une intention de notification par partenaire éligible ; n''envoie rien.';

-- ------------------------------------------------------------
-- 11. POSTULER (partenaire actif ET validé)
-- ------------------------------------------------------------
create or replace function public.postuler_opportunite(p_opportunite_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o        public.opportunites%rowtype;
  v_conv   uuid;
  v_valid  text[];
  v_id     uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTHENTIFIE');
  end if;
  v_conv := public.convoyeur_de_session();
  -- Compte client seul, partenaire refusé ou bloqué : refus, sans
  -- rien dire de l'opportunité.
  if v_conv is null or not public.partenaire_actif() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  v_valid := public.activites_validees_partenaire();
  if coalesce(array_length(v_valid, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'NON_VALIDE');
  end if;

  -- Verrou : une clôture concurrente ne peut pas se glisser entre la
  -- lecture de l'état et l'écriture de la candidature.
  select * into o from public.opportunites where id = p_opportunite_id for update;
  -- Un brouillon n'existe pas pour un partenaire.
  if not found or o.statut = 'brouillon' then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;
  if not (o.badges_requis && v_valid) then
    return jsonb_build_object('ok', false, 'code', 'NON_ELIGIBLE');
  end if;
  if o.statut = 'pourvue' then
    return jsonb_build_object('ok', false, 'code', 'CLOTUREE', 'statut', o.statut);
  end if;

  perform set_config('hc.decision_opportunite', '1', true);
  insert into public.opportunite_candidatures (opportunite_id, convoyeur_id, etat)
  values (p_opportunite_id, v_conv, 'a_etudier')
  on conflict (opportunite_id, convoyeur_id) do nothing
  returning id into v_id;
  perform set_config('hc.decision_opportunite', '', true);

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'DEJA_CANDIDAT', 'statut', o.statut);
  end if;
  return jsonb_build_object('ok', true, 'code', 'CANDIDATURE_ENREGISTREE',
                            'etat', 'a_etudier', 'statut', o.statut);
end $$;

revoke all on function public.postuler_opportunite(uuid) from public;
grant execute on function public.postuler_opportunite(uuid) to authenticated;

comment on function public.postuler_opportunite(uuid) is
  'Candidature d''un partenaire actif ET validé (au moins un badge requis '
  'en décision « oui ») à une opportunité À pourvoir. Une seule par '
  'partenaire (DEJA_CANDIDAT), jamais après clôture (CLOTUREE). Un '
  'compte client seul est refusé (NON_AUTORISE).';

-- ------------------------------------------------------------
-- 12. DÉCIDER : À étudier / Présélectionné / Retenu / Non retenu
-- ------------------------------------------------------------
-- La N-ième sélection clôture dans la MÊME transaction (C03). Un N+1
-- est refusé (PLACES_EPUISEES). L'opportunité est verrouillée FOR
-- UPDATE : deux administrateurs qui retiennent en même temps sont
-- sérialisés, et le second voit le compte réel.
create or replace function public.decider_candidature(p_candidature_id uuid, p_etat text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c          public.opportunite_candidatures%rowtype;
  o          public.opportunites%rowtype;
  v_retenus  integer;
  v_statut   text;
  v_code     text := 'DECIDEE';
begin
  if not public.est_admin() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  if p_etat is null or p_etat not in ('a_etudier', 'preselectionne', 'retenu', 'non_retenu') then
    return jsonb_build_object('ok', false, 'code', 'ETAT_INVALIDE');
  end if;

  select * into c from public.opportunite_candidatures where id = p_candidature_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;
  select * into o from public.opportunites where id = c.opportunite_id for update;

  if o.statut = 'brouillon' then
    return jsonb_build_object('ok', false, 'code', 'NON_PUBLIEE', 'statut', o.statut);
  end if;

  select count(*) into v_retenus
    from public.opportunite_candidatures x
   where x.opportunite_id = o.id and x.etat = 'retenu' and x.id <> c.id;

  -- Une candidature déjà retenue ne se retient pas deux fois.
  if p_etat = 'retenu' and c.etat = 'retenu' then
    return jsonb_build_object('ok', false, 'code', 'DEJA_RETENU', 'statut', o.statut,
                              'retenus', v_retenus + 1, 'requis', o.nb_professionnels);
  end if;
  -- Un N+1 est refusé. Comme la clôture est atomique à N sur N, ce cas
  -- se présente TOUJOURS sur une opportunité déjà pourvue : le code dit
  -- la cause réelle (plus de place), pas seulement l'état.
  if p_etat = 'retenu' and v_retenus + 1 > o.nb_professionnels then
    return jsonb_build_object('ok', false, 'code', 'PLACES_EPUISEES', 'statut', o.statut,
                              'retenus', v_retenus, 'requis', o.nb_professionnels);
  end if;
  -- Une opportunité pourvue ne bouge plus, sauf pour ANNULER un retenu :
  -- N sur N n'est alors plus vrai, et elle rouvre (choix documenté).
  if o.statut = 'pourvue' and not (c.etat = 'retenu' and p_etat <> 'retenu') then
    return jsonb_build_object('ok', false, 'code', 'CLOTUREE', 'statut', o.statut,
                              'retenus', v_retenus + case when c.etat = 'retenu' then 1 else 0 end,
                              'requis', o.nb_professionnels);
  end if;

  if c.etat = p_etat then
    return jsonb_build_object('ok', true, 'code', 'INCHANGEE', 'statut', o.statut,
                              'retenus', v_retenus + case when c.etat = 'retenu' then 1 else 0 end,
                              'requis', o.nb_professionnels);
  end if;

  perform set_config('hc.decision_opportunite', '1', true);
  update public.opportunite_candidatures
     set etat = p_etat, decidee_le = now(), decidee_par = auth.uid()
   where id = p_candidature_id;

  if p_etat = 'retenu' then
    v_retenus := v_retenus + 1;
    insert into public.opportunite_notifications
      (opportunite_id, convoyeur_id, destinataire_role, evenement, etat)
    values (o.id, c.convoyeur_id, 'partenaire', 'retenu', 'a_envoyer');
  elsif p_etat = 'non_retenu' then
    insert into public.opportunite_notifications
      (opportunite_id, convoyeur_id, destinataire_role, evenement, etat)
    values (o.id, c.convoyeur_id, 'partenaire', 'non_retenu', 'a_envoyer');
  end if;

  v_statut := o.statut;
  if v_retenus >= o.nb_professionnels and o.statut = 'a_pourvoir' then
    -- N sur N : clôture atomique, même transaction. Le client est
    -- informé « besoin entièrement pourvu » ICI et seulement ici.
    update public.opportunites
       set statut = 'pourvue', cloturee_le = now()
     where id = o.id;
    insert into public.opportunite_notifications
      (opportunite_id, convoyeur_id, destinataire_role, evenement, etat)
    values (o.id, null, 'client', 'pourvue_client', 'a_envoyer');
    v_statut := 'pourvue';
    v_code   := 'POURVUE';
  elsif v_retenus < o.nb_professionnels and o.statut = 'pourvue' then
    update public.opportunites
       set statut = 'a_pourvoir', cloturee_le = null
     where id = o.id;
    v_statut := 'a_pourvoir';
    v_code   := 'ROUVERTE';
  end if;
  perform set_config('hc.decision_opportunite', '', true);

  return jsonb_build_object('ok', true, 'code', v_code, 'etat', p_etat,
                            'retenus', v_retenus, 'requis', o.nb_professionnels,
                            'statut', v_statut);
end $$;

revoke all on function public.decider_candidature(uuid, text) from public;
grant execute on function public.decider_candidature(uuid, text) to authenticated;

comment on function public.decider_candidature(uuid, text) is
  'Décision administrateur sur une candidature. Verrouille l''opportunité, '
  'refuse un N+1 (PLACES_EPUISEES) et une double sélection (DEJA_RETENU), '
  'clôture atomiquement à N sur N (statut pourvue, cloturee_le), rouvre '
  'si un retenu est annulé sur une opportunité pourvue. Retourne '
  '{ok, code, retenus, requis, statut}.';

-- ------------------------------------------------------------
-- 13. LA VUE PARTENAIRE
-- ------------------------------------------------------------
-- security_invoker = off, comme v_mes_demandes : le partenaire n'a
-- aucune politique de lecture sur la table. Le cloisonnement est DANS
-- la vue : partenaire actif, badge validé, et seulement SA candidature.
-- Aucun nom, e-mail, téléphone ni adresse exacte : ces colonnes
-- n'existent pas dans opportunites, et la vue ne joint ni missions ni
-- clients.
create or replace view public.v_opportunites_partenaire as
select
  o.id,
  o.statut,
  o.intitule,
  o.categorie,
  o.date_debut,
  o.date_fin,
  o.duree_texte,
  o.zone_generale,
  o.ponctuelle,
  o.statut_independant,
  o.badges_requis,
  o.nb_professionnels,
  o.description_publique,
  o.publiee_le,
  c.etat        as ma_candidature_etat,
  c.created_at  as ma_candidature_le
from public.opportunites o
left join public.opportunite_candidatures c
       on c.opportunite_id = o.id
      and c.convoyeur_id = public.convoyeur_de_session()
where public.partenaire_actif()
  and o.statut <> 'brouillon'
  and (o.statut = 'a_pourvoir' or c.id is not null)
  and (o.badges_requis && public.activites_validees_partenaire());

alter view public.v_opportunites_partenaire set (security_invoker = off);
revoke all on public.v_opportunites_partenaire from anon;
revoke all on public.v_opportunites_partenaire from authenticated;
grant select on public.v_opportunites_partenaire to authenticated;

comment on view public.v_opportunites_partenaire is
  'Opportunités visibles par le partenaire de la session : À pourvoir et '
  'éligibles (un badge requis validé), plus celles où il a candidaté, '
  'avec l''état de SA candidature. Jamais les autres candidats, jamais '
  'le client, jamais l''adresse exacte. Vide pour un compte client seul.';

-- ------------------------------------------------------------
-- 14. LA VUE ADMINISTRATEUR : compteurs SERVEUR du pipeline
-- ------------------------------------------------------------
-- security_invoker = on : la RLS d'opportunites s'applique — un
-- partenaire ou un client n'y voit rien.
-- Recréée à chaque application (drop puis create) : « o.* » fige la
-- liste des colonnes, et un « create or replace » échouerait si une
-- colonne s'ajoutait un jour à opportunites. Aucune donnée n'y vit.
drop view if exists public.v_opportunites_admin;
create view public.v_opportunites_admin as
select
  o.*,
  m.reference as mission_reference,
  m.statut    as mission_statut,
  (select count(*) from public.opportunite_candidatures x where x.opportunite_id = o.id and x.etat = 'a_etudier')      as nb_a_etudier,
  (select count(*) from public.opportunite_candidatures x where x.opportunite_id = o.id and x.etat = 'preselectionne') as nb_preselectionnes,
  (select count(*) from public.opportunite_candidatures x where x.opportunite_id = o.id and x.etat = 'retenu')         as nb_retenus,
  (select count(*) from public.opportunite_candidatures x where x.opportunite_id = o.id and x.etat = 'non_retenu')     as nb_non_retenus,
  (select count(*) from public.opportunite_notifications n where n.opportunite_id = o.id and n.etat = 'a_envoyer')     as nb_notifications_a_envoyer
from public.opportunites o
left join public.missions m on m.id = o.mission_id;

alter view public.v_opportunites_admin set (security_invoker = on);
revoke all on public.v_opportunites_admin from anon;
revoke all on public.v_opportunites_admin from authenticated;
grant select on public.v_opportunites_admin to authenticated;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from pg_tables
--    where tablename in ('opportunites','opportunite_candidatures','opportunite_notifications');
--   -- attendu : 3
--
--   select tablename, rowsecurity from pg_tables
--    where tablename like 'opportunite%';
--   -- attendu : true partout
--
--   select count(*) from information_schema.role_table_grants
--    where grantee = 'anon' and table_name like 'opportunite%';
--   -- attendu : 0
--
--   select count(*) from information_schema.role_routine_grants
--    where grantee = 'anon'
--      and routine_name in ('publier_opportunite','decider_candidature',
--                           'postuler_opportunite','modifier_opportunite',
--                           'creer_brouillon_opportunite');
--   -- attendu : 0
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.missions'::regclass
--      and tgname = 'trg_brouillon_opportunite_apres_mission';
--   -- attendu : 1 ligne
--
--   select count(*) from pg_proc where proname in
--     ('publier_opportunite','decider_candidature','postuler_opportunite');
--   -- attendu : 3 (une seule signature par nom : aucune ambiguïté PostgREST)
--
--   Depuis la session d'un CLIENT de test :
--     select count(*) from public.v_opportunites_partenaire;   -- 0
--     select count(*) from public.opportunites;                -- 0
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- Du moins destructeur au plus destructeur :
--
--   1. ne rien faire : tables vides et fonctions inutilisées n'ont
--      aucun effet sur l'existant ;
--   2. ne plus créer de brouillons automatiquement :
--        drop trigger if exists trg_brouillon_opportunite_apres_mission on public.missions;
--        drop function if exists public.brouillon_opportunite_apres_mission();
--   3. retirer les fonctions (le Dashboard cesse de proposer les
--      opportunités ; les données restent lisibles par l'administrateur) :
--        drop view if exists public.v_opportunites_partenaire;
--        drop view if exists public.v_opportunites_admin;
--        drop function if exists public.decider_candidature(uuid, text);
--        drop function if exists public.postuler_opportunite(uuid);
--        drop function if exists public.publier_opportunite(uuid);
--        drop function if exists public.modifier_opportunite(uuid, jsonb);
--        drop function if exists public.creer_brouillon_opportunite(uuid);
--        drop function if exists public.activites_validees_partenaire();
--        drop function if exists public.convoyeur_de_session();
--        drop function if exists public.hc_sans_coordonnees(text);
--   4. retirer les tables — DESTRUCTIF : les candidatures des partenaires
--      et le journal des intentions sont perdus :
--        drop trigger if exists trg_verrou_candidature_opportunite on public.opportunite_candidatures;
--        drop trigger if exists trg_verrou_opportunite on public.opportunites;
--        drop function if exists public.verrou_candidature_opportunite();
--        drop function if exists public.verrou_opportunite();
--        drop table if exists public.opportunite_notifications;
--        drop table if exists public.opportunite_candidatures;
--        drop table if exists public.opportunites;
