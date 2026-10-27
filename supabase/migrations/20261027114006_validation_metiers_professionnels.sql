begin;
create or replace function public.activite_du_metier(p_metier text) returns text
language sql immutable set search_path=public,pg_temp as $$
 select case when p_metier in ('convoyage','nettoyage') then p_metier
 when p_metier in ('jockey','accueil_preparation','soutien_administratif') then 'renfort'
 when p_metier in ('mecanique','carrosserie','diagnostic') then 'technicien' end
$$;

create table public.professionnel_badges (
 professionnel_id uuid not null references public.convoyeurs(id) on delete cascade,
 metier text not null check(metier=any(public.metiers_partenaire())),
 decision text not null default 'en_attente' check(decision in ('en_attente','oui','non')),
 demande_le timestamptz not null default now(),
 decide_le timestamptz,
 decide_par uuid references auth.users(id),
 primary key(professionnel_id,metier)
);
alter table public.professionnel_badges enable row level security;
revoke all on public.professionnel_badges from anon,authenticated;
grant select on public.professionnel_badges to authenticated;
create policy badges_lecture on public.professionnel_badges for select to authenticated
using (public.est_admin() or exists(select 1 from public.convoyeurs c where c.id=professionnel_id and c.auth_user_id=auth.uid()));
-- Reprise des décisions existantes uniquement sur les métiers déjà déclarés.
insert into public.professionnel_badges(professionnel_id,metier,decision,decide_le,decide_par)
select c.id,m,coalesce(d.decision,'en_attente'),d.decide_le,d.decide_par
from public.convoyeurs c cross join lateral unnest(c.metiers) m
left join public.convoyeur_decisions d on d.convoyeur_id=c.id and d.activite=public.activite_du_metier(m);

create or replace function private.synchroniser_metiers_professionnel() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.metiers is not null and cardinality(new.metiers)>0 then
  select array_agg(distinct public.activite_du_metier(m)) into new.activites from unnest(new.metiers) m;
 end if;
 return new;
end $$;
revoke all on function private.synchroniser_metiers_professionnel() from public,anon,authenticated;
create trigger synchroniser_metiers_professionnel before insert or update of metiers,activites on public.convoyeurs
for each row execute function private.synchroniser_metiers_professionnel();

create or replace function private.initialiser_badges_professionnel() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.professionnel_badges(professionnel_id,metier)
 select new.id,m from unnest(new.metiers) m on conflict do nothing;
 return new;
end $$;
revoke all on function private.initialiser_badges_professionnel() from public,anon,authenticated;
create trigger initialiser_badges_professionnel after insert or update of metiers on public.convoyeurs
for each row execute function private.initialiser_badges_professionnel();

create or replace function public.demander_badges_professionnel(p_metiers text[]) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.convoyeurs;
begin
 if auth.uid() is null then raise exception 'Connexion requise'; end if;
 if p_metiers is null or cardinality(p_metiers)=0 or cardinality(p_metiers)>8
 or array_position(p_metiers,null) is not null or not(p_metiers <@ public.metiers_partenaire()) then raise exception 'Métiers invalides'; end if;
 select * into c from public.convoyeurs where id=public.convoyeur_de_session() and auth_user_id=auth.uid() and statut='actif' and bloque is false for update;
 if c.id is null then raise exception 'Compte professionnel actif requis'; end if;
 update public.convoyeurs set metiers=(select array_agg(distinct m) from unnest(coalesce(c.metiers,'{}')||p_metiers) m) where id=c.id;
 -- Une demande répétée ne modifie jamais une décision, y compris un refus.
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.demander_badges_professionnel(text[]) from public,anon;
grant execute on function public.demander_badges_professionnel(text[]) to authenticated;

create or replace function public.decider_badge_professionnel(p_professionnel uuid,p_metier text,p_decision text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare ancienne text;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Administration requise'; end if;
 if p_decision not in ('oui','non','en_attente') or p_decision is null then raise exception 'Décision invalide'; end if;
 select decision into ancienne from public.professionnel_badges where professionnel_id=p_professionnel and metier=p_metier for update;
 if not found then raise exception 'Badge non demandé'; end if;
 if ancienne=p_decision then return; end if;
 update public.professionnel_badges set decision=p_decision,decide_le=now(),decide_par=auth.uid()
 where professionnel_id=p_professionnel and metier=p_metier;
 insert into public.convoyeur_decisions_historique(convoyeur_id,activite,ancienne_decision,nouvelle_decision,modifie_par)
 values(p_professionnel,p_metier,ancienne,p_decision,auth.uid());
end $$;
revoke all on function public.decider_badge_professionnel(uuid,text,text) from public,anon;
grant execute on function public.decider_badge_professionnel(uuid,text,text) to authenticated;

create or replace function public.activites_validees_partenaire() returns text[]
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(array_agg(distinct a),'{}'::text[]) from (
 select public.activite_du_metier(b.metier) a from public.convoyeurs c
 join public.professionnel_badges b on b.professionnel_id=c.id
 where c.auth_user_id=auth.uid() and c.statut='actif' and c.bloque is false and b.decision='oui'
 and b.metier=any(c.metiers)
 union
 -- Compatibilité des dossiers historiques sans métier déclaré, sans créer de badge implicite.
 select d.activite from public.convoyeurs c join public.convoyeur_decisions d on d.convoyeur_id=c.id
 where c.auth_user_id=auth.uid() and c.statut='actif' and c.bloque is false and d.decision='oui'
 and coalesce(cardinality(c.metiers),0)=0
 ) x
$$;

create or replace function public.badge_autorise_mission(p_mission uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.missions m
 left join public.clients cl on cl.id=m.client_id
 join public.convoyeurs c on c.auth_user_id=auth.uid()
 where m.id=p_mission and c.statut='actif' and c.bloque is false and (
 case when m.type_mission='professionnel' then
 exists(select 1 from public.professionnel_badges b where b.professionnel_id=c.id and b.decision='oui'
 and b.metier=any(c.metiers)
 and b.metier=coalesce(nullif(cl.professionnel_details->>'specialite',''),cl.professionnel_details->>'mission'))
 else m.type_mission=any(public.activites_validees_partenaire()) end))
$$;
revoke all on function public.badge_autorise_mission(uuid) from public,anon;
grant execute on function public.badge_autorise_mission(uuid) to authenticated;
-- Conserve tous les filtres de confidentialité, de paiement et d'attribution existants.
do $$ declare def text; begin
 select pg_get_viewdef('public.v_opportunites_partenaire'::regclass,true) into def;
 execute 'create or replace view public.v_opportunites_partenaire as '||rtrim(btrim(def),';')||' AND public.badge_autorise_mission(o.mission_id)';
end $$;
create policy missions_metier_disponibilite on public.missions as restrictive for select to authenticated
using(public.est_admin() or convoyeur_id=public.convoyeur_de_session() or public.retenu_preparation_mission(id)
 or (convoyeur_id is null and public.badge_autorise_mission(id)));

create or replace function private.garder_badge_candidature() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is not null and not public.est_admin() and not exists(
 select 1 from public.opportunites o where o.id=new.opportunite_id and public.badge_autorise_mission(o.mission_id)) then
 raise exception 'Un badge validé correspondant à ce métier est requis'; end if;
 return new;
end $$;
revoke all on function private.garder_badge_candidature() from public,anon,authenticated;
create trigger garder_badge_candidature before insert on public.opportunite_candidatures
for each row execute function private.garder_badge_candidature();

create or replace function private.signaler_badge_professionnel() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare uid uuid;
begin
 select auth_user_id into uid from public.convoyeurs where id=coalesce(new.professionnel_id,old.professionnel_id);
 perform realtime.send('{}'::jsonb,'changed','hc:admin',true);
 if uid is not null then perform realtime.send('{}'::jsonb,'changed','hc:user:'||uid::text,true); end if;
 return null;
exception when others then return null; -- Une panne de notification ne bloque jamais une décision.
end $$;
revoke all on function private.signaler_badge_professionnel() from public,anon,authenticated;
create trigger signaler_badge_professionnel after insert or update or delete on public.professionnel_badges
for each row execute function private.signaler_badge_professionnel();

notify pgrst,'reload schema';
commit;
