-- HelixCar — 125 : une seule candidature partenaire par adresse e-mail.
--
-- Les comparaisons ignorent les espaces exterieurs et la casse. Les
-- eventuels doublons historiques sont conserves : un index UNIQUE ne
-- pourrait pas etre installe sans les fusionner ou en supprimer. Le
-- trigger interdit uniquement toute nouvelle duplication.
begin;

create index if not exists convoyeurs_email_normalise_idx
  on public.convoyeurs ((lower(btrim(email))))
  where email is not null and btrim(email) <> '';

create or replace function public.refuser_email_convoyeur_duplique()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_normalise text;
  deja_present boolean;
begin
  new.email := pg_catalog.btrim(new.email);
  email_normalise := pg_catalog.lower(new.email);

  if email_normalise is null or email_normalise = '' then
    return new;
  end if;

  -- Deux inscriptions simultanees portant la meme adresse sont
  -- serialisees avant le controle, meme si aucune ligne n'existe encore.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(email_normalise, 0)
  );

  if tg_op = 'INSERT' then
    select exists (
      select 1
        from public.convoyeurs c
       where pg_catalog.lower(pg_catalog.btrim(c.email)) = email_normalise
    ) into deja_present;
  else
    select exists (
      select 1
        from public.convoyeurs c
       where pg_catalog.lower(pg_catalog.btrim(c.email)) = email_normalise
         and c.id is distinct from new.id
    ) into deja_present;
  end if;

  if deja_present then
    raise exception using
      errcode = '23505',
      message = 'EMAIL_DEJA_UTILISE',
      constraint = 'convoyeurs_email_normalise_unique';
  end if;

  return new;
end;
$$;

revoke all on function public.refuser_email_convoyeur_duplique() from public;

drop trigger if exists trg_convoyeurs_email_unique on public.convoyeurs;
create trigger trg_convoyeurs_email_unique
before insert or update of email on public.convoyeurs
for each row execute function public.refuser_email_convoyeur_duplique();

commit;
