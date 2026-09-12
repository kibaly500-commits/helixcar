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
-- Certaines installations historiques n'ont pas toutes ces politiques. Une
-- politique absente est ignorée : cette migration optimise l'existant sans
-- créer de droit ni modifier le périmètre d'une installation plus ancienne.
do $$
declare r record;
begin
  for r in select * from (values
    ('admins','admins_lecture_soi_meme','using (auth_user_id = (select auth.uid()))'),
    ('convoyeurs','convoyeurs : lecture par le proprietaire','using (auth_user_id = (select auth.uid()))'),
    ('convoyeurs','convoyeurs : mise a jour par le proprietaire non bloque','using (auth_user_id = (select auth.uid()) and bloque is false) with check (auth_user_id = (select auth.uid()) and bloque is false)'),
    ('devis','devis_admin_select','using (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true))'),
    ('devis','devis_admin_insert','with check (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true))'),
    ('devis','devis_admin_update','using (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true)) with check (exists(select 1 from public.admins a where a.auth_user_id=(select auth.uid()) and a.actif=true))'),
    ('documents','documents : creation admin partenaire','with check ((select public.est_admin()) or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=documents.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())))'),
    ('documents','documents : lecture acteurs','using ((select public.est_admin()) or exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id where m.id=documents.mission_id and (c.auth_user_id=(select auth.uid()) or cl.auth_user_id=(select auth.uid()))))'),
    ('etats_des_lieux','edl : creation partenaire','with check (exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=etats_des_lieux.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())))'),
    ('etats_des_lieux','edl : ecriture partenaire','using ((select public.est_admin()) or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=etats_des_lieux.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif()))) with check ((select public.est_admin()) or exists(select 1 from public.missions m join public.convoyeurs c on c.id=m.convoyeur_id where m.id=etats_des_lieux.mission_id and c.auth_user_id=(select auth.uid()) and (select public.partenaire_actif())))'),
    ('etats_des_lieux','edl : lecture acteurs','using ((select public.est_admin()) or exists(select 1 from public.missions m left join public.convoyeurs c on c.id=m.convoyeur_id left join public.clients cl on cl.id=m.client_id where m.id=etats_des_lieux.mission_id and (c.auth_user_id=(select auth.uid()) or cl.auth_user_id=(select auth.uid()))))'),
    ('evaluations','evaluations : lecture par le partenaire evalue','using (exists(select 1 from public.convoyeurs c where c.id=evaluations.convoyeur_id and c.auth_user_id=(select auth.uid())))'),
    ('evaluations','evaluations : lecture par son auteur','using (auth_user_id=(select auth.uid()))'),
    ('fidelite_mouvements','fidelite : lecture client','using (auth_user_id=(select auth.uid()))'),
    ('missions','missions : lecture partenaire actif','using ((select public.partenaire_actif()) and (convoyeur_id is null or exists(select 1 from public.convoyeurs c where c.id=missions.convoyeur_id and c.auth_user_id=(select auth.uid()))))'),
    ('missions','missions : mise a jour partenaire actif','using ((select public.partenaire_actif()) and (convoyeur_id is null or exists(select 1 from public.convoyeurs c where c.id=missions.convoyeur_id and c.auth_user_id=(select auth.uid())))) with check ((select public.partenaire_actif()))')
  ) as p(table_name, policy_name, clauses)
  loop
    if exists (
      select 1
        from pg_policy pol
        join pg_class cls on cls.oid=pol.polrelid
        join pg_namespace nsp on nsp.oid=cls.relnamespace
       where nsp.nspname='public' and cls.relname=r.table_name
         and pol.polname=r.policy_name
    ) then
      execute format('alter policy %I on public.%I %s',
        r.policy_name,r.table_name,r.clauses);
    end if;
  end loop;
end $$;
