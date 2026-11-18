-- HelixCar — 116 : ferme les privilèges implicites des vues historiques.
-- Les deux vues `vue_*` ne sont plus consommées par l'application. Elles sont
-- conservées pour compatibilité administrative, sans accès Data API.
begin;

do $$
begin
  if to_regclass('public.v_mes_demandes') is not null then
    execute 'revoke all on public.v_mes_demandes from anon,authenticated';
    execute 'grant select on public.v_mes_demandes to authenticated';
  end if;

  if to_regclass('public.vue_clients') is not null then
    execute 'revoke all on public.vue_clients from anon,authenticated';
    execute 'alter view public.vue_clients set (security_invoker=true)';
  end if;

  if to_regclass('public.vue_parrainages') is not null then
    execute 'revoke all on public.vue_parrainages from anon,authenticated';
    execute 'alter view public.vue_parrainages set (security_invoker=true)';
  end if;
end $$;

commit;
