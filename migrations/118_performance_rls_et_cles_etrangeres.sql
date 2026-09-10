-- HelixCar — 118 : index des clés étrangères et init-plan RLS
-- Additive et idempotente. Aucune permission ni règle métier modifiée.

do $$ begin
  if to_regclass('public.convoyeur_decisions') is not null then execute 'create index if not exists convoyeur_decisions_decide_par_fkey_idx on public.convoyeur_decisions(decide_par)'; end if;
  if to_regclass('public.convoyeur_decisions_historique') is not null then execute 'create index if not exists convoyeur_decisions_historique_modifie_par_fkey_idx on public.convoyeur_decisions_historique(modifie_par)'; end if;
  if to_regclass('public.convoyeurs') is not null then execute 'create index if not exists convoyeurs_bloque_par_fkey_idx on public.convoyeurs(bloque_par)'; end if;
  if to_regclass('public.convoyeurs_rattachement_canonique_sauvegarde') is not null then execute 'create index if not exists convoyeurs_rattachement_canonique_auth_apres_idx on public.convoyeurs_rattachement_canonique_sauvegarde(auth_user_id_apres)'; end if;
  if to_regclass('public.demande_informations_manquantes') is not null then execute 'create index if not exists demande_infos_validee_par_fkey_idx on public.demande_informations_manquantes(validee_par)'; end if;
  if to_regclass('public.devis') is not null then execute 'create index if not exists devis_accepte_par_fkey_idx on public.devis(accepte_par)'; execute 'create index if not exists devis_refuse_par_fkey_idx on public.devis(refuse_par)'; end if;
  if to_regclass('public.devis_envoi_operations') is not null then execute 'create index if not exists devis_envoi_operations_auteur_fkey_idx on public.devis_envoi_operations(auteur)'; end if;
  if to_regclass('public.devis_envois') is not null then execute 'create index if not exists devis_envois_auteur_fkey_idx on public.devis_envois(auteur)'; end if;
  if to_regclass('public.documents') is not null then execute 'create index if not exists documents_mission_id_fkey_idx on public.documents(mission_id)'; end if;
  if to_regclass('public.etats_des_lieux') is not null then execute 'create index if not exists etats_des_lieux_mission_id_fkey_idx on public.etats_des_lieux(mission_id)'; end if;
  if to_regclass('public.evaluations') is not null then execute 'create index if not exists evaluations_client_id_fkey_idx on public.evaluations(client_id)'; end if;
  if to_regclass('public.factures_convoyeur') is not null then execute 'create index if not exists factures_convoyeur_convoyeur_id_fkey_idx on public.factures_convoyeur(convoyeur_id)'; end if;
  if to_regclass('public.fidelite_mouvements') is not null then execute 'create index if not exists fidelite_mouvements_client_id_fkey_idx on public.fidelite_mouvements(client_id)'; execute 'create index if not exists fidelite_mouvements_cree_par_fkey_idx on public.fidelite_mouvements(cree_par)'; end if;
  if to_regclass('public.mission_photos') is not null then execute 'create index if not exists mission_photos_ajoutee_par_fkey_idx on public.mission_photos(ajoutee_par)'; end if;
  if to_regclass('public.missions') is not null then execute 'create index if not exists missions_convoyeur_id_fkey_idx on public.missions(convoyeur_id)'; execute 'create index if not exists missions_prestation_validee_par_fkey_idx on public.missions(prestation_validee_par)'; end if;
  if to_regclass('public.opportunite_candidatures') is not null then execute 'create index if not exists opportunite_candidatures_decidee_par_fkey_idx on public.opportunite_candidatures(decidee_par)'; end if;
  if to_regclass('public.opportunite_notifications') is not null then execute 'create index if not exists opportunite_notifications_convoyeur_id_fkey_idx on public.opportunite_notifications(convoyeur_id)'; end if;
  if to_regclass('public.opportunites') is not null then execute 'create index if not exists opportunites_created_by_fkey_idx on public.opportunites(created_by)'; end if;
  if to_regclass('public.parrainages') is not null then execute 'create index if not exists parrainages_parrain_id_fkey_idx on public.parrainages(parrain_id)'; end if;
  if to_regclass('public.video_verifications') is not null then execute 'create index if not exists video_verifications_convoyeur_id_fkey_idx on public.video_verifications(convoyeur_id)'; end if;
end $$;

-- auth.uid() et les helpers stables sont évalués une fois par requête.
alter policy admins_lecture_soi_meme on public.admins using (auth_user_id = (select auth.uid()));
alter policy "convoyeurs : lecture par le proprietaire" on public.convoyeurs using (auth_user_id = (select auth.uid()));
alter policy "convoyeurs : mise a jour par le proprietaire non bloque" on public.convoyeurs
  using (auth_user_id = (select auth.uid()) and bloque is false)
  with check (auth_user_id = (select auth.uid()) and bloque is false);
alter policy devis_admin_select on public.devis using (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true));
alter policy devis_admin_insert on public.devis with check (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true));
alter policy devis_admin_update on public.devis
  using (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true))
  with check (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true));
alter policy "documents : creation admin partenaire" on public.documents
  with check ((select public.est_admin()) or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=documents.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())));
alter policy "documents : lecture acteurs" on public.documents
  using ((select public.est_admin()) or exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id where m.id=documents.mission_id and (c.auth_user_id=(select auth.uid()) or cl.auth_user_id=(select auth.uid()))));
alter policy "edl : creation partenaire" on public.etats_des_lieux
  with check (exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=etats_des_lieux.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())));
alter policy "edl : ecriture partenaire" on public.etats_des_lieux
  using ((select public.est_admin()) or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=etats_des_lieux.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())))
  with check ((select public.est_admin()) or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=etats_des_lieux.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())));
alter policy "edl : lecture acteurs" on public.etats_des_lieux
  using ((select public.est_admin()) or exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id where m.id=etats_des_lieux.mission_id and (c.auth_user_id=(select auth.uid()) or cl.auth_user_id=(select auth.uid()))));
alter policy "evaluations : lecture par le partenaire evalue" on public.evaluations
  using (exists(select 1 from public.convoyeurs c where c.id=evaluations.convoyeur_id and c.auth_user_id=(select auth.uid())));
alter policy "evaluations : lecture par son auteur" on public.evaluations using (auth_user_id=(select auth.uid()));
alter policy "fidelite : lecture client" on public.fidelite_mouvements using (auth_user_id=(select auth.uid()));
alter policy "missions : lecture partenaire actif" on public.missions
  using ((select public.partenaire_actif()) and (convoyeur_id is null or exists(select 1 from public.convoyeurs c where c.id=missions.convoyeur_id and c.auth_user_id=(select auth.uid()))));
alter policy "missions : mise a jour partenaire actif" on public.missions
  using ((select public.partenaire_actif()) and (convoyeur_id is null or exists(select 1 from public.convoyeurs c where c.id=missions.convoyeur_id and c.auth_user_id=(select auth.uid()))))
  with check ((select public.partenaire_actif()));

