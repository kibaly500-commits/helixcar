-- Raccourcis d'identité pour les vérifications RLS locales.
-- Reproduisent ce que PostgREST fait : un rôle SQL + les claims du JWT.
create or replace function public.devenir_anon() returns void
language plpgsql as $$ begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create or replace function public.devenir(p_sub uuid, p_email text) returns void
language plpgsql as $$ begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'email', p_email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
