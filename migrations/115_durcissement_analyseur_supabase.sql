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

-- Certains environnements historiques n'ont pas toutes ces tables. Chaque bloc
-- est donc autonome : une table absente n'annule jamais le durcissement global.
do $$
begin
  if to_regclass('public.recontacts') is not null then
    execute 'alter table public.recontacts enable row level security';
    execute 'revoke all on public.recontacts from anon,authenticated';
    execute 'grant insert on public.recontacts to anon,authenticated';
    execute 'drop policy if exists insert_recontacts on public.recontacts';
    execute 'create policy insert_recontacts on public.recontacts for insert to anon,authenticated with check(true)';
    execute 'drop policy if exists "recontacts : lecture admin" on public.recontacts';
    execute 'create policy "recontacts : lecture admin" on public.recontacts for select to authenticated using(public.est_admin())';
    execute 'drop policy if exists "recontacts : ecriture admin" on public.recontacts';
    execute 'create policy "recontacts : ecriture admin" on public.recontacts for update to authenticated using(public.est_admin()) with check(public.est_admin())';
  end if;
  if to_regclass('public.parrainages') is not null then
    execute 'alter table public.parrainages enable row level security';
    execute 'revoke all on public.parrainages from anon,authenticated';
    execute 'grant insert on public.parrainages to anon,authenticated';
    execute 'drop policy if exists insert_parrainages on public.parrainages';
    execute 'create policy insert_parrainages on public.parrainages for insert to anon,authenticated with check(true)';
    execute 'drop policy if exists "parrainages : lecture admin" on public.parrainages';
    execute 'create policy "parrainages : lecture admin" on public.parrainages for select to authenticated using(public.est_admin())';
    execute 'drop policy if exists "parrainages : ecriture admin" on public.parrainages';
    execute 'create policy "parrainages : ecriture admin" on public.parrainages for update to authenticated using(public.est_admin()) with check(public.est_admin())';
  end if;
end $$;

do $$
declare nom text;
begin
  foreach nom in array array['demandes','convoyeurs_rattachement_sauvegarde','convoyeurs_rattachement_canonique_sauvegarde'] loop
    if to_regclass('public.'||nom) is not null then
      execute format('alter table public.%I enable row level security',nom);
      execute format('revoke all on public.%I from anon,authenticated',nom);
    end if;
  end loop;
end $$;

do $$
begin
  if to_regclass('public.factures_convoyeur') is not null then
    execute 'alter table public.factures_convoyeur enable row level security';
    execute 'revoke all on public.factures_convoyeur from anon,authenticated';
    execute 'grant select,insert,update on public.factures_convoyeur to authenticated';
    execute 'drop policy if exists "factures : lecture admin" on public.factures_convoyeur';
    execute 'create policy "factures : lecture admin" on public.factures_convoyeur for select to authenticated using(public.est_admin())';
    execute 'drop policy if exists "factures : lecture partenaire" on public.factures_convoyeur';
    execute 'create policy "factures : lecture partenaire" on public.factures_convoyeur for select to authenticated using(public.est_proprietaire_convoyeur(convoyeur_id))';
    execute 'drop policy if exists "factures : creation partenaire" on public.factures_convoyeur';
    execute 'create policy "factures : creation partenaire" on public.factures_convoyeur for insert to authenticated with check(public.est_proprietaire_convoyeur(convoyeur_id) and statut=''en_attente'')';
    execute 'drop policy if exists "factures : ecriture admin" on public.factures_convoyeur';
    execute 'create policy "factures : ecriture admin" on public.factures_convoyeur for update to authenticated using(public.est_admin()) with check(public.est_admin())';
  end if;
end $$;

do $$
begin
  if to_regclass('public.etats_des_lieux') is not null then
    execute 'alter table public.etats_des_lieux enable row level security';
    execute 'revoke all on public.etats_des_lieux from anon,authenticated';
    execute 'grant select,insert,update on public.etats_des_lieux to authenticated';
    execute 'drop policy if exists "edl : lecture acteurs" on public.etats_des_lieux';
    execute $p$create policy "edl : lecture acteurs" on public.etats_des_lieux for select to authenticated using(public.est_admin() or exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id where m.id=mission_id and (c.auth_user_id=auth.uid() or cl.auth_user_id=auth.uid())))$p$;
    execute 'drop policy if exists "edl : creation partenaire" on public.etats_des_lieux';
    execute $p$create policy "edl : creation partenaire" on public.etats_des_lieux for insert to authenticated with check(exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()))$p$;
    execute 'drop policy if exists "edl : ecriture partenaire" on public.etats_des_lieux';
    execute $p$create policy "edl : ecriture partenaire" on public.etats_des_lieux for update to authenticated using(public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif())) with check(public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()))$p$;
  end if;
  if to_regclass('public.documents') is not null then
    execute 'alter table public.documents enable row level security';
    execute 'revoke all on public.documents from anon,authenticated';
    execute 'grant select,insert on public.documents to authenticated';
    execute 'drop policy if exists "documents : lecture acteurs" on public.documents';
    execute $p$create policy "documents : lecture acteurs" on public.documents for select to authenticated using(public.est_admin() or exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id where m.id=mission_id and (c.auth_user_id=auth.uid() or cl.auth_user_id=auth.uid())))$p$;
    execute 'drop policy if exists "documents : creation admin partenaire" on public.documents';
    execute $p$create policy "documents : creation admin partenaire" on public.documents for insert to authenticated with check(public.est_admin() or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=mission_id and c.auth_user_id=auth.uid() and public.partenaire_actif()))$p$;
  end if;
end $$;

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
