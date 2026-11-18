-- HelixCar — 126 : vérification précoce d'une adresse partenaire.
--
-- L'API publique ne renvoie qu'un booléen. Elle ne donne accès ni aux
-- candidatures, ni au registre privé, ni à une donnée personnelle autre
-- que l'information d'existence explicitement voulue pour ce formulaire.
begin;

create or replace function public.email_partenaire_deja_utilise(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  email_normalise text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if email_normalise is null
     or email_normalise = ''
     or pg_catalog.length(email_normalise) > 254
     or email_normalise !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;

  return exists (
    select 1
      from private.convoyeur_emails_reserves as reserve
     where reserve.email_normalise = email_normalise
  );
end;
$$;

comment on function public.email_partenaire_deja_utilise(text) is
  'Endpoint public volontairement minimal : indique uniquement si une adresse partenaire normalisée est déjà réservée.';

revoke all on function public.email_partenaire_deja_utilise(text)
  from public, anon, authenticated;
grant execute on function public.email_partenaire_deja_utilise(text)
  to anon, authenticated;

commit;
