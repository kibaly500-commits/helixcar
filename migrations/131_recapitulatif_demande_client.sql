-- PR6 lot 131 — récapitulatif complet et sûr des demandes côté client
-- Étend uniquement la projection client existante. La vue reste filtrée
-- par auth.uid() et n'expose ni prix, ni notes internes, ni données admin.

create or replace view public.v_mes_demandes as
select
  c.id,
  c.numero_client,
  c.type_service,
  c.statut,
  c.prenom,
  c.nom,
  c.email,
  c.telephone,
  c.type_client,
  c.societe,
  c.siret,
  c.source_acquisition,
  c.source_acquisition_detail,
  c.nb_vehicules,
  c.ville_depart,
  c.ville_arrivee,
  c.date_prise_en_charge,
  c.stockage_ville,
  c.stockage_date_debut,
  c.created_at,

  -- Données opérationnelles nécessaires au récapitulatif en lecture seule.
  c.adresse_depart_rue,
  c.code_postal_depart,
  c.adresse_arrivee_rue,
  c.code_postal_arrivee,
  c.adresse_restit_rue,
  c.code_postal_restit,
  c.ville_restit,
  c.heure_prise_en_charge,
  c.pc_heure_type,
  c.pc_creneau_debut,
  c.pc_creneau_fin,
  c.date_livraison,
  c.heure_livraison,
  c.liv_heure_type,
  c.liv_creneau_debut,
  c.liv_creneau_fin,
  c.trajet_commun,
  c.flotte_a_detailler,

  -- Période de stockage complète : début ET fin.
  c.stockage_code_postal,
  c.stockage_acheminement,
  c.stockage_sortie,
  c.stockage_nb_vehicules,
  c.stockage_date_fin,
  c.stockage_nb_jours,
  c.stockage_notes,
  c.stockage_heure_entree,
  c.stockage_heure_sortie,

  -- Compatibilité des demandes mono et historiques.
  c.type_trajet,
  c.type_vehicule,
  c.marque_modele,
  c.immatriculation,
  c.vin,
  c.mode_transport,
  c.plateau,
  c.nettoyage,
  c.nettoyage_details,
  c.professionnel_details,
  c.urgence,

  -- Livraison, restitution et contacts utiles au document.
  c.restitution,
  c.adresse_restitution,
  c.date_restitution,
  c.heure_restitution,
  c.restit_heure_type,
  c.restit_creneau_debut,
  c.restit_creneau_fin,
  c.type_trajet_retour,
  c.restit_type_vehicule,
  c.restit_marque_modele,
  c.restit_immatriculation,
  c.restit_vin,
  c.contact_pc_nom,
  c.contact_pc_tel,
  c.contraintes_pc,
  c.contact_liv_nom,
  c.contact_liv_tel,
  c.contraintes_liv,
  c.restit_contact_nom,
  c.restit_contact_tel,
  c.contraintes_restit,
  c.notes
from public.clients c
where c.auth_user_id = auth.uid();

revoke all on public.v_mes_demandes from anon;
grant select on public.v_mes_demandes to authenticated;

comment on view public.v_mes_demandes is
  'Demandes du client connecté, projection métier en lecture seule pour '
  'le récapitulatif. Aucune donnée interne, aucun prix et aucune donnée '
  'administrative ne sont exposés.';
