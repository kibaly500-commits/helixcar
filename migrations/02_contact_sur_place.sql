-- ============================================================
-- HelixCar — 02 : contact sur place (champ transversal)
-- ============================================================
-- Dépend de : 01_professionnel_details.sql
--
-- AUCUNE nouvelle colonne n'est créée pour le contact sur place :
-- il appartient au bloc métier du service concerné et y est stocké
-- comme un objet explicite, exactement comme le reste des données de
-- ce service.
--
--   clients.nettoyage_details    -> clé "contact_sur_place"
--   clients.professionnel_details-> clé "contact_sur_place"
--
-- Forme de l'objet (écrit par index.html : _hcContactSurPlace) :
--   { "type": "moi" | "autre", "nom": "...", "telephone": "..." }
--
-- « type » conserve l'intention réelle du client ; « nom » et
-- « telephone » sont les valeurs finales résolues. L'objet n'est jamais
-- écrit partiellement : si la donnée nécessaire manque, la clé vaut
-- null et la demande n'est pas validée côté formulaire.
--
-- Ce fichier n'ajoute donc que des garde-fous et des accès de lecture.

-- Cohérence de forme : quand la clé existe et n'est pas nulle, elle doit
-- porter un type connu ET les deux valeurs finales. NOT VALID : aucune
-- demande déjà enregistrée n'est invalidée rétroactivement.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'clients_contact_sur_place_forme'
  ) then
    alter table public.clients
      add constraint clients_contact_sur_place_forme
      check (
        -- Nettoyage
        (
          nettoyage_details is null
          or nettoyage_details -> 'contact_sur_place' is null
          or jsonb_typeof(nettoyage_details -> 'contact_sur_place') = 'null'
          or (
            nettoyage_details #>> '{contact_sur_place,type}' in ('moi', 'autre')
            and coalesce(nettoyage_details #>> '{contact_sur_place,nom}', '') <> ''
            and coalesce(nettoyage_details #>> '{contact_sur_place,telephone}', '') <> ''
          )
        )
        and
        -- Trouver un professionnel
        (
          professionnel_details is null
          or professionnel_details -> 'contact_sur_place' is null
          or jsonb_typeof(professionnel_details -> 'contact_sur_place') = 'null'
          or (
            professionnel_details #>> '{contact_sur_place,type}' in ('moi', 'autre')
            and coalesce(professionnel_details #>> '{contact_sur_place,nom}', '') <> ''
            and coalesce(professionnel_details #>> '{contact_sur_place,telephone}', '') <> ''
          )
        )
      )
      not valid;
  end if;
end $$;

-- Vue de lecture unifiée : le contact sur place d'une demande, quel que
-- soit le service, sous un seul libellé. Le Dashboard peut s'en servir
-- sans dupliquer la logique de lecture du JSONB.
create or replace view public.v_demandes_contact_sur_place as
select
  c.id                                   as client_id,
  c.numero_client,
  c.type_service,
  coalesce(
    c.nettoyage_details    #>> '{contact_sur_place,type}',
    c.professionnel_details#>> '{contact_sur_place,type}'
  )                                      as contact_type,
  coalesce(
    c.nettoyage_details    #>> '{contact_sur_place,nom}',
    c.professionnel_details#>> '{contact_sur_place,nom}'
  )                                      as contact_nom,
  coalesce(
    c.nettoyage_details    #>> '{contact_sur_place,telephone}',
    c.professionnel_details#>> '{contact_sur_place,telephone}'
  )                                      as contact_telephone
from public.clients c;

comment on view public.v_demandes_contact_sur_place is
  'Contact sur place résolu d''une demande, tous services confondus. '
  'Lecture seule ; la source de vérité reste le bloc métier du service.';

-- La vue n''ouvre aucun accès supplémentaire : elle reste soumise aux
-- politiques de public.clients (security_invoker).
alter view public.v_demandes_contact_sur_place set (security_invoker = on);
