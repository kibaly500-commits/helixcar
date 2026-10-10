-- HelixCar — 119 : nettoyage sûr des alertes résiduelles de l'analyseur
-- Additive et idempotente. Aucun droit métier n'est ajouté.
begin;

-- Une fonction de trigger ne doit jamais être appelable comme RPC. Les droits
-- explicites ont pu survivre à CREATE OR REPLACE sur les anciens projets.
do $$
declare signature regprocedure;
begin
  signature := to_regprocedure('public.garde_video_finale_serveur()');
  if signature is not null then
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role',
      signature
    );
  end if;
end $$;

-- Le nouvel index avait exactement la même définition que l'index historique
-- clients_type_service_idx. Conserver un seul exemplaire évite le coût double.
drop index if exists public.idx_clients_type_service;

-- La politique historique est strictement incluse dans la politique durcie
-- « convoyeurs : depot de candidature » (anon + authenticated, même CHECK).
-- La retirer ne ferme ni n'élargit aucun accès.
do $$
begin
  if to_regclass('public.convoyeurs') is not null then
    execute 'drop policy if exists insert_convoyeurs on public.convoyeurs';
  end if;
end $$;

commit;
