-- ============================================================
-- HelixCar — 01 : service « Trouver un professionnel automobile »
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- Même principe que clients.nettoyage_details (déjà en place) : toutes
-- les données métier du service vivent dans UNE colonne JSONB écrite
-- par liste blanche côté site. Aucune colonne éparpillée, aucune
-- colonne Convoyage/Stockage réutilisée ou détournée.

alter table public.clients
  add column if not exists professionnel_details jsonb;

comment on column public.clients.professionnel_details is
  'Données métier du service « Trouver un professionnel automobile ». '
  'Écrit par liste blanche (index.html : _construireDetailsProfessionnel). '
  'Clés : schema_version, categorie (technicien|renfort), conseil (bool), '
  'specialite, mission, precision, nombre_professionnels, nombre_vehicules, '
  'vehicules[], adresse_rue, adresse_cp, adresse_ville, contact_sur_place, '
  'date_debut, date_fin, duree_jours, heure_debut, heure_fin, description, '
  'informations_complementaires.';

-- Cohérence : si le service est « professionnel », le bloc métier doit
-- exister. NOT VALID = les lignes déjà en base ne sont pas re-vérifiées
-- (aucune ancienne demande ne devient invalide) ; la contrainte
-- s'applique aux écritures futures.
-- Pour la valider plus tard, une fois l'historique nettoyé :
--   alter table public.clients validate constraint clients_professionnel_details_present;
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'clients_professionnel_details_present'
  ) then
    alter table public.clients
      add constraint clients_professionnel_details_present
      check (type_service is distinct from 'professionnel'
             or professionnel_details is not null)
      not valid;
  end if;
end $$;

-- Index de tri/filtre par service dans le Dashboard (liste des demandes).
create index if not exists clients_type_service_idx
  on public.clients (type_service);

-- Accès aux sous-clés du bloc métier (ex. filtrer par catégorie).
create index if not exists clients_professionnel_details_gin_idx
  on public.clients using gin (professionnel_details jsonb_path_ops);
