-- HelixCar — 127 : lève l'ambiguïté entre la variable normalisée et la
-- colonne homonyme du registre lors de l'appel de vérification précoce.
begin;

create or replace function public.email_partenaire_deja_utilise(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email_normalise text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if v_email_normalise is null
     or v_email_normalise = ''
     or pg_catalog.length(v_email_normalise) > 254
     or v_email_normalise !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;

  return exists (
    select 1
      from private.convoyeur_emails_reserves as reserve
     where reserve.email_normalise = v_email_normalise
  );
end;
$$;

revoke all on function public.email_partenaire_deja_utilise(text)
  from public, anon, authenticated;
grant execute on function public.email_partenaire_deja_utilise(text)
  to anon, authenticated;

commit;
