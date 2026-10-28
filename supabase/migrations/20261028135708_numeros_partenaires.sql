-- Numéro d'affichage permanent ; les relations continuent d'utiliser l'UUID.
create schema if not exists private;
create sequence private.numeros_partenaires_seq;
revoke all on sequence private.numeros_partenaires_seq from public, anon, authenticated;
alter table public.convoyeurs add column numero_partenaire text;
do $$ declare c record; n bigint; begin
  for c in select id from public.convoyeurs order by created_at nulls last, id loop
    n := nextval('private.numeros_partenaires_seq');
    update public.convoyeurs set numero_partenaire = 'PART-' || lpad(n::text, greatest(4,length(n::text)), '0') where id=c.id;
  end loop;
end $$;
alter table public.convoyeurs alter column numero_partenaire set not null;
alter table public.convoyeurs add constraint convoyeurs_numero_partenaire_unique unique(numero_partenaire);
create function private.attribuer_numero_partenaire() returns trigger
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
  if tg_op='INSERT' then
    n := nextval('private.numeros_partenaires_seq');
    new.numero_partenaire := 'PART-' || lpad(n::text, greatest(4,length(n::text)), '0');
  elsif new.numero_partenaire is distinct from old.numero_partenaire then
    raise exception 'Le numéro partenaire est permanent.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.attribuer_numero_partenaire() from public, anon, authenticated;
create trigger attribuer_numero_partenaire before insert or update of numero_partenaire
on public.convoyeurs for each row execute function private.attribuer_numero_partenaire();
