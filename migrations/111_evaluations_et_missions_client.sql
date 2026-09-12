-- ============================================================
-- HelixCar — 111 : évaluations réelles des missions par le client,
--                  et la vue de SES missions (lot D01)
-- ============================================================
-- Dépend de : 00_helpers.sql (est_admin), 06_informations_manquantes.sql
--             (clients.auth_user_id, principe de v_mes_demandes),
--             90_durcissement_rls_partenaires.sql (RLS de missions),
--             96_missions_nettoyage.sql (missions.type_mission et
--             colonnes d'intervention), 97_missions_verrou_serveur.sql
--             (« terminee » réservé à l'administrateur).
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : une table fermée par RLS, une fonction, une vue.
-- Aucune donnée existante modifiée, aucune RLS affaiblie.
--
-- LES MIGRATIONS 00 À 110 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- CE QUI ÉTAIT CONSTATÉ (D01-021..024)
-- ------------------------------------------------------------
-- La page « Évaluer » du Dashboard client était une démonstration :
-- mission, partenaire et date écrits en dur, et un écran « Évaluation
-- envoyée ! » affiché SANS AUCUNE écriture. Aucune table d'évaluation
-- n'existait, et l'espace client ne lisait jamais ses missions.
--
-- ------------------------------------------------------------
-- CE QUE FAIT CETTE MIGRATION
-- ------------------------------------------------------------
--   * public.evaluations : UNE évaluation par mission (index unique),
--     liée à la mission, à la demande, au compte client qui l'a écrite
--     et au partenaire. Lecture : le client pour les siennes, le
--     partenaire pour celles qui le concernent, l'administrateur pour
--     toutes. AUCUNE écriture directe depuis le navigateur : seule
--     evaluer_mission() écrit, après avoir vérifié la propriété de la
--     mission et son état « terminee ».
--   * public.v_mes_missions : les missions des demandes du compte de la
--     session, avec le prénom du partenaire, l'état, et si elles sont
--     déjà évaluées. Jamais les missions d'un autre compte, jamais les
--     colonnes internes (rémunération, validation de paiement…).
--   * Le barème est celui déjà présenté au client : ponctualité /4,
--     retard /4, état du véhicule /4, communication /3,
--     professionnalisme /3, tenue /2, soit /20. Le total est calculé
--     par le serveur, jamais reçu du navigateur.

-- ------------------------------------------------------------
-- 1. LA TABLE
-- ------------------------------------------------------------
create table if not exists public.evaluations (
  id            uuid primary key default gen_random_uuid(),
  mission_id    uuid not null references public.missions(id) on delete cascade,
  client_id     uuid references public.clients(id) on delete set null,
  auth_user_id  uuid not null references auth.users(id),
  convoyeur_id  uuid references public.convoyeurs(id) on delete set null,
  notes         jsonb not null,
  note_totale   integer not null check (note_totale between 0 and 20),
  commentaire   text check (commentaire is null or char_length(commentaire) <= 1000),
  created_at    timestamptz not null default now(),
  unique (mission_id)
);

comment on table public.evaluations is
  'Évaluation d''une mission par le client : une seule par mission, '
  'écrite uniquement par evaluer_mission() sur une mission terminée '
  'appartenant au compte de la session. Barème /20 calculé par le serveur.';

create index if not exists evaluations_compte_idx
  on public.evaluations (auth_user_id, created_at desc);
create index if not exists evaluations_convoyeur_idx
  on public.evaluations (convoyeur_id, created_at desc);

revoke all on public.evaluations from anon;
revoke all on public.evaluations from authenticated;
grant select on public.evaluations to authenticated;
alter table public.evaluations enable row level security;

drop policy if exists "evaluations : lecture par son auteur" on public.evaluations;
create policy "evaluations : lecture par son auteur"
  on public.evaluations for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists "evaluations : lecture par le partenaire evalue" on public.evaluations;
create policy "evaluations : lecture par le partenaire evalue"
  on public.evaluations for select to authenticated
  using (exists (select 1 from public.convoyeurs c
                  where c.id = evaluations.convoyeur_id
                    and c.auth_user_id = auth.uid()));

drop policy if exists "evaluations : lecture admin" on public.evaluations;
create policy "evaluations : lecture admin"
  on public.evaluations for select to authenticated
  using (public.est_admin());

-- ------------------------------------------------------------
-- 2. LA SEULE ÉCRITURE : evaluer_mission()
-- ------------------------------------------------------------
create or replace function public.evaluer_mission(
  p_mission_id  uuid,
  p_notes       jsonb,
  p_commentaire text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m         public.missions%rowtype;
  v_client  uuid;
  v_total   integer := 0;
  v_val     integer;
  v_cle     text;
  v_max     integer;
  v_id      uuid;
  v_com     text;
  bareme    jsonb := '{"ponctualite":4,"retard":4,"etat":4,"communication":3,"professionnalisme":3,"tenue":2}'::jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTHENTIFIE');
  end if;
  select * into m from public.missions where id = p_mission_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;
  -- La mission appartient à une demande du compte de la session.
  select c.id into v_client
    from public.clients c
   where c.id = m.client_id and c.auth_user_id = auth.uid();
  if v_client is null then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  -- « terminee » n'est posé que par l'administrateur (migration 97) :
  -- on n'évalue qu'une prestation réellement terminée.
  if m.statut is distinct from 'terminee' then
    return jsonb_build_object('ok', false, 'code', 'MISSION_NON_TERMINEE', 'statut', m.statut);
  end if;
  -- Le barème complet, chaque critère entier dans ses bornes. Le total
  -- est calculé ICI.
  if p_notes is null or jsonb_typeof(p_notes) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'NOTES_INVALIDES');
  end if;
  for v_cle, v_max in select key, value::integer from jsonb_each_text(bareme) loop
    if not (p_notes ? v_cle) then
      return jsonb_build_object('ok', false, 'code', 'NOTES_INVALIDES', 'critere', v_cle);
    end if;
    begin
      v_val := (p_notes ->> v_cle)::integer;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'NOTES_INVALIDES', 'critere', v_cle);
    end;
    if v_val is null or v_val < 0 or v_val > v_max then
      return jsonb_build_object('ok', false, 'code', 'NOTES_INVALIDES', 'critere', v_cle);
    end if;
    v_total := v_total + v_val;
  end loop;
  v_com := nullif(btrim(coalesce(p_commentaire, '')), '');
  if v_com is not null and char_length(v_com) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'COMMENTAIRE_TROP_LONG');
  end if;

  insert into public.evaluations
    (mission_id, client_id, auth_user_id, convoyeur_id, notes, note_totale, commentaire)
  values
    (m.id, v_client, auth.uid(), m.convoyeur_id,
     (select jsonb_object_agg(key, (p_notes ->> key)::integer) from jsonb_each_text(bareme)),
     v_total, v_com)
  on conflict (mission_id) do nothing
  returning id into v_id;
  if v_id is null then
    select e.id into v_id from public.evaluations e where e.mission_id = m.id;
    return jsonb_build_object('ok', true, 'code', 'DEJA_EVALUEE', 'id', v_id);
  end if;
  return jsonb_build_object('ok', true, 'code', 'ENREGISTREE', 'id', v_id, 'note_totale', v_total);
end $$;

revoke all on function public.evaluer_mission(uuid, jsonb, text) from public;
grant execute on function public.evaluer_mission(uuid, jsonb, text) to authenticated;

comment on function public.evaluer_mission(uuid, jsonb, text) is
  'Enregistre l''évaluation d''une mission terminée par le client qui la '
  'possède, une seule fois (DEJA_EVALUEE ensuite). Barème /20 vérifié et '
  'totalisé par le serveur.';

-- ------------------------------------------------------------
-- 3. LA VUE CLIENT : SES MISSIONS
-- ------------------------------------------------------------
create or replace view public.v_mes_missions as
select
  m.id,
  m.reference,
  m.type_mission,
  m.statut,
  m.client_id,
  m.convoyeur_id,
  cv.prenom               as convoyeur_prenom,
  m.ville_depart,
  m.ville_arrivee,
  m.ville_intervention,
  m.date_prise_en_charge,
  m.date_livraison,
  m.date_intervention,
  m.date_fin_intervention,
  m.prestation,
  m.nb_vehicules,
  m.prix_ttc,
  m.created_at,
  (e.id is not null)      as evaluee,
  e.id                    as evaluation_id,
  e.note_totale           as evaluation_note,
  e.created_at            as evaluee_le
from public.missions m
join public.clients c on c.id = m.client_id
left join public.convoyeurs cv on cv.id = m.convoyeur_id
left join public.evaluations e on e.mission_id = m.id
where c.auth_user_id = auth.uid();

alter view public.v_mes_missions set (security_invoker = off);
revoke all on public.v_mes_missions from anon;
revoke all on public.v_mes_missions from authenticated;
grant select on public.v_mes_missions to authenticated;

comment on view public.v_mes_missions is
  'Missions des demandes du compte de la session : référence, état, '
  'lieux, dates, prénom du partenaire, prix client, et si la mission est '
  'déjà évaluée. Aucune colonne interne. Vide sans session.';

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from pg_policies where tablename = 'evaluations';
--   -- attendu : 3 (auteur, partenaire évalué, admin) — aucune écriture
--   select privilege_type from information_schema.role_table_grants
--    where table_name = 'evaluations' and grantee in ('anon','authenticated');
--   -- attendu : une seule ligne, SELECT pour authenticated
--   -- Depuis la session d'un client : select * from public.v_mes_missions;
--   -- attendu : ses missions seulement, evaluee = false tant qu'il n'a rien évalué.
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire : une table vide et une vue n'ont aucun effet.
--   2. Retirer la vue et la fonction :
--        drop view if exists public.v_mes_missions;
--        drop function if exists public.evaluer_mission(uuid, jsonb, text);
--   3. Retirer la table (DESTRUCTIF : les évaluations sont perdues) :
--        drop table if exists public.evaluations;
