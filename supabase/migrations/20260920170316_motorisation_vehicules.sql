-- Motorisation facultative au devis, requise avant mission, par véhicule.
alter table public.clients add column motorisation text;
alter table public.clients add constraint clients_motorisation_valide check (motorisation is null or motorisation in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'));
alter table public.clients add column restit_motorisation text;
alter table public.clients add constraint clients_restit_motorisation_valide check (restit_motorisation is null or restit_motorisation in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'));
alter table public.vehicules add column motorisation text;
alter table public.vehicules add constraint vehicules_motorisation_valide check (motorisation is null or motorisation in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'));
alter table public.vehicules add column restit_motorisation text;
alter table public.vehicules add constraint vehicules_restit_motorisation_valide check (restit_motorisation is null or restit_motorisation in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'));
alter table public.missions add column motorisation text;
alter table public.missions add constraint missions_motorisation_valide check (motorisation is null or motorisation in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'));
alter table public.missions add column restit_motorisation text;
alter table public.missions add constraint missions_restit_motorisation_valide check (restit_motorisation is null or restit_motorisation in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre'));
CREATE OR REPLACE FUNCTION public.champs_publics_demande()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array[
    -- Identité et rattachement commercial
    'numero_client', 'code_parrainage', 'parraine_par',
    'prenom', 'nom', 'email', 'telephone',
    'type_client', 'societe', 'siret',
    -- Service demandé
    'type_service', 'disponibilite', 'nb_vehicules', 'trajet_commun',
    'flotte_a_detailler', 'notes',
    'nettoyage_details', 'professionnel_details',
    -- Trajet (demande mono-véhicule historique)
    'type_trajet', 'type_trajet_retour', 'mode_transport',
    'adresse_depart_rue', 'code_postal_depart', 'ville_depart',
    'adresse_arrivee_rue', 'code_postal_arrivee', 'ville_arrivee',
    'date_prise_en_charge', 'heure_prise_en_charge',
    'pc_heure_type', 'pc_creneau_debut', 'pc_creneau_fin',
    'date_livraison', 'heure_livraison',
    'liv_heure_type', 'liv_creneau_debut', 'liv_creneau_fin',
    -- Véhicule (demande mono-véhicule historique)
    'type_vehicule', 'marque_modele', 'immatriculation', 'vin', 'motorisation',
    'nettoyage', 'plateau', 'urgence',
    -- Restitution
    'restitution', 'adresse_restitution', 'adresse_restit_rue',
    'code_postal_restit', 'ville_restit',
    'date_restitution', 'heure_restitution',
    'restit_heure_type', 'restit_creneau_debut', 'restit_creneau_fin',
    'restit_type_vehicule', 'restit_marque_modele',
    'restit_immatriculation', 'restit_vin', 'restit_motorisation',
    -- Stockage
    'stockage_code_postal', 'stockage_ville',
    'stockage_acheminement', 'stockage_sortie',
    'stockage_nb_vehicules', 'stockage_date_debut', 'stockage_date_fin',
    'stockage_nb_jours', 'stockage_notes',
    'stockage_heure_entree', 'stockage_heure_sortie',
    -- Contacts sur place
    'contact_pc_nom', 'contact_pc_tel', 'contraintes_pc',
    'contact_liv_nom', 'contact_liv_tel', 'contraintes_liv',
    'restit_contact_nom', 'restit_contact_tel', 'contraintes_restit',
    -- Provenance
    'source_acquisition', 'source_acquisition_detail',
    'utm_source', 'utm_medium', 'utm_campaign'
  ]::text[];
$function$

;
CREATE OR REPLACE FUNCTION public.champs_publics_vehicule()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select array[
    'position', 'type_vehicule', 'marque_modele', 'immatriculation', 'vin', 'motorisation',
    'mode_transport', 'consignes',
    'adresse_depart_rue', 'code_postal_depart', 'ville_depart',
    'pc_contact_nom', 'pc_contact_tel',
    'date_prise_en_charge', 'heure_prise_en_charge',
    'pc_heure_type', 'pc_creneau_debut', 'pc_creneau_fin',
    'adresse_arrivee_rue', 'code_postal_arrivee', 'ville_arrivee',
    'livraison_apres_stockage',
    'liv_contact_nom', 'liv_contact_tel',
    'date_livraison', 'heure_livraison',
    'liv_heure_type', 'liv_creneau_debut', 'liv_creneau_fin',
    'restitution_concernee',
    'restit_adresse_rue', 'restit_code_postal', 'restit_ville',
    'restit_contact_nom', 'restit_contact_tel',
    'restit_date', 'restit_heure', 'restit_heure_type',
    'restit_creneau_debut', 'restit_creneau_fin', 'restit_contraintes',
    'heure_recuperation_client',
    'restit_type_vehicule', 'restit_marque_modele',
    'restit_immatriculation', 'restit_vin', 'restit_motorisation'
  ]::text[];
$function$

;
CREATE OR REPLACE FUNCTION public.informations_demande(p_client_id uuid)
 RETURNS TABLE(cle text, libelle text, statut text, valeur text, commentaire text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  d       public.clients%rowtype;
  dj      jsonb;                    -- la demande, lue comme du JSON
  nd      jsonb;                    -- nettoyage_details
  pd      jsonb;                    -- professionnel_details
  requis  jsonb := '[]'::jsonb;
  v       record;
  n_veh   integer := 0;
  rang    integer;
  prefixe text;
  -- Scénario réellement retenu par le client.
  pc_helixcar  boolean;   -- HelixCar prend le véhicule en charge
  liv_helixcar boolean;   -- HelixCar livre / restitue le véhicule
  commun       boolean;   -- trajet commun à tous les véhicules ?
  lieu_nett    text;
begin
  -- ----------------------------------------------------------
  -- AUTORISATION — le premier contrôle, avant toute lecture
  -- ----------------------------------------------------------
  -- Cette fonction est SECURITY DEFINER : elle lit public.clients et
  -- public.vehicules en passant OUTRE la RLS. Elle est accordée à tout
  -- utilisateur `authenticated` — c'est-à-dire aussi bien à un client
  -- qu'à un partenaire.
  --
  -- Sans ce contrôle, connaître un identifiant de demande suffisait à
  -- obtenir les coordonnées de son contact, ses adresses et ses dates.
  -- Un partenaire lit précisément cet identifiant sur chaque mission
  -- qui lui est attribuée : la fuite n'était pas théorique.
  --
  -- Deux appelants seulement sont légitimes : l'administrateur, et le
  -- propriétaire réel de la demande. Tout autre appelant repart avec
  -- ZÉRO ligne — jamais une erreur qui confirmerait l'existence de la
  -- demande.
  if not (
    public.est_admin()
    or public.est_proprietaire_demande(p_client_id)
    or coalesce(current_setting('hc.creation_mission_serveur', true), '') = '1'
  ) then
    return;
  end if;

  select * into d from public.clients c where c.id = p_client_id;
  if not found then
    return;
  end if;

  dj := to_jsonb(d);
  nd := coalesce(d.nettoyage_details, '{}'::jsonb);
  pd := coalesce(d.professionnel_details, '{}'::jsonb);
  select count(*) into n_veh from public.vehicules ve where ve.dossier_id = p_client_id;

  -- ----------------------------------------------------------
  -- SCÉNARIO : qui achemine, qui récupère ?
  -- ----------------------------------------------------------
  -- Un convoyage implique toujours les deux extrémités. Pour un
  -- stockage, seule l'extrémité réellement confiée à HelixCar l'est.
  -- 'convoyage_stockage' n'est plus proposé mais reste porté par
  -- d'anciennes demandes : il est lu comme un convoyage.
  if d.type_service in ('convoyage', 'convoyage_stockage') then
    pc_helixcar  := true;
    liv_helixcar := true;
  elsif d.type_service = 'stockage' then
    pc_helixcar  := (d.stockage_acheminement = 'helixcar');
    liv_helixcar := (d.stockage_sortie = 'helixcar');
  else
    pc_helixcar  := false;
    liv_helixcar := false;
  end if;

  -- trajet_commun NULL = demande antérieure au champ : les données de
  -- trajet vivaient alors sur la demande, on autorise donc le repli.
  commun := coalesce(d.trajet_commun, true);

  -- ----------------------------------------------------------
  -- STOCKAGE : la prestation elle-même
  -- ----------------------------------------------------------
  if d.type_service in ('stockage', 'convoyage_stockage') then
    requis := requis || jsonb_build_array(
      jsonb_build_object('cle','stockage_ville','libelle','Ville de stockage',
                         'fournie', public.hc_texte(dj,'stockage_ville') is not null),
      jsonb_build_object('cle','stockage_date_debut','libelle','Date de début de stockage',
                         'fournie', d.stockage_date_debut is not null));
  end if;

  -- ----------------------------------------------------------
  -- VÉHICULES : jamais mélangés, toujours nommés
  -- ----------------------------------------------------------
  -- C'est ici que vivent réellement la prise en charge, la livraison et
  -- la restitution depuis la refonte du formulaire. Une rubrique par
  -- véhicule, préfixée de son rang dès qu'il y en a plusieurs.
  if d.type_service in ('convoyage', 'convoyage_stockage', 'stockage') then
    if n_veh > 0 then
      for v in
        select ve.*,
               row_number() over (order by coalesce(ve.position, 999999), ve.created_at, ve.id) as rn
          from public.vehicules ve
         where ve.dossier_id = p_client_id
      loop
        rang    := coalesce(v.position, v.rn::integer);
        prefixe := case when n_veh > 1 then 'Véhicule ' || rang::text || ' — ' else '' end;

        requis := requis || jsonb_build_array(
          jsonb_build_object(
            'cle','vehicule_' || rang::text || '_immatriculation',
            'libelle', prefixe || case when n_veh > 1 then 'immatriculation' else 'Immatriculation du véhicule' end,
            'fournie', nullif(btrim(coalesce(v.immatriculation,'')),'') is not null),
          jsonb_build_object(
            'cle','vehicule_' || rang::text || '_vin',
            'libelle', prefixe || case when n_veh > 1 then 'numéro de châssis (VIN)' else 'Numéro de châssis (VIN)' end,
            'fournie', nullif(btrim(coalesce(v.vin,'')),'') is not null),
          jsonb_build_object(
            'cle','vehicule_' || rang::text || '_motorisation',
            'libelle', prefixe || case when n_veh > 1 then 'motorisation' else 'Motorisation' end,
            'fournie', nullif(btrim(coalesce(v.motorisation,'')),'') is not null),
          jsonb_build_object(
            'cle','vehicule_' || rang::text || '_marque_modele',
            'libelle', prefixe || case when n_veh > 1 then 'marque et modèle' else 'Marque et modèle' end,
            'fournie', nullif(btrim(coalesce(v.marque_modele,'')),'') is not null));

        if pc_helixcar then
          requis := requis || jsonb_build_array(
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_adresse_depart',
              'libelle', prefixe || case when n_veh > 1 then 'adresse de prise en charge' else 'Adresse de prise en charge' end,
              'fournie', (nullif(btrim(coalesce(v.adresse_depart_rue,'')),'') is not null or (commun and public.hc_texte(dj,'adresse_depart_rue') is not null))),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_date_prise_en_charge',
              'libelle', prefixe || case when n_veh > 1 then 'date de prise en charge' else 'Date de prise en charge' end,
              'fournie', (v.date_prise_en_charge is not null or (commun and d.date_prise_en_charge is not null))),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_pc_nom',
              'libelle', prefixe || case when n_veh > 1 then 'nom du contact à la prise en charge' else 'Nom du contact à la prise en charge' end,
              'fournie', (nullif(btrim(coalesce(v.pc_contact_nom,'')),'') is not null or (commun and public.hc_texte(dj,'contact_pc_nom') is not null))),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_pc_tel',
              'libelle', prefixe || case when n_veh > 1 then 'téléphone du contact à la prise en charge' else 'Téléphone du contact à la prise en charge' end,
              'fournie', (nullif(btrim(coalesce(v.pc_contact_tel,'')),'') is not null or (commun and public.hc_texte(dj,'contact_pc_tel') is not null))));
        end if;

        -- Livraison : applicable si HelixCar restitue le véhicule ET si
        -- CE véhicule-là lui est bien confié. La décision enregistrée
        -- fait foi ; pour les lignes antérieures à la colonne, une heure
        -- de récupération renseignée signale une reprise par le client.
        if liv_helixcar
           and coalesce(v.livraison_apres_stockage,
                        nullif(btrim(coalesce(v.heure_recuperation_client,'')),'') is null) then
          requis := requis || jsonb_build_array(
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_adresse_arrivee',
              'libelle', prefixe || case when n_veh > 1 then 'adresse de livraison' else 'Adresse de livraison' end,
              'fournie', (nullif(btrim(coalesce(v.adresse_arrivee_rue,'')),'') is not null or (commun and public.hc_texte(dj,'adresse_arrivee_rue') is not null))),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_liv_nom',
              'libelle', prefixe || case when n_veh > 1 then 'nom du contact à la livraison' else 'Nom du contact à la livraison' end,
              'fournie', (nullif(btrim(coalesce(v.liv_contact_nom,'')),'') is not null or (commun and public.hc_texte(dj,'contact_liv_nom') is not null))),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_liv_tel',
              'libelle', prefixe || case when n_veh > 1 then 'téléphone du contact à la livraison' else 'Téléphone du contact à la livraison' end,
              'fournie', (nullif(btrim(coalesce(v.liv_contact_tel,'')),'') is not null or (commun and public.hc_texte(dj,'contact_liv_tel') is not null))));
        end if;

        -- Restitution : uniquement si CE véhicule est concerné.
        if v.restitution_concernee is true then
          requis := requis || jsonb_build_array(
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_immatriculation',
              'libelle', prefixe || case when n_veh > 1 then 'immatriculation du véhicule à restituer' else 'Immatriculation du véhicule à restituer' end,
              'fournie', nullif(btrim(coalesce(v.restit_immatriculation,'')),'') is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_vin',
              'libelle', prefixe || case when n_veh > 1 then 'VIN du véhicule à restituer' else 'VIN du véhicule à restituer' end,
              'fournie', nullif(btrim(coalesce(v.restit_vin,'')),'') is not null),
          jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_motorisation',
              'libelle', prefixe || case when n_veh > 1 then 'Motorisation du véhicule à restituer' else 'Motorisation du véhicule à restituer' end,
              'fournie', nullif(btrim(coalesce(v.restit_motorisation,'')),'') is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_adresse',
              'libelle', prefixe || case when n_veh > 1 then 'adresse de restitution' else 'Adresse de restitution' end,
              'fournie', nullif(btrim(coalesce(v.restit_adresse_rue,'')),'') is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_date',
              'libelle', prefixe || case when n_veh > 1 then 'date de restitution' else 'Date de restitution' end,
              'fournie', v.restit_date is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_contact_nom',
              'libelle', prefixe || case when n_veh > 1 then 'nom du contact à la restitution' else 'Nom du contact à la restitution' end,
              'fournie', nullif(btrim(coalesce(v.restit_contact_nom,'')),'') is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_contact_tel',
              'libelle', prefixe || case when n_veh > 1 then 'téléphone du contact à la restitution' else 'Téléphone du contact à la restitution' end,
              'fournie', nullif(btrim(coalesce(v.restit_contact_tel,'')),'') is not null));
        end if;
      end loop;

    else
      -- AUCUNE fiche véhicule : demande antérieure à l'architecture
      -- unifiée. Les mêmes informations vivent alors sur la demande.
      -- Les clés historiques sont conservées à l'identique pour ne pas
      -- orpheliner les réponses déjà enregistrées.
      requis := requis || jsonb_build_array(
        jsonb_build_object('cle','immatriculation','libelle','Immatriculation du véhicule',
                           'fournie', public.hc_texte(dj,'immatriculation') is not null),
        jsonb_build_object('cle','vin','libelle','Numéro de châssis (VIN)',
                           'fournie', public.hc_texte(dj,'vin') is not null),
          jsonb_build_object('cle','motorisation','libelle','Motorisation',
                           'fournie', public.hc_texte(dj,'motorisation') is not null),
        jsonb_build_object('cle','marque_modele','libelle','Marque et modèle',
                           'fournie', public.hc_texte(dj,'marque_modele') is not null));

      if pc_helixcar then
        requis := requis || jsonb_build_array(
          jsonb_build_object('cle','adresse_depart_rue','libelle','Adresse de prise en charge',
                             'fournie', public.hc_texte(dj,'adresse_depart_rue') is not null),
          jsonb_build_object('cle','date_prise_en_charge','libelle','Date de prise en charge',
                             'fournie', d.date_prise_en_charge is not null),
          jsonb_build_object('cle','contact_pc_nom','libelle','Nom du contact à la prise en charge',
                             'fournie', public.hc_texte(dj,'contact_pc_nom') is not null),
          jsonb_build_object('cle','contact_pc_tel','libelle','Téléphone du contact à la prise en charge',
                             'fournie', public.hc_texte(dj,'contact_pc_tel') is not null));
      end if;

      if liv_helixcar then
        requis := requis || jsonb_build_array(
          jsonb_build_object('cle','adresse_arrivee_rue','libelle','Adresse de livraison',
                             'fournie', public.hc_texte(dj,'adresse_arrivee_rue') is not null),
          jsonb_build_object('cle','contact_liv_nom','libelle','Nom du contact à la livraison',
                             'fournie', public.hc_texte(dj,'contact_liv_nom') is not null),
          jsonb_build_object('cle','contact_liv_tel','libelle','Téléphone du contact à la livraison',
                             'fournie', public.hc_texte(dj,'contact_liv_tel') is not null));
      end if;

      -- Compatibilité des demandes antérieures à demandes_vehicules :
      -- si une restitution était déjà prévue, sa plaque et son VIN sont
      -- attendus eux aussi avant toute création de mission.
      if lower(coalesce(public.hc_texte(dj,'restitution'), '')) in ('oui','true','1') then
        requis := requis || jsonb_build_array(
          jsonb_build_object('cle','restit_immatriculation',
                             'libelle','Immatriculation du véhicule à restituer',
                             'fournie', public.hc_texte(dj,'restit_immatriculation') is not null),
          jsonb_build_object('cle','restit_vin',
                             'libelle','VIN du véhicule à restituer',
                             'fournie', public.hc_texte(dj,'restit_vin') is not null),
          jsonb_build_object('cle','restit_motorisation',
                             'libelle','Motorisation du véhicule à restituer',
                             'fournie', public.hc_texte(dj,'restit_motorisation') is not null),
          jsonb_build_object('cle','restit_adresse',
                             'libelle','Adresse de restitution',
                             'fournie', coalesce(public.hc_texte(dj,'adresse_restit_rue'),
                                                 public.hc_texte(dj,'adresse_restitution')) is not null),
          jsonb_build_object('cle','restit_date',
                             'libelle','Date de restitution',
                             'fournie', public.hc_texte(dj,'date_restitution') is not null),
          jsonb_build_object('cle','restit_contact_nom',
                             'libelle','Nom du contact à la restitution',
                             'fournie', public.hc_texte(dj,'restit_contact_nom') is not null),
          jsonb_build_object('cle','restit_contact_tel',
                             'libelle','Téléphone du contact à la restitution',
                             'fournie', public.hc_texte(dj,'restit_contact_tel') is not null));
      end if;
    end if;
  end if;

  -- ----------------------------------------------------------
  -- NETTOYAGE : tout vit dans nettoyage_details
  -- ----------------------------------------------------------
  if d.type_service = 'nettoyage' then
    lieu_nett := public.hc_texte(nd, 'lieu');

    requis := requis || jsonb_build_array(
      jsonb_build_object('cle','nettoyage_type','libelle','Prestation de nettoyage souhaitée',
                         'fournie', public.hc_texte(nd,'type_nettoyage') is not null),
      jsonb_build_object('cle','nettoyage_lieu','libelle','Lieu de l''intervention',
                         'fournie', lieu_nett is not null),
      jsonb_build_object('cle','nettoyage_date','libelle','Date de début d''intervention',
                         'fournie', public.hc_texte(nd,'date_souhaitee') is not null),
      -- Une intervention de nettoyage s'étale souvent sur plusieurs
      -- jours : sa FIN est aussi nécessaire pour planifier un partenaire.
      -- Les demandes antérieures ne la portent pas : elle est alors
      -- réclamée, comme n'importe quelle information manquante.
      jsonb_build_object('cle','nettoyage_date_fin','libelle','Date de fin d''intervention',
                         'fournie', public.hc_texte(nd,'date_fin') is not null),
      jsonb_build_object('cle','nettoyage_horaire','libelle','Horaire d''intervention',
                         'fournie', coalesce(public.hc_texte(nd,'heure_precise'),
                                             public.hc_texte(nd,'creneau_debut')) is not null),
      -- Le contact sur place est lu LÀ OÙ IL EST RÉELLEMENT enregistré,
      -- jamais dans clients.contact_pc_nom : c'est ce décalage qui le
      -- faisait apparaître à la fois « affiché » et « manquant ».
      jsonb_build_object('cle','contact_sur_place_nom','libelle','Nom du contact sur place',
                         'fournie', public.hc_texte(nd,'contact_sur_place','nom') is not null),
      jsonb_build_object('cle','contact_sur_place_tel','libelle','Téléphone du contact sur place',
                         'fournie', public.hc_texte(nd,'contact_sur_place','telephone') is not null));

    -- L'adresse n'est demandée que pour une intervention réellement
    -- située chez le client — exactement la règle du formulaire
    -- (_nettAdresseApplicable). Ailleurs, le lieu est connu d'HelixCar.
    if lieu_nett in ('locaux_client', 'parc_client') then
      requis := requis || jsonb_build_array(
        jsonb_build_object('cle','nettoyage_adresse','libelle','Adresse de l''intervention',
                           'fournie', public.hc_texte(nd,'adresse_rue') is not null),
        jsonb_build_object('cle','nettoyage_ville','libelle','Ville de l''intervention',
                           'fournie', public.hc_texte(nd,'adresse_ville') is not null));
    end if;
  end if;

  -- ----------------------------------------------------------
  -- TROUVER UN PROFESSIONNEL : tout vit dans professionnel_details
  -- ----------------------------------------------------------
  if d.type_service = 'professionnel' then
    requis := requis || jsonb_build_array(
      -- En mode conseil, le client demande explicitement qu'HelixCar
      -- choisisse le métier : ne rien réclamer serait correct, réclamer
      -- une spécialité serait absurde. La rubrique est donc satisfaite
      -- par la catégorie seule.
      -- Le métier n'est exigé que hors mode conseil : en conseil, le
      -- client demande précisément à HelixCar de le déterminer.
      jsonb_build_object('cle','professionnel_besoin','libelle','Professionnel recherché',
                         'fournie', public.hc_texte(pd,'categorie') is not null
                                    and (coalesce((pd ->> 'conseil')::boolean, false)
                                         or coalesce(public.hc_texte(pd,'specialite'),
                                                     public.hc_texte(pd,'mission')) is not null)),
      jsonb_build_object('cle','professionnel_adresse','libelle','Adresse de l''intervention',
                         'fournie', public.hc_texte(pd,'adresse_rue') is not null),
      jsonb_build_object('cle','professionnel_ville','libelle','Ville de l''intervention',
                         'fournie', public.hc_texte(pd,'adresse_ville') is not null),
      jsonb_build_object('cle','professionnel_date_debut','libelle','Date de début d''intervention',
                         'fournie', public.hc_texte(pd,'date_debut') is not null),
      jsonb_build_object('cle','professionnel_date_fin','libelle','Date de fin d''intervention',
                         'fournie', public.hc_texte(pd,'date_fin') is not null),
      jsonb_build_object('cle','professionnel_horaires','libelle','Horaires d''intervention',
                         'fournie', public.hc_texte(pd,'heure_debut') is not null
                                    and public.hc_texte(pd,'heure_fin') is not null),
      jsonb_build_object('cle','professionnel_description','libelle','Description de la mission',
                         'fournie', public.hc_texte(pd,'description') is not null),
      jsonb_build_object('cle','contact_sur_place_nom','libelle','Nom du contact sur place',
                         'fournie', public.hc_texte(pd,'contact_sur_place','nom') is not null),
      jsonb_build_object('cle','contact_sur_place_tel','libelle','Téléphone du contact sur place',
                         'fournie', public.hc_texte(pd,'contact_sur_place','telephone') is not null));
  end if;

  if jsonb_array_length(requis) = 0 then
    return;
  end if;

  return query
  select
    (r ->> 'cle')::text,
    (r ->> 'libelle')::text,
    coalesce(
      i.statut,
      case when (r ->> 'fournie')::boolean then 'fournie' else 'attendue' end
    )::text,
    i.valeur,
    i.commentaire
  from jsonb_array_elements(requis) with ordinality as t(r, ord)
  left join public.demande_informations_manquantes i
    on i.client_id = p_client_id
   and i.cle = (t.r ->> 'cle')
  order by t.ord;
end $function$

;
CREATE OR REPLACE FUNCTION public.verifier_valeur_information(p_cle text, p_valeur text)
 RETURNS void
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare chiffres text;
begin
 if p_cle ~ '(^|_)motorisation$' and p_valeur not in ('Essence','Diesel','Hybride','Hybride rechargeable','Électrique','Autre') then raise exception 'Sélectionnez une motorisation valide.' using errcode='22023'; end if;
 if length(p_valeur)>2000 then raise exception 'Information trop longue : %',p_cle using errcode='22023'; end if;
 if p_cle ~ '(_tel|telephone)$' then
  chiffres:=regexp_replace(p_valeur,'[^0-9]','','g');
  if length(chiffres)<7 or length(chiffres)>15 or p_valeur !~ '^\+?[0-9 ()./-]+$' then
   raise exception 'Téléphone incomplet ou invalide : %. Indiquez le numéro complet, avec indicatif pour un numéro international.',p_cle using errcode='22023';
  end if;
 end if;
end $function$

;
CREATE OR REPLACE FUNCTION public.synchroniser_information_validee()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare m text[]; col text;
begin
 if new.statut<>'validee' then return new; end if;
 if new.cle in ('motorisation','restit_motorisation') then
  execute format('update public.clients set %I=$1 where id=$2',new.cle) using new.valeur,new.client_id;
  return new;
 end if;
 m:=regexp_match(new.cle,'^vehicule_([0-9]+)_(.*)$');
 if m is null then return new; end if;
 col:=case m[2]
 when 'immatriculation' then 'immatriculation' when 'vin' then 'vin' when 'motorisation' then 'motorisation' when 'marque_modele' then 'marque_modele'
 when 'adresse_depart' then 'adresse_depart_rue' when 'adresse_arrivee' then 'adresse_arrivee_rue'
 when 'contact_pc_nom' then 'pc_contact_nom' when 'contact_pc_tel' then 'pc_contact_tel'
 when 'contact_liv_nom' then 'liv_contact_nom' when 'contact_liv_tel' then 'liv_contact_tel'
 when 'restit_contact_nom' then 'restit_contact_nom' when 'restit_contact_tel' then 'restit_contact_tel'
 when 'restit_adresse' then 'restit_adresse_rue' when 'restit_immatriculation' then 'restit_immatriculation'
 when 'restit_vin' then 'restit_vin' when 'restit_motorisation' then 'restit_motorisation' when 'restit_marque_modele' then 'restit_marque_modele' else null end;
 if col is not null then
  execute format('update public.vehicules set %I=$1 where dossier_id=$2 and position=$3',col) using new.valeur,new.client_id,m[1]::integer;
 elsif m[2]='date_prise_en_charge' then
  update public.vehicules set date_prise_en_charge=new.valeur::date where dossier_id=new.client_id and position=m[1]::integer;
 elsif m[2]='restit_date' then
  update public.vehicules set restit_date=new.valeur::date where dossier_id=new.client_id and position=m[1]::integer;
 end if;
 return new;
end $function$

;
CREATE OR REPLACE FUNCTION public.publier_preparation_mission(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.preparations_missions%rowtype; src jsonb; m public.missions%rowtype; ancien public.missions%rowtype;
 safe jsonb; oid uuid; rep jsonb; desc_pub text; cols text; is_test boolean;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 select * into p from public.preparations_missions where id=p_id;
 if not found then raise exception 'Brouillon introuvable'; end if;
 perform 1 from public.clients where id=p.client_id for update;
 select * into p from public.preparations_missions where id=p_id for update;
 if p.mission_id is not null then
  select id into oid from public.opportunites where mission_id=p.mission_id;
  return jsonb_build_object('ok',true,'code','DEJA_PUBLIEE','opportunite_id',oid);
 end if;
 src:=public.source_preparation_missions(p.client_id);
 if p.empreinte is distinct from src->>'empreinte' then raise exception 'La demande a changé. Rouvrez la préparation.'; end if;
 if exists(select 1 from public.informations_demande(p.client_id) where statut not in ('fournie','validee')) then raise exception 'Informations manquantes ou en attente de validation'; end if;
 if jsonb_array_length(coalesce(p.plan->'missing','[]'::jsonb))>0 then raise exception 'Complétez les informations de préparation'; end if;
 if coalesce((p.plan->>'remuneration')::numeric,0)<=0 then raise exception 'Renseignez le prix total de la mission'; end if;
 if p.plan->>'category'='convoyage' and (nullif(p.plan->>'motorisation','') is null or coalesce((p.plan->>'distance')::numeric,-1)<0) then raise exception 'Complétez la distance et la motorisation'; end if;
 if p.plan->'mission'->>'restitution'='true' and nullif(p.plan->>'restit_motorisation','') is null then raise exception 'Complétez la motorisation du véhicule à restituer'; end if;
 if p.plan->>'category'='convoyage' and (nullif(p.plan->'mission'->>'date_prise_en_charge','') is null or nullif(p.plan->'mission'->>'date_livraison','') is null or (p.plan->'mission'->>'date_livraison')::timestamp < (p.plan->'mission'->>'date_prise_en_charge')::timestamp) then raise exception 'Complétez les horaires et vérifiez la chronologie du trajet'; end if;
 if p.plan->>'date_debut' is null or p.plan->>'date_fin' is null or (p.plan->>'date_fin')::date<(p.plan->>'date_debut')::date then raise exception 'Vérifiez les dates'; end if;
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe from jsonb_each(p.plan->'mission') where key=any(array[
 'type_mission','ville_depart','ville_arrivee','type_vehicule','marque_modele','immatriculation','vin','adresse_depart','adresse_arrivee','contact_depart_nom','contact_depart_tel','contact_arrivee_nom','contact_arrivee_tel','date_prise_en_charge','date_livraison','plateau','consignes','nb_vehicules','restitution','adresse_restitution','restit_contact_nom','restit_contact_tel','restit_marque_modele','restit_immatriculation','restit_vin','restit_info','date_restitution_depart','prestation','adresse_intervention','code_postal_intervention','ville_intervention','contact_nom','contact_tel','date_intervention','date_fin_intervention','heure_intervention','heure_debut_intervention','heure_fin_intervention']);
 if safe->>'type_mission' not in ('convoyage','nettoyage','professionnel') then raise exception 'Type de mission invalide'; end if;
 -- Réutilisation d'un ancien brouillon payé ou du nettoyage créé par le serveur.
 select * into ancien from public.missions x where x.client_id=p.client_id and x.preparation_id is null and x.statut<>'annulee'
 and ((safe->>'type_mission'='nettoyage' and x.type_mission='nettoyage') or
 (safe->>'type_mission'='convoyage' and x.vehicule_source_id=nullif(p.plan->>'vehicule_id','')::uuid and x.devis_source_id=p.devis_id))
 order by created_at limit 1 for update;
 if ancien.id is not null then
  if ancien.convoyeur_id is not null or ancien.statut not in ('brouillon','en_attente') or exists(select 1 from public.opportunites where mission_id=ancien.id and statut<>'brouillon') then raise exception 'Une mission est déjà engagée pour ce véhicule. Ouvrez son opportunité existante.'; end if;
  safe:=to_jsonb(ancien)||safe;
 end if;
 select exists(select 1 from public.paiement_evenements where devis_id=p.devis_id and detail->>'livemode'='false') into is_test;
 safe:=safe||jsonb_build_object('id',coalesce(ancien.id,gen_random_uuid()),'reference',coalesce(ancien.reference,case when is_test then 'TEST-' else '' end||'M-'||substr(replace(p.id::text,'-',''),1,16)),
 'ville_depart',coalesce(safe->>'ville_depart',''),'ville_arrivee',coalesce(safe->>'ville_arrivee',''),'client_id',p.client_id,'preparation_id',p.id,'vehicule_source_id',nullif(p.plan->>'vehicule_id','')::uuid,'statut','brouillon',
 'created_at',coalesce(ancien.created_at,now()::timestamp),'remuneration_prevue',(p.plan->>'remuneration')::numeric,'distance_km',nullif(p.plan->>'distance','')::int);
 if p.plan->>'kind'='avant_stockage' then safe:=safe||jsonb_build_object('ville_arrivee','Noisy-le-Grand','adresse_arrivee',src->>'point_remise'); end if;
 if p.plan->>'kind'='apres_stockage' then safe:=safe||jsonb_build_object('ville_depart','Noisy-le-Grand','adresse_depart',src->>'point_remise'); end if;
 safe:=safe||jsonb_build_object('electrique',p.plan->>'motorisation'='Électrique','motorisation',p.plan->>'motorisation','restit_motorisation',case when p.plan->'mission'->>'restitution'='true' then p.plan->>'restit_motorisation' else null end);
 select * into m from jsonb_populate_record(null::public.missions,safe);
 if ancien.id is null then insert into public.missions select m.*;
 else
  select string_agg(format('%I=(jsonb_populate_record(null::public.missions,$1)).%I',key,key),',') into cols
   from jsonb_object_keys(safe) as keys(key) where key not in ('id','devis_source_id','vehicule_source_id','client_id','reference','created_at');
  execute 'update public.missions set '||cols||' where id=$2' using safe,ancien.id;
 end if;
 select id into oid from public.opportunites where mission_id=m.id;
 if oid is null then rep:=public.creer_brouillon_opportunite(m.id);oid:=(rep->>'id')::uuid; end if;
 if oid is null then raise exception 'Opportunité introuvable'; end if;
 select string_agg((value->>'label')||' : '||(value->>'value'),E'\n') into desc_pub from jsonb_array_elements(p.annonce->'rows');
 update public.opportunites set intitule=p.annonce->>'title',categorie=p.plan->>'category',
 date_debut=(p.plan->>'date_debut')::date,date_fin=(p.plan->>'date_fin')::date,zone_generale=public.texte_public_preparation(p.plan->>'zone',src),
 nb_professionnels=greatest(1,(p.plan->>'nb_professionnels')::int),badges_requis=array[p.plan->>'category'],description_publique=desc_pub,duree_texte=null
 where id=oid;
 rep:=public.publier_opportunite(oid);
 if not coalesce((rep->>'ok')::boolean,false) then raise exception 'Publication refusée : %',rep->>'code'; end if;
 update public.missions set statut='en_attente' where id=m.id and statut='brouillon';
 update public.preparations_missions set mission_id=m.id,updated_at=now() where id=p.id;
 return rep||jsonb_build_object('opportunite_id',oid,'mission_id',m.id);
end $function$

;
-- Le métier et le badge doivent correspondre, également sur les anciennes annonces.
do $$ declare def text; begin
 select pg_get_viewdef('public.v_opportunites_partenaire'::regclass,true) into def;
 execute 'create or replace view public.v_opportunites_partenaire as '||rtrim(btrim(def),';')||' AND o.categorie = ANY(public.activites_validees_partenaire())';
end $$;
CREATE OR REPLACE FUNCTION public.postuler_opportunite(p_opportunite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o        public.opportunites%rowtype;
  v_conv   uuid;
  v_valid  text[];
  v_id     uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTHENTIFIE');
  end if;
  v_conv := public.convoyeur_de_session();
  -- Compte client seul, partenaire refusé ou bloqué : refus, sans
  -- rien dire de l'opportunité.
  if v_conv is null or not public.partenaire_actif() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  v_valid := public.activites_validees_partenaire();
  if coalesce(array_length(v_valid, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'NON_VALIDE');
  end if;

  -- Verrou : une clôture concurrente ne peut pas se glisser entre la
  -- lecture de l'état et l'écriture de la candidature.
  select * into o from public.opportunites where id = p_opportunite_id for update;
  -- Un brouillon n'existe pas pour un partenaire.
  if not found or o.statut = 'brouillon' then
    return jsonb_build_object('ok', false, 'code', 'INTROUVABLE');
  end if;
  if not (o.badges_requis && v_valid) or not (o.categorie = any(v_valid)) then
    return jsonb_build_object('ok', false, 'code', 'NON_ELIGIBLE');
  end if;
  if o.statut = 'pourvue' then
    return jsonb_build_object('ok', false, 'code', 'CLOTUREE', 'statut', o.statut);
  end if;

  perform set_config('hc.decision_opportunite', '1', true);
  insert into public.opportunite_candidatures (opportunite_id, convoyeur_id, etat)
  values (p_opportunite_id, v_conv, 'a_etudier')
  on conflict (opportunite_id, convoyeur_id) do nothing
  returning id into v_id;
  perform set_config('hc.decision_opportunite', '', true);

  if v_id is null then
    return jsonb_build_object('ok', false, 'code', 'DEJA_CANDIDAT', 'statut', o.statut);
  end if;
  return jsonb_build_object('ok', true, 'code', 'CANDIDATURE_ENREGISTREE',
                            'etat', 'a_etudier', 'statut', o.statut);
end $function$

;
do $$ declare def text; begin
 select pg_get_viewdef('public.v_mes_demandes'::regclass,true) into def;
 execute 'create or replace view public.v_mes_demandes as select d.*, c.motorisation,c.restit_motorisation from ('||rtrim(btrim(def),';')||') d join public.clients c on c.id=d.id';
end $$;

-- Même filtre pour l'ancienne liste des missions disponibles. Les missions
-- déjà attribuées restent consultables par leur partenaire.
create policy missions_badge_disponibilite on public.missions as restrictive for select to authenticated
using (public.est_admin() or convoyeur_id=public.convoyeur_de_session() or public.retenu_preparation_mission(id)
 or (convoyeur_id is null and type_mission=any(public.activites_validees_partenaire())));

-- Les destinataires des notifications suivent le même métier que l'annonce.
do $$ declare def text; begin
 select pg_get_functiondef('public.publier_opportunite(uuid)'::regprocedure) into def;
 if position('and d.activite = any (o.badges_requis)' in def)=0 then raise exception 'Publication opportunité inattendue'; end if;
 execute replace(def,'and d.activite = any (o.badges_requis)','and d.activite = o.categorie and d.activite = any (o.badges_requis)');
end $$;
