-- HelixCar — 124 : civilité des partenaires.
-- Les candidatures existantes restent sans valeur et utilisent donc le
-- masculin par défaut dans le dashboard. Les nouvelles candidatures
-- choisissent Madame, Monsieur ou « Je préfère ne pas préciser ».
begin;

alter table public.convoyeurs
  add column if not exists civilite text;

alter table public.convoyeurs
  drop constraint if exists convoyeurs_civilite_check;

alter table public.convoyeurs
  add constraint convoyeurs_civilite_check
  check (civilite is null or civilite in ('madame', 'monsieur', 'non_precise'));

commit;
