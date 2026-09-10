-- HelixCar — 115 : fermeture des droits hérités signalés par le
-- Database Linter Supabase après application réelle des migrations.
begin;

-- Une fonction SECURITY DEFINER reçoit EXECUTE pour PUBLIC à sa création.
-- On retire ce défaut de toutes les fonctions du schéma, puis on réaccorde
-- uniquement les points d'entrée documentés ci-dessous.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.signature);
  end loop;
end $$;

grant execute on function public.creer_demande_avec_vehicules(jsonb,jsonb,text,text) to anon,authenticated;

grant execute on function public.est_admin() to authenticated;
grant execute on function public.est_proprietaire_convoyeur(uuid) to authenticated;
grant execute on function public.est_proprietaire_demande(uuid) to authenticated;
grant execute on function public.partenaire_actif() to authenticated;
grant execute on function public.est_partenaire_de_mission(uuid) to authenticated;
grant execute on function public.roles_utilisateur() to authenticated;
grant execute on function public.ajouter_role_partenaire(uuid) to authenticated;
grant execute on function public.informations_demande(uuid) to authenticated;
grant execute on function public.repondre_informations_demande(uuid,jsonb) to authenticated;
grant execute on function public.reclamer_demande(uuid,text) to authenticated;
grant execute on function public.mission_photos_completes(uuid) to authenticated;
grant execute on function public.convoyeur_de_session() to authenticated;
grant execute on function public.activites_validees_partenaire() to authenticated;
grant execute on function public.creer_brouillon_opportunite(uuid) to authenticated;
grant execute on function public.modifier_opportunite(uuid,jsonb) to authenticated;
grant execute on function public.publier_opportunite(uuid) to authenticated;
grant execute on function public.postuler_opportunite(uuid) to authenticated;
grant execute on function public.decider_candidature(uuid,text) to authenticated;
grant execute on function public.fidelite_solde() to authenticated;
grant execute on function public.ajuster_points_admin(uuid,integer,text,uuid,text) to authenticated;
grant execute on function public.creer_mission_nettoyage_si_prete(uuid) to authenticated;
grant execute on function public.creer_mission_si_prete(uuid) to authenticated;
grant execute on function public.evaluer_mission(uuid,jsonb,text) to authenticated;

-- Aucun navigateur ne crée directement une mission ou une demande : les RPC
-- atomiques et le traitement serveur du paiement sont les seuls chemins.
drop policy if exists insert_missions on public.missions;
drop policy if exists "clients : depot public" on public.clients;

-- Formulaires publics simples : insertion seulement, aucune relecture.
alter table public.recontacts enable row level security;
alter table public.parrainages enable row level security;
revoke all on public.recontacts,public.parrainages from anon,authenticated;
grant insert on public.recontacts,public.parrainages to anon,authenticated;
drop policy if exists insert_recontacts on public.recontacts;
create policy insert_recontacts on public.recontacts for insert to anon,authenticated with check(true);
drop policy if exists insert_parrainages on public.parrainages;
create policy insert_parrainages on public.parrainages for insert to anon,authenticated with check(true);
drop policy if exists "recontacts : lecture admin" on public.recontacts;
create policy "recontacts : lecture admin" on public.recontacts for select to authenticated using(public.est_admin());
drop policy if exists "recontacts : ecriture admin" on public.recontacts;
create policy "recontacts : ecriture admin" on public.recontacts for update to authenticated using(public.est_admin()) with check(public.est_admin());
drop policy if exists "parrainages : lecture admin" on public.parrainages;
create policy "parrainages : lecture admin" on public.parrainages for select to authenticated using(public.est_admin());
drop policy if exists "parrainages : ecriture admin" on public.parrainages;
create policy "parrainages : ecriture admin" on public.parrainages for update to authenticated using(public.est_admin()) with check(public.est_admin());

-- Tables privées historiques.
alter table public.demandes enable row level security;
alter table public.convoyeurs_rattachement_sauvegarde enable row level security;
alter table public.convoyeurs_rattachement_canonique_sauvegarde enable row level security;
revoke all on public.demandes,public.convoyeurs_rattachement_sauvegarde,
  public.convoyeurs_rattachement_canonique_sauvegarde from anon,authenticated;

-- Factures partenaire : propriétaire en lecture/création, administration en
-- lecture et mise à jour. Les validations/paiements ne sont jamais modifiables
-- par le partenaire.
alter table public.factures_convoyeur enable row level security;
revoke all on public.factures_convoyeur from anon,authenticated;
grant select,insert,update on public.factures_convoyeur to authenticated;
drop policy if exists "factures : lecture admin" on public.factures_convoyeur;
create policy "factures : lecture admin" on public.factures_convoyeur for select to authenticated using(public.est_admin());
drop policy if exists "factures : lecture partenaire" on public.factures_convoyeur;
create policy "factures : lecture partenaire" on public.factures_convoyeur for select to authenticated
  using(public.est_proprietaire_convoyeur(convoyeur_id));
drop policy if exists "factures : creation partenaire" on public.factures_convoyeur;
create policy "factures : creation partenaire" on public.factures_convoyeur for insert to authenticated
  with check(public.est_proprietaire_convoyeur(convoyeur_id) and statut='en_attente');
drop policy if exists "factures : ecriture admin" on public.factures_convoyeur;
create policy "factures : ecriture admin" on public.factures_convoyeur for update to authenticated
  using(public.est_admin()) with check(public.est_admin());

-- États des lieux et documents : seulement l'administration, le partenaire
-- attribué et, en lecture, le client propriétaire de la mission.
alter table public.etats_des_lieux enable row level security;
alter table public.documents enable row level security;
revoke all on public.etats_des_lieux,public.documents from anon,authenticated;
grant select,insert,update on public.etats_des_lieux to authenticated;
grant select,insert on public.documents to authenticated;

drop policy if exists "edl : lecture acteurs" on public.etats_des_lieux;
create policy "edl : lecture acteurs" on public.etats_des_lieux for select to authenticated using(
  public.est_admin() or exists(
    select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id
    left join public.clients cl on cl.id=m.client_id
    where m.id=mission_id and (c.auth_user_id=auth.uid() or cl.auth_user_id=auth.uid())
  ));
drop policy if exists "edl : creation partenaire" on public.etats_des_lieux;
create policy "edl : creation partenaire" on public.etats_des_lieux for insert to authenticated with check(
  exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id
         where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()));
drop policy if exists "edl : ecriture partenaire" on public.etats_des_lieux;
create policy "edl : ecriture partenaire" on public.etats_des_lieux for update to authenticated using(
  public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id
         where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()))
  with check(public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id
         where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()));

drop policy if exists "documents : lecture acteurs" on public.documents;
create policy "documents : lecture acteurs" on public.documents for select to authenticated using(
  public.est_admin() or exists(
    select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id
    left join public.clients cl on cl.id=m.client_id
    where m.id=mission_id and (c.auth_user_id=auth.uid() or cl.auth_user_id=auth.uid())
  ));
drop policy if exists "documents : creation admin partenaire" on public.documents;
create policy "documents : creation admin partenaire" on public.documents for insert to authenticated with check(
  public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id
    where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()));

-- Search path fixé pour toutes les fonctions existantes du schéma public.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
  loop
    execute format('alter function %s set search_path=public,pg_temp',f.signature);
  end loop;
end $$;

commit;
