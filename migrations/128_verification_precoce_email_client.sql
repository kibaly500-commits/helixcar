-- HelixCar — 128 : vérification précoce d'une adresse client.
--
-- Le formulaire demande explicitement une réponse immédiate avant de
-- poursuivre. L'API ne renvoie qu'un booléen et n'expose ni compte,
-- ni dossier, ni autre donnée personnelle.
begin;

create or replace function public.email_client_deja_utilise(p_email text)
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
      from auth.users as utilisateur
     where pg_catalog.lower(pg_catalog.btrim(utilisateur.email)) = v_email_normalise
  ) or exists (
    select 1
      from public.clients as dossier
     where pg_catalog.lower(pg_catalog.btrim(dossier.email)) = v_email_normalise
  );
end;
$$;

comment on function public.email_client_deja_utilise(text) is
  'Endpoint public minimal : indique uniquement si une adresse client normalisée est déjà associée à un compte ou un dossier.';

revoke all on function public.email_client_deja_utilise(text)
  from public, anon, authenticated;
grant execute on function public.email_client_deja_utilise(text)
  to anon, authenticated;

commit;
