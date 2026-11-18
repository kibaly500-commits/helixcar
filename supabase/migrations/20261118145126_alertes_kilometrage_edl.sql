-- Immutable comparison snapshot created in the same transaction as the arrival EDL.
create table public.controles_kilometriques (
 id uuid primary key default gen_random_uuid(),
 mission_id uuid not null references public.missions(id),
 arrivee_edl_id uuid not null unique references public.etats_des_lieux(id),
 phase text not null check(phase in ('arrivee','restitution_arrivee')),
 km_depart integer,
 km_arrivee integer,
 distance_prevue numeric,
 distance_reelle numeric generated always as (km_arrivee::numeric-km_depart::numeric) stored,
 ecart numeric generated always as (km_arrivee::numeric-km_depart::numeric-distance_prevue) stored,
 niveau text not null check(niveau in ('normal','orange','rouge','incomplet','incoherent')),
 created_at timestamptz not null default now(),
 unique(mission_id,phase)
);
alter table public.controles_kilometriques enable row level security;
revoke all on public.controles_kilometriques from public,anon,authenticated;
grant select on public.controles_kilometriques to authenticated;
create policy controle_km_admin on public.controles_kilometriques for select to authenticated using ((select public.est_admin()));
create index controles_kilometriques_mission_idx on public.controles_kilometriques(mission_id);

create function private.niveau_ecart_km(depart integer,arrivee integer,prevision numeric) returns text
language sql immutable set search_path='' as $$
 select case when depart is null or arrivee is null then 'incomplet'
 when depart<0 or arrivee<depart then 'incoherent'
 when prevision is null or prevision<=0 then 'incomplet'
 when arrivee::numeric-depart-prevision>=100 then 'rouge'
 when arrivee::numeric-depart-prevision>=60 then 'orange' else 'normal' end
$$;
revoke all on function private.niveau_ecart_km(integer,integer,numeric) from public,anon,authenticated;

create function private.controler_km_arrivee() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.missions%rowtype; p jsonb; depart integer; prev numeric; valeur text;
begin
 if new.phase not in ('arrivee','restitution_arrivee') then return new; end if;
 select * into m from public.missions where id=new.mission_id;
 if m.type_mission is distinct from 'convoyage' then return new; end if;
 if new.phase='restitution_arrivee' and not coalesce(m.restitution,false) then return new; end if;
 select plan into p from public.preparations_missions where id=m.preparation_id;
 select e.km into depart from public.etats_des_lieux e where e.mission_id=new.mission_id
 and e.phase=case new.phase when 'arrivee' then 'depart' else 'restitution_depart' end
 and e.vehicule_source_id is not distinct from new.vehicule_source_id order by e.created_at desc,e.id desc limit 1;
 if new.phase='arrivee' then
  -- distance_km is the published outbound estimate, never the return distance.
  prev:=nullif(m.distance_km,0);
  if prev is null then valeur:=coalesce(p->>'distance_aller',p->>'distance'); end if;
 else valeur:=p->>'distance_restitution'; end if;
 if prev is null and valeur ~ '^[0-9]{1,8}([.][0-9]{1,3})?$' then prev:=valeur::numeric; end if;
 insert into public.controles_kilometriques(mission_id,arrivee_edl_id,phase,km_depart,km_arrivee,distance_prevue,niveau)
 values(new.mission_id,new.id,new.phase,depart,new.km,prev,private.niveau_ecart_km(depart,new.km,prev))
 on conflict(mission_id,phase) do nothing;
 return new;
end $$;
revoke all on function private.controler_km_arrivee() from public,anon,authenticated;
create trigger controler_km_arrivee after insert on public.etats_des_lieux
for each row execute function private.controler_km_arrivee();
-- Existing arrival reports are intentionally not reinterpreted using today's estimates.
