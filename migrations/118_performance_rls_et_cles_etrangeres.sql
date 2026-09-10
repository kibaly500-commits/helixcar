-- HelixCar — 118 : index des clés étrangères et init-plan RLS
-- Additive et idempotente. Aucune permission ni règle métier modifiée.

do $$
declare r record;
begin
  for r in
    select c.conname, n.nspname, t.relname,
           (select string_agg(format('%I',a.attname),', ' order by u.ord)
              from unnest(c.conkey) with ordinality u(attnum,ord)
              join pg_attribute a on a.attrelid=t.oid and a.attnum=u.attnum) as colonnes
      from pg_constraint c
      join pg_class t on t.oid=c.conrelid
      join pg_namespace n on n.oid=t.relnamespace
     where c.contype='f' and n.nspname='public'
       and not exists (
         select 1 from pg_index i
          where i.indrelid=t.oid and i.indisvalid
            and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey)
  loop
    execute format('create index if not exists %I on %I.%I (%s)',
      left(r.conname || '_idx',63),r.nspname,r.relname,r.colonnes);
  end loop;
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
