-- ============================================================
-- HelixCar — 109 : programme de fidélité client, en points (lot L01)
-- ============================================================
-- Dépend de : 00_helpers.sql (est_admin), 06_informations_manquantes.sql
--             (clients.auth_user_id), 90_durcissement_rls_partenaires.sql
--             (RLS de public.missions), 97_missions_verrou_serveur.sql
--             (« terminee » réservé à l'administrateur),
--             106_devis_versions_et_journal_envois.sql (devis.paiement_statut,
--             paiement_confirme_le, annule_le).
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : une table fermée par RLS, une vue, des fonctions,
-- deux triggers AFTER UPDATE et un garde-fou BEFORE UPDATE. Aucune donnée
-- existante modifiée, aucune RLS désactivée ni affaiblie, aucun bucket
-- ouvert, aucun objet de paiement (Stripe ou autre).
--
-- LES MIGRATIONS 00 À 106 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- DÉCISION C10 (définitive), telle qu'appliquée ici
-- ------------------------------------------------------------
--   * 1 € payé = 1 point, UNIQUEMENT sur une prestation réellement
--     terminée ET payée. Aucun point pour une inscription, un devis non
--     accepté, une candidature, une commande non payée.
--   * Paliers : 2 000 / 4 000 / 6 000 / 8 000 / 10 000 points. Après
--     10 000, continuité tous les 2 000 points (12 000, 14 000, …) sans
--     remise à zéro ni plafond ; chaque palier postérieur à 10 000 ouvre
--     une « Box mystère ».
--   * Les kilomètres ne sont plus l'unité centrale du client. Le
--     « Palier Entreprise » n'existe plus (cinquième palier normal).
--     Les crédits 50/150/250 € sont REJETÉS. Le challenge trimestriel des
--     convoyeurs (kilomètres, 50/100/150 €) ne change PAS et n'est pas
--     concerné par ce fichier.
--   * Calcul SERVEUR, registre de mouvements, JAMAIS modifiable depuis le
--     navigateur : aucune écriture n'est accordée à `authenticated` ni à
--     `anon` ; seules les fonctions SECURITY DEFINER écrivent, et elles ne
--     sont pas exposées au navigateur (aucun EXECUTE accordé).
--
-- ------------------------------------------------------------
-- RÈGLE DE CALCUL COMPLÉMENTAIRE VALIDÉE LE 11 SEPTEMBRE 2026
-- ------------------------------------------------------------
--   * Base : montant TTC du devis payé, enregistré dans `devis.prix`.
--   * Centimes : un point par euro TTC entier, arrondi à l'inférieur :
--     floor(prix). Exemple validé : 123,99 € TTC → 123 points.
--
-- CE QUI N'EST TOUJOURS PAS DÉFINI — rien n'est inventé
-- ------------------------------------------------------------
--   * Expiration des points : règle non décidée. Cette migration ne
--     crée aucun mécanisme d'expiration et l'interface ne promet donc
--     ni expiration ni absence d'expiration.
--   * Remboursement d'un AVANTAGE : non défini → AUCUNE distribution
--     d'avantage n'est faite ici. Seuls les points et les seuils
--     existent. Les récompenses des paliers ne vivent pas en base.
--   * Remboursement PARTIEL sans montant : le retrait de points est
--     BLOQUÉ (on ne sait pas combien retirer). L'intention est
--     JOURNALISÉE (mouvement à 0 point, motif ajustement_admin, détail
--     explicite) pour qu'un administrateur tranche avec
--     ajuster_points_admin().
--   * Annulation / remboursement total : une SEULE contrepassation, quel
--     que soit le nombre d'événements reçus (clé de dédoublonnage unique
--     par devis).

-- ------------------------------------------------------------
-- 1. LE REGISTRE DES MOUVEMENTS
-- ------------------------------------------------------------
-- Une ligne par FAIT (crédit, contrepassation, ajustement). Le solde
-- n'est jamais stocké : il est la somme des mouvements. Rien n'est
-- jamais modifié ni supprimé ; on ajoute.
create table if not exists public.fidelite_mouvements (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid not null references auth.users(id),
  client_id         uuid references public.clients(id) on delete set null,
  points            integer not null,
  motif             text not null
                      check (motif in ('prestation_payee', 'remboursement', 'annulation', 'ajustement_admin')),
  reference_type    text check (reference_type in ('devis', 'mission')),
  reference_id      uuid,
  cle_dedoublonnage text not null unique,
  detail            text,
  created_at        timestamptz not null default now(),
  cree_par          uuid references auth.users(id),
  -- Un mouvement à 0 point n'existe que pour journaliser une intention
  -- d'ajustement (remboursement partiel sans montant).
  constraint fidelite_points_non_nuls
    check (points <> 0 or motif = 'ajustement_admin'),
  -- Une référence se donne en entier ou pas du tout.
  constraint fidelite_reference_coherente
    check ((reference_type is null) = (reference_id is null)),
  -- Un crédit de prestation se rattache toujours à un devis.
  constraint fidelite_credit_reference_devis
    check (motif <> 'prestation_payee' or reference_type = 'devis')
);

comment on table public.fidelite_mouvements is
  'Registre des points de fidélité client. Une ligne par fait : crédit '
  'd''une prestation terminée ET payée (1 € = 1 point), contrepassation '
  'après remboursement total ou annulation, ajustement d''un '
  'administrateur. Le solde est la somme des points. Aucune écriture '
  'depuis le navigateur : seules les fonctions SECURITY DEFINER de ce '
  'fichier insèrent, et personne ne modifie ni ne supprime.';
comment on column public.fidelite_mouvements.points is
  'Points crédités (positif) ou retirés (négatif). 0 uniquement pour une '
  'intention d''ajustement journalisée (motif ajustement_admin).';
comment on column public.fidelite_mouvements.cle_dedoublonnage is
  'Clé d''idempotence : « devis:<id>:prestation_payee », '
  '« devis:<id>:contrepassation », « devis:<id>:rembourse_partiel », '
  '« admin:<clé> ». Un événement rejoué ne crée jamais de doublon.';
comment on column public.fidelite_mouvements.cree_par is
  'Session à l''origine du fait (administrateur), ou NULL quand c''est le '
  'serveur (fonction sans session) qui a déclenché le mouvement.';

create index if not exists fidelite_mouvements_compte_idx
  on public.fidelite_mouvements (auth_user_id, created_at desc);
create index if not exists fidelite_mouvements_reference_idx
  on public.fidelite_mouvements (reference_type, reference_id);

-- Privilèges : les privilèges PAR DÉFAUT du schéma public accorderaient
-- lecture ET écriture à anon et authenticated. On les retire, et on ne
-- rend que la lecture à `authenticated` — la RLS filtre ensuite les
-- lignes. `anon` n'a rien.
revoke all on public.fidelite_mouvements from anon;
revoke all on public.fidelite_mouvements from authenticated;
grant select on public.fidelite_mouvements to authenticated;

alter table public.fidelite_mouvements enable row level security;

-- Le client lit SES mouvements, et seulement les siens.
drop policy if exists "fidelite : lecture client" on public.fidelite_mouvements;
create policy "fidelite : lecture client"
  on public.fidelite_mouvements for select to authenticated
  using (auth_user_id = auth.uid());

-- L'administrateur lit tout.
drop policy if exists "fidelite : lecture admin" on public.fidelite_mouvements;
create policy "fidelite : lecture admin"
  on public.fidelite_mouvements for select to authenticated
  using (public.est_admin());

-- AUCUNE politique d'insertion, de mise à jour ni de suppression, pour
-- personne — administrateur compris. Les écritures passent par les
-- fonctions ci-dessous, qui s'exécutent avec les droits du propriétaire
-- de la table.

-- ------------------------------------------------------------
-- 2. LES SEUILS — une seule règle, immuable, partagée
-- ------------------------------------------------------------
-- Pas de 2 000 points. Cinq paliers initiaux (2 000 → 10 000), puis une
-- Box mystère tous les 2 000 points, sans plafond. Fonction IMMUTABLE :
-- même entrée, même sortie, utilisable dans une vue ou un index.
create or replace function public.fidelite_prochain_palier(p_solde integer)
returns jsonb
language sql
immutable
as $$
  with s as (
    select coalesce(p_solde, 0)                    as solde_brut,
           greatest(coalesce(p_solde, 0), 0)       as solde
  ), c as (
    select solde_brut, solde,
           (solde / 2000) * 2000                   as palier_courant,   -- division entière
           (solde / 2000 + 1) * 2000               as prochain_seuil
      from s
  )
  select jsonb_build_object(
    'solde',                  solde_brut,
    'pas',                    2000,
    'seuils_initiaux',        jsonb_build_array(2000, 4000, 6000, 8000, 10000),
    'dernier_seuil_initial',  10000,
    'palier_courant',         palier_courant,
    'palier_numero',          palier_courant / 2000,
    'palier_courant_nom',     case when palier_courant = 0       then null
                                   when palier_courant <= 10000  then 'Palier ' || (palier_courant / 2000)
                                   else 'Box mystère' end,
    'prochain_seuil',         prochain_seuil,
    'prochain_nom',           case when prochain_seuil <= 10000 then 'Palier ' || (prochain_seuil / 2000)
                                   else 'Box mystère' end,
    'points_restants',        prochain_seuil - solde,
    'box_mystere',            prochain_seuil > 10000,
    'boxes_mystere_acquises', greatest(palier_courant / 2000 - 5, 0)
  )
  from c;
$$;

comment on function public.fidelite_prochain_palier(integer) is
  'Position d''un solde dans le programme : palier courant (seuil '
  'atteint), prochain seuil, points restants, et si le prochain palier '
  'est une Box mystère (au-delà de 10 000). Seuils 2 000, 4 000, 6 000, '
  '8 000, 10 000 puis +2 000 sans plafond. Aucune récompense n''est '
  'décrite ici : elles ne sont pas toutes définies.';

revoke all on function public.fidelite_prochain_palier(integer) from public;
grant execute on function public.fidelite_prochain_palier(integer) to authenticated;

-- ------------------------------------------------------------
-- 3. LE SOLDE DE LA SESSION — calculé par le serveur
-- ------------------------------------------------------------
create or replace function public.fidelite_solde()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(m.points), 0)::integer
    from public.fidelite_mouvements m
   where auth.uid() is not null
     and m.auth_user_id = auth.uid();
$$;

comment on function public.fidelite_solde() is
  'Somme des points du compte connecté. 0 sans session ou sans mouvement. '
  'Le navigateur ne calcule jamais ce solde : il le lit.';

revoke all on function public.fidelite_solde() from public;
grant execute on function public.fidelite_solde() to authenticated;

-- ------------------------------------------------------------
-- 4. LA VUE DU CLIENT
-- ------------------------------------------------------------
-- Une ligne pour la session connectée, rien sans session. Les colonnes
-- sont celles de fidelite_prochain_palier() : le Dashboard affiche, il
-- ne recalcule pas.
create or replace view public.v_ma_fidelite as
select
  (j ->> 'solde')::integer                    as solde,
  (j ->> 'pas')::integer                      as pas,
  (j ->> 'palier_courant')::integer           as palier_courant,
  (j ->> 'palier_numero')::integer            as palier_numero,
  j ->> 'palier_courant_nom'                  as palier_courant_nom,
  (j ->> 'prochain_seuil')::integer           as prochain_seuil,
  j ->> 'prochain_nom'                        as prochain_nom,
  (j ->> 'points_restants')::integer          as points_restants,
  (j ->> 'box_mystere')::boolean              as box_mystere,
  (j ->> 'boxes_mystere_acquises')::integer   as boxes_mystere_acquises,
  (select count(*)::integer from public.fidelite_mouvements m
    where m.auth_user_id = auth.uid())        as nb_mouvements,
  (select max(m.created_at) from public.fidelite_mouvements m
    where m.auth_user_id = auth.uid())        as dernier_mouvement_le
from public.fidelite_prochain_palier(public.fidelite_solde()) as j
where auth.uid() is not null;

-- Même choix que v_mes_demandes : la vue s'exécute avec les droits de son
-- propriétaire, et le cloisonnement est porté par auth.uid() dans la vue
-- et dans fidelite_solde(), que l'appelant ne peut pas contourner.
alter view public.v_ma_fidelite set (security_invoker = off);

revoke all on public.v_ma_fidelite from anon;
revoke all on public.v_ma_fidelite from authenticated;
grant select on public.v_ma_fidelite to authenticated;

comment on view public.v_ma_fidelite is
  'Programme de fidélité du client connecté : solde, palier courant, '
  'prochain seuil, points restants, Box mystère. Calculé par le serveur.';

-- ------------------------------------------------------------
-- 5. LE CRÉDIT — au SECOND des deux événements
-- ------------------------------------------------------------
-- Deux faits doivent être vrais, dans n'importe quel ordre :
--   (a) le devis est PAYÉ : devis.paiement_statut = 'paye' ;
--   (b) la prestation est TERMINÉE : toutes les missions non annulées de
--       la demande sont « terminee », et il y en a au moins une.
-- La fonction est appelée par les deux triggers (devis et missions) :
-- le premier événement ne fait rien, le second crédite. Rejouer l'un ou
-- l'autre ne crée jamais de doublon (clé de dédoublonnage unique).
--
-- Montant : floor(devis.prix TTC), soit un point par euro TTC entier.
-- Aucun avantage n'est distribué : des points, c'est tout.
create or replace function public.crediter_points_prestation(p_devis_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d           public.devis%rowtype;
  v_compte    uuid;
  v_missions  integer;
  v_restantes integer;
  v_points    integer;
  v_cle       text;
  v_id        uuid;
begin
  select * into d from public.devis dv where dv.id = p_devis_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'DEVIS_INTROUVABLE');
  end if;

  -- (a) Payé. Cet état est posé par le serveur ou un administrateur,
  -- jamais par le navigateur d'un client (garde-fou § 6).
  if d.paiement_statut is distinct from 'paye' then
    return jsonb_build_object('ok', false, 'code', 'NON_PAYE');
  end if;

  -- (b) Terminé. « terminee » n'est atteignable que par l'administrateur
  -- (migration 97) : un partenaire ne peut pas déclencher un crédit.
  select count(*),
         count(*) filter (where m.statut is distinct from 'terminee')
    into v_missions, v_restantes
    from public.missions m
   where d.client_id is not null
     and m.client_id = d.client_id
     and m.statut is distinct from 'annulee';
  if v_missions = 0 or v_restantes > 0 then
    return jsonb_build_object('ok', false, 'code', 'NON_TERMINEE',
                              'missions', v_missions, 'restantes', v_restantes);
  end if;

  -- Un compte à créditer. Une demande déposée sans compte ne cumule
  -- rien : on ne rattache pas à l'aveugle (même règle que la migration 06).
  select c.auth_user_id into v_compte
    from public.clients c where c.id = d.client_id;
  if v_compte is null then
    return jsonb_build_object('ok', false, 'code', 'COMPTE_INCONNU');
  end if;

  -- Règle validée : un point par euro TTC entier, arrondi à l'inférieur.
  if d.prix is null or d.prix < 1 then
    return jsonb_build_object('ok', false, 'code', 'PRIX_ABSENT');
  end if;
  v_points := floor(d.prix)::integer;

  v_cle := 'devis:' || d.id::text || ':prestation_payee';
  insert into public.fidelite_mouvements
    (auth_user_id, client_id, points, motif, reference_type, reference_id,
     cle_dedoublonnage, detail, cree_par)
  values
    (v_compte, d.client_id, v_points, 'prestation_payee', 'devis', d.id, v_cle,
     'Prestation terminée et payée — devis ' || coalesce(d.reference, d.id::text)
       || ', version ' || coalesce(d.version, 1),
     auth.uid())
  on conflict (cle_dedoublonnage) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREDITE', 'points', 0);
  end if;
  return jsonb_build_object('ok', true, 'code', 'CREDITE', 'points', v_points,
                            'mouvement_id', v_id);
end $$;

comment on function public.crediter_points_prestation(uuid) is
  'Crédite floor(prix) points au compte du demandeur quand le devis est '
  'payé ET la prestation terminée — au second des deux événements. '
  'Idempotente (clé devis:<id>:prestation_payee). Non exposée au '
  'navigateur : appelée par les triggers de ce fichier.';

-- Pas d'EXECUTE pour authenticated ni anon : seule la chaîne de triggers
-- (qui s'exécute avec les droits du propriétaire) l'appelle.
revoke all on function public.crediter_points_prestation(uuid) from public;

-- ------------------------------------------------------------
-- 5 bis. LA CONTREPASSATION — une seule fois
-- ------------------------------------------------------------
-- Remboursement total ou annulation : le crédit est contrepassé en
-- entier, UNE fois. La clé « devis:<id>:contrepassation » est commune
-- aux deux motifs : deux événements successifs (annulation puis
-- remboursement, ou l'inverse, ou un rejeu) ne retirent jamais deux fois.
create or replace function public.fidelite_contrepasser_credit(p_devis_id uuid, p_motif text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  credit public.fidelite_mouvements%rowtype;
  v_id   uuid;
begin
  if p_motif not in ('remboursement', 'annulation') then
    raise exception 'Motif de contrepassation inconnu : %', p_motif
      using errcode = 'check_violation';
  end if;

  select * into credit
    from public.fidelite_mouvements m
   where m.cle_dedoublonnage = 'devis:' || p_devis_id::text || ':prestation_payee';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'AUCUN_CREDIT');
  end if;

  insert into public.fidelite_mouvements
    (auth_user_id, client_id, points, motif, reference_type, reference_id,
     cle_dedoublonnage, detail, cree_par)
  values
    (credit.auth_user_id, credit.client_id, -credit.points, p_motif, 'devis', p_devis_id,
     'devis:' || p_devis_id::text || ':contrepassation',
     'Contrepassation du crédit ' || credit.id::text || ' (' || p_motif || ')',
     auth.uid())
  on conflict (cle_dedoublonnage) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'code', 'DEJA_CONTREPASSE', 'points', 0);
  end if;
  return jsonb_build_object('ok', true, 'code', 'CONTREPASSE', 'points', -credit.points,
                            'mouvement_id', v_id);
end $$;

comment on function public.fidelite_contrepasser_credit(uuid, text) is
  'Retire en entier, UNE seule fois, le crédit d''un devis remboursé ou '
  'annulé. Non exposée au navigateur.';

revoke all on function public.fidelite_contrepasser_credit(uuid, text) from public;

-- Remboursement PARTIEL sans montant : BLOQUÉ. On ne sait pas combien de
-- points retirer, donc on n'en retire aucun ; on JOURNALISE l'intention
-- (0 point) pour qu'un administrateur tranche. Une fois par devis.
create or replace function public.fidelite_journaliser_remboursement_partiel(p_devis_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  credit public.fidelite_mouvements%rowtype;
  v_id   uuid;
begin
  select * into credit
    from public.fidelite_mouvements m
   where m.cle_dedoublonnage = 'devis:' || p_devis_id::text || ':prestation_payee';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'AUCUN_CREDIT');
  end if;

  insert into public.fidelite_mouvements
    (auth_user_id, client_id, points, motif, reference_type, reference_id,
     cle_dedoublonnage, detail, cree_par)
  values
    (credit.auth_user_id, credit.client_id, 0, 'ajustement_admin', 'devis', p_devis_id,
     'devis:' || p_devis_id::text || ':rembourse_partiel',
     'Remboursement partiel : montant non défini — aucun point retiré '
     'automatiquement ; ajustement à décider par HelixCar '
     '(ajuster_points_admin). Crédit concerné : ' || credit.id::text,
     auth.uid())
  on conflict (cle_dedoublonnage) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'code', 'DEJA_JOURNALISE');
  end if;
  return jsonb_build_object('ok', true, 'code', 'AJUSTEMENT_A_DECIDER', 'mouvement_id', v_id);
end $$;

comment on function public.fidelite_journaliser_remboursement_partiel(uuid) is
  'Remboursement partiel sans montant défini : ne retire aucun point, '
  'journalise l''intention d''ajustement (0 point). Non exposée au navigateur.';

revoke all on function public.fidelite_journaliser_remboursement_partiel(uuid) from public;

-- ------------------------------------------------------------
-- 5 ter. L'AJUSTEMENT PAR UN ADMINISTRATEUR — seule écriture « humaine »
-- ------------------------------------------------------------
-- Réservée à l'administrateur (vérifié ici, pas par l'interface). Un
-- détail est OBLIGATOIRE : un ajustement sans raison écrite n'existe pas.
-- Idempotente si l'appelant fournit sa clé.
create or replace function public.ajuster_points_admin(
  p_auth_user_id uuid,
  p_points       integer,
  p_detail       text,
  p_devis_id     uuid default null,
  p_cle          text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_cle   text;
  v_solde integer;
begin
  if not public.est_admin() then
    raise exception 'Ajustement réservé à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_auth_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_auth_user_id) then
    raise exception 'Compte introuvable.' using errcode = 'check_violation';
  end if;
  if p_points is null or p_points = 0 then
    raise exception 'Un ajustement porte un nombre de points non nul.'
      using errcode = 'check_violation';
  end if;
  if p_detail is null or btrim(p_detail) = '' then
    raise exception 'Le motif de l''ajustement est obligatoire.'
      using errcode = 'check_violation';
  end if;

  v_cle := 'admin:' || coalesce(nullif(btrim(p_cle), ''), gen_random_uuid()::text);

  insert into public.fidelite_mouvements
    (auth_user_id, client_id, points, motif, reference_type, reference_id,
     cle_dedoublonnage, detail, cree_par)
  values
    (p_auth_user_id,
     (select dv.client_id from public.devis dv where dv.id = p_devis_id),
     p_points, 'ajustement_admin',
     case when p_devis_id is not null then 'devis' end, p_devis_id,
     v_cle, btrim(p_detail), auth.uid())
  on conflict (cle_dedoublonnage) do nothing
  returning id into v_id;

  select coalesce(sum(m.points), 0)::integer into v_solde
    from public.fidelite_mouvements m where m.auth_user_id = p_auth_user_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'code', 'DEJA_AJUSTE', 'solde', v_solde);
  end if;
  return jsonb_build_object('ok', true, 'code', 'AJUSTE', 'points', p_points,
                            'solde', v_solde, 'mouvement_id', v_id);
end $$;

comment on function public.ajuster_points_admin(uuid, integer, text, uuid, text) is
  'Ajustement manuel des points par un administrateur, motif écrit '
  'obligatoire. Seule écriture possible depuis une session, et elle '
  'exige est_admin(). Idempotente si p_cle est fournie.';

revoke all on function public.ajuster_points_admin(uuid, integer, text, uuid, text) from public;
grant execute on function public.ajuster_points_admin(uuid, integer, text, uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 6. GARDE-FOU : l'état de paiement n'est pas à la main du client
-- ------------------------------------------------------------
-- La migration 106 prépare paiement_statut « sans que rien ne le
-- renseigne encore ». Ce fichier lui donne un EFFET (des points) : il
-- faut donc s'assurer qu'aucune session de client ou de partenaire ne
-- peut le poser. Sans session (fonction serveur, service_role, SQL
-- Editor) ou en administrateur : autorisé. Autrement : refusé.
-- Aucune RLS n'est affaiblie ; c'est une restriction supplémentaire.
create or replace function public.garde_paiement_devis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.est_admin() then
    return new;
  end if;
  if new.paiement_statut      is distinct from old.paiement_statut
     or new.paiement_confirme_le is distinct from old.paiement_confirme_le
     or new.annule_le            is distinct from old.annule_le then
    raise exception 'État de paiement réservé au serveur ou à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_garde_paiement_devis on public.devis;
create trigger trg_garde_paiement_devis
  before update on public.devis
  for each row execute function public.garde_paiement_devis();

revoke all on function public.garde_paiement_devis() from public;

-- ------------------------------------------------------------
-- 7. LES DEUX DÉCLENCHEURS
-- ------------------------------------------------------------
-- 7.1 Devis : paiement → crédit (si terminé) ; remboursement total →
--     contrepassation ; remboursement partiel → intention journalisée ;
--     annulation (annule_le posé) → contrepassation. AFTER UPDATE : les
--     triggers BEFORE existants (version, garde-fou) restent inchangés.
create or replace function public.fidelite_apres_maj_devis()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.paiement_statut is distinct from old.paiement_statut then
    if new.paiement_statut = 'paye' then
      perform public.crediter_points_prestation(new.id);
    elsif new.paiement_statut = 'rembourse' then
      perform public.fidelite_contrepasser_credit(new.id, 'remboursement');
    elsif new.paiement_statut = 'rembourse_partiel' then
      perform public.fidelite_journaliser_remboursement_partiel(new.id);
    end if;
  end if;
  if new.annule_le is not null and old.annule_le is null then
    perform public.fidelite_contrepasser_credit(new.id, 'annulation');
  end if;
  return null;
end $$;

drop trigger if exists trg_fidelite_apres_maj_devis on public.devis;
create trigger trg_fidelite_apres_maj_devis
  after update on public.devis
  for each row execute function public.fidelite_apres_maj_devis();

revoke all on function public.fidelite_apres_maj_devis() from public;

-- 7.2 Missions : passage à « terminee » → crédit de chaque devis PAYÉ de
--     la demande (si toutes ses missions sont terminées). Le trigger ne
--     décide rien : il appelle la même fonction, qui revérifie tout.
create or replace function public.fidelite_apres_maj_mission()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  if new.client_id is null then
    return null;
  end if;
  if new.statut = 'terminee' and old.statut is distinct from 'terminee' then
    for r in
      select dv.id from public.devis dv
       where dv.client_id = new.client_id
         and dv.paiement_statut = 'paye'
    loop
      perform public.crediter_points_prestation(r.id);
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists trg_fidelite_apres_maj_mission on public.missions;
create trigger trg_fidelite_apres_maj_mission
  after update on public.missions
  for each row execute function public.fidelite_apres_maj_mission();

revoke all on function public.fidelite_apres_maj_mission() from public;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from pg_policies where tablename = 'fidelite_mouvements';
--   -- attendu : 2 (lecture client, lecture admin) — aucune écriture
--
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'fidelite_mouvements' and grantee in ('anon', 'authenticated');
--   -- attendu : une seule ligne, SELECT pour authenticated
--
--   select tgname from pg_trigger
--    where tgname in ('trg_fidelite_apres_maj_devis', 'trg_garde_paiement_devis',
--                     'trg_fidelite_apres_maj_mission');
--   -- attendu : 3 lignes
--
--   select public.fidelite_prochain_palier(10000) ->> 'prochain_nom';
--   -- attendu : Box mystère
--
--   -- Depuis la session d'un client : select * from public.v_ma_fidelite;
--   -- attendu : une ligne, solde 0 tant qu'aucune prestation n'est
--   -- terminée ET payée.
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire : sans paiement enregistré, le registre reste vide
--      et rien ne s'affiche de faux.
--   2. Retirer les déclencheurs (les points cessent d'être crédités) :
--        drop trigger if exists trg_fidelite_apres_maj_devis on public.devis;
--        drop trigger if exists trg_fidelite_apres_maj_mission on public.missions;
--        drop trigger if exists trg_garde_paiement_devis on public.devis;
--   3. Retirer la vue et les fonctions :
--        drop view if exists public.v_ma_fidelite;
--        drop function if exists public.fidelite_apres_maj_devis();
--        drop function if exists public.fidelite_apres_maj_mission();
--        drop function if exists public.garde_paiement_devis();
--        drop function if exists public.ajuster_points_admin(uuid, integer, text, uuid, text);
--        drop function if exists public.fidelite_journaliser_remboursement_partiel(uuid);
--        drop function if exists public.fidelite_contrepasser_credit(uuid, text);
--        drop function if exists public.crediter_points_prestation(uuid);
--        drop function if exists public.fidelite_solde();
--        drop function if exists public.fidelite_prochain_palier(integer);
--   4. Retirer le registre (DESTRUCTIF : l'historique des points est perdu) :
--        drop table if exists public.fidelite_mouvements;
