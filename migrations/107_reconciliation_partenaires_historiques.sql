-- HelixCar — 107 : rattachement prudent des fiches partenaires historiques.
--
-- Plusieurs anciennes fiches peuvent partager l'adresse d'une seule identité
-- Auth. Elles ne sont jamais supprimées ni fusionnées automatiquement. Si une
-- seule fiche porte déjà un historique métier (mission ou facture), elle seule
-- devient la fiche canonique de l'identité. Les autres lignes restent visibles
-- par l'administration. Une sauvegarde permet d'auditer et de revenir sur le
-- rattachement.
begin;

create table if not exists public.convoyeurs_rattachement_canonique_sauvegarde (
  convoyeur_id uuid primary key references public.convoyeurs(id),
  auth_user_id_avant uuid,
  auth_user_id_apres uuid not null references auth.users(id),
  raison text not null,
  rattache_le timestamptz not null default now()
);

revoke all on public.convoyeurs_rattachement_canonique_sauvegarde
  from public, anon, authenticated;

create temporary table hc_partenaire_historique on commit drop as
select c.id as convoyeur_id,
       (select count(*) from public.missions m where m.convoyeur_id = c.id)::bigint as missions,
       0::bigint as factures
from public.convoyeurs c;

do $$
begin
  if to_regclass('public.factures_convoyeur') is not null then
    execute $q$
      update hc_partenaire_historique h
         set factures=(select count(*) from public.factures_convoyeur f
                       where f.convoyeur_id=h.convoyeur_id)
    $q$;
  end if;
end $$;

with candidats as (
  select
    c.id as convoyeur_id,
    u.id as auth_user_id,
    h.missions,
    h.factures,
    row_number() over (
      partition by u.id
      order by
        h.missions desc,
        h.factures desc,
        c.created_at asc,
        c.id asc
    ) as rang,
    count(*) over (partition by u.id) as nb_fiches
  from public.convoyeurs c
  join hc_partenaire_historique h on h.convoyeur_id=c.id
  join auth.users u on lower(trim(u.email)) = lower(trim(c.email))
  where c.auth_user_id is null
), selection as (
  select * from candidats
  where nb_fiches > 1
    and rang = 1
    and (missions > 0 or factures > 0)
), trace as (
  insert into public.convoyeurs_rattachement_canonique_sauvegarde
    (convoyeur_id, auth_user_id_avant, auth_user_id_apres, raison)
  select convoyeur_id, null, auth_user_id, 'fiche portant historique métier'
  from selection
  on conflict (convoyeur_id) do nothing
  returning convoyeur_id
)
update public.convoyeurs c
set auth_user_id = s.auth_user_id
from selection s
where c.id = s.convoyeur_id
  and c.auth_user_id is null
  and not exists (
    select 1 from public.convoyeurs x
    where x.auth_user_id = s.auth_user_id
      and x.statut is distinct from 'refuse'
  );

commit;
