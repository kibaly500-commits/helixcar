-- HelixCar — 121 : justificatif d'immatriculation des partenaires
-- Additive et idempotente. Les candidatures historiques restent valides.
begin;

alter table public.convoyeurs
  add column if not exists kbis_url text;

comment on column public.convoyeurs.kbis_url is
  'URL du justificatif d''immatriculation fourni à la candidature : extrait Kbis ou attestation RNE.';

commit;

-- Vérification après application :
-- select column_name, data_type from information_schema.columns
--  where table_schema='public' and table_name='convoyeurs' and column_name='kbis_url';
