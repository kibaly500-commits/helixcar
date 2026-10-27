-- Référence lisible stable, sans renommer les références utilisées par les documents.
alter table public.missions add column reference_courte text;
create unique index missions_reference_courte_unique on public.missions(reference_courte);
create table private.compteurs_references_missions(annee integer primary key, dernier integer not null default 0 check(dernier between 0 and 9999));
alter table private.compteurs_references_missions enable row level security;
revoke all on private.compteurs_references_missions from public,anon,authenticated;
create function private.prochaine_reference_mission(p_annee integer) returns text
language plpgsql security definer set search_path='' as $$
declare n integer; r text;
begin
 loop
  insert into private.compteurs_references_missions as c(annee,dernier) values(p_annee,1)
  on conflict(annee) do update set dernier=c.dernier+1 returning dernier into n;
  r:='HC-'||p_annee::text||'-'||lpad(n::text,4,'0');
  if not exists(select 1 from public.missions where reference=r or reference_courte=r) then return r; end if;
 end loop;
end $$;
revoke all on function private.prochaine_reference_mission(integer) from public,anon,authenticated;
-- Conserver les références déjà au bon format.
update public.missions set reference_courte=reference where reference ~ '^HC-[0-9]{4}-[0-9]{4}$';
do $$ declare m record; begin
 for m in select id,created_at from public.missions where reference_courte is null order by created_at,id loop
  update public.missions set reference_courte=private.prochaine_reference_mission(extract(year from coalesce(m.created_at,now()) at time zone 'Europe/Paris')::integer) where id=m.id;
 end loop;
end $$;
alter table public.missions alter column reference_courte set not null;
create function private.reference_courte_mission() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  -- Le numéro est attribué en base, même si le navigateur en propose un.
  new.reference_courte:=private.prochaine_reference_mission(extract(year from now() at time zone 'Europe/Paris')::integer);
 elsif new.reference_courte is distinct from old.reference_courte then
  raise exception 'La référence de mission est permanente.' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.reference_courte_mission() from public,anon,authenticated;
create trigger reference_courte_mission before insert or update on public.missions
for each row execute function private.reference_courte_mission();
