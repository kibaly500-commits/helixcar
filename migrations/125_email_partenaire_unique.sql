-- HelixCar — 125 : une seule candidature partenaire par adresse e-mail.
--
-- Les comparaisons ignorent les espaces exterieurs et la casse. Les
-- eventuels doublons historiques sont conserves : un index UNIQUE sur
-- convoyeurs ne pourrait pas etre installe sans les fusionner ou en
-- supprimer. Un registre prive reserve chaque adresse deja connue et
-- refuse atomiquement toute nouvelle duplication.
begin;

create index if not exists convoyeurs_email_normalise_idx
  on public.convoyeurs ((lower(btrim(email))))
  where email is not null and btrim(email) <> '';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.convoyeur_emails_reserves (
  email_normalise text primary key,
  reserve_le timestamptz not null default now()
);

alter table private.convoyeur_emails_reserves enable row level security;
revoke all on table private.convoyeur_emails_reserves
  from public, anon, authenticated;

-- Un seul enregistrement par adresse, meme lorsque plusieurs anciennes
-- fiches portent deja cette adresse. Aucune ligne historique n'est
-- modifiee ou supprimee.
insert into private.convoyeur_emails_reserves (email_normalise)
select distinct lower(btrim(email))
  from public.convoyeurs
 where email is not null and btrim(email) <> ''
on conflict (email_normalise) do nothing;

create or replace function private.reserver_email_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_normalise text;
begin
  new.email := pg_catalog.btrim(new.email);
  email_normalise := pg_catalog.lower(new.email);

  if email_normalise is null or email_normalise = '' then
    return new;
  end if;

  -- Une mise a jour qui ne change pas reellement l'adresse ne tente pas
  -- de la reserver une seconde fois.
  if tg_op = 'UPDATE'
     and email_normalise = pg_catalog.lower(pg_catalog.btrim(old.email)) then
    return new;
  end if;

  begin
    insert into private.convoyeur_emails_reserves (email_normalise)
    values (email_normalise);
  exception when unique_violation then
    raise exception using
      errcode = '23505',
      message = 'EMAIL_DEJA_UTILISE',
      constraint = 'convoyeurs_email_normalise_unique';
  end;

  return new;
end;
$$;

revoke all on function private.reserver_email_convoyeur()
  from public, anon, authenticated;

drop trigger if exists trg_convoyeurs_email_unique on public.convoyeurs;
create trigger trg_convoyeurs_email_unique
before insert or update of email on public.convoyeurs
for each row execute function private.reserver_email_convoyeur();

commit;
