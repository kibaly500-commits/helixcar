-- ============================================================
-- HelixCar — 94 : informations RÉELLEMENT manquantes
-- ============================================================
-- Dépend de : 06_informations_manquantes.sql
-- Idempotent : remplace deux fonctions en place. AUCUNE donnée n'est
-- créée, modifiée ni supprimée par cette migration.
--
-- ------------------------------------------------------------
-- CE QUI N'ALLAIT PAS
-- ------------------------------------------------------------
-- La version livrée avec 06 réclamait toujours les mêmes rubriques par
-- service, en lisant UNIQUEMENT les colonnes de public.clients. Quatre
-- défauts constatés :
--
-- 1. Données imbriquées ignorées. Le contact sur place d'une demande de
--    nettoyage vit dans nettoyage_details -> contact_sur_place -> nom,
--    pas dans clients.contact_pc_nom. Il s'affichait donc bien dans la
--    fiche tout en étant listé « Manquant » juste en dessous.
-- 2. Scénario ignoré. Si le client dépose lui-même son véhicule
--    (stockage_acheminement = 'depot_client'), HelixCar n'assure aucune
--    prise en charge : réclamer une adresse, une date ou un contact de
--    prise en charge n'a aucun sens. Idem à la sortie quand le client
--    récupère lui-même (stockage_sortie = 'recuperation_client').
-- 3. Emplacement réel des données de trajet ignoré. Depuis la refonte
--    « architecture unifiée » du formulaire, _trajetCommun() renvoie
--    TOUJOURS false : prise en charge, livraison et restitution vivent
--    exclusivement dans la fiche de CHAQUE véhicule (public.vehicules),
--    y compris à un seul véhicule. Les colonnes correspondantes de
--    public.clients partent donc à NULL sur toute demande récente — et
--    étaient systématiquement signalées manquantes alors que
--    l'information était bel et bien enregistrée.
-- 4. Véhicules non distingués. En multi-véhicules, rien n'indiquait
--    QUEL véhicule manquait d'immatriculation.
--
-- ------------------------------------------------------------
-- LA RÈGLE APPLIQUÉE
-- ------------------------------------------------------------
-- Une information n'est signalée manquante que si les TROIS conditions
-- sont réunies :
--   1. elle est APPLICABLE au scénario réellement choisi ;
--   2. elle est OBLIGATOIRE dans ce scénario ;
--   3. elle est RÉELLEMENT absente, où qu'elle soit stockée.
--
-- La signature de informations_demande(uuid) est inchangée : le
-- Dashboard, l'espace client et repondre_informations_demande()
-- continuent de fonctionner sans aucune modification.
--
-- ------------------------------------------------------------
-- RUBRIQUES DEVENUES OBSOLÈTES — AUCUNE SUPPRESSION ICI
-- ------------------------------------------------------------
-- Les clés 'nettoyage_details' et 'professionnel_details' (rubriques
-- « en bloc » de la version précédente) ne sont plus produites. Les
-- lignes correspondantes éventuellement déjà présentes dans
-- demande_informations_manquantes ne sont PAS supprimées par cette
-- migration : elles deviennent simplement inertes (plus jamais lues ni
-- affichées). repondre_informations_demande() les purgera de lui-même,
-- à la première réponse du client concerné, par le mécanisme de purge
-- déjà écrit dans 06.

-- ------------------------------------------------------------
-- PRÉALABLE : rendre le scénario de sortie LISIBLE côté serveur
-- ------------------------------------------------------------
-- En stockage avec sortie HelixCar, le formulaire demande véhicule par
-- véhicule si HelixCar le livre ou si le client vient le rechercher
-- (_vehiculeLivraisonApresStockage). Cette décision N'ÉTAIT PAS
-- enregistrée : elle ne figurait pas dans la liste des colonnes
-- envoyées. Impossible, dès lors, de savoir si une adresse de livraison
-- manque vraiment ou si elle n'a simplement pas lieu d'être.
--
-- Colonne ajoutée ici : nullable, sans valeur par défaut, purement
-- additive. Aucune ligne existante n'est modifiée ; NULL signifie
-- « décision inconnue » et déclenche le repli documenté plus bas.
alter table public.vehicules
  add column if not exists livraison_apres_stockage boolean;

comment on column public.vehicules.livraison_apres_stockage is
  'Stockage à sortie HelixCar : HelixCar livre ce véhicule (true) ou le '
  'client vient le rechercher (false). NULL = demande antérieure à ce '
  'champ, ou scénario sans sortie HelixCar.';

-- ------------------------------------------------------------
-- hc_texte — lecture d'une valeur texte non vide, où qu'elle soit
-- ------------------------------------------------------------
create or replace function public.hc_texte(p jsonb, variadic p_chemin text[])
returns text
language sql
immutable
as $$
  select nullif(btrim(coalesce(p #>> p_chemin, '')), '');
$$;

comment on function public.hc_texte(jsonb, text[]) is
  'Valeur texte d''un chemin JSONB, ou NULL si absente, nulle ou vide.';

create or replace function public.informations_demande(p_client_id uuid)
returns table (
  cle          text,
  libelle      text,
  statut       text,
  valeur       text,
  commentaire  text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
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
  if not (public.est_admin() or public.est_proprietaire_demande(p_client_id)) then
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
            'cle','vehicule_' || rang::text || '_marque_modele',
            'libelle', prefixe || case when n_veh > 1 then 'marque et modèle' else 'Marque et modèle' end,
            'fournie', nullif(btrim(coalesce(v.marque_modele,'')),'') is not null));

        if pc_helixcar then
          requis := requis || jsonb_build_array(
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_adresse_depart',
              'libelle', prefixe || case when n_veh > 1 then 'adresse de prise en charge' else 'Adresse de prise en charge' end,
              'fournie', coalesce(nullif(btrim(coalesce(v.adresse_depart_rue,'')),''),
                                  case when commun then public.hc_texte(dj,'adresse_depart_rue') end) is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_date_prise_en_charge',
              'libelle', prefixe || case when n_veh > 1 then 'date de prise en charge' else 'Date de prise en charge' end,
              'fournie', coalesce(v.date_prise_en_charge,
                                  case when commun then d.date_prise_en_charge end) is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_pc_nom',
              'libelle', prefixe || case when n_veh > 1 then 'nom du contact à la prise en charge' else 'Nom du contact à la prise en charge' end,
              'fournie', coalesce(nullif(btrim(coalesce(v.pc_contact_nom,'')),''),
                                  case when commun then public.hc_texte(dj,'contact_pc_nom') end) is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_pc_tel',
              'libelle', prefixe || case when n_veh > 1 then 'téléphone du contact à la prise en charge' else 'Téléphone du contact à la prise en charge' end,
              'fournie', coalesce(nullif(btrim(coalesce(v.pc_contact_tel,'')),''),
                                  case when commun then public.hc_texte(dj,'contact_pc_tel') end) is not null));
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
              'fournie', coalesce(nullif(btrim(coalesce(v.adresse_arrivee_rue,'')),''),
                                  case when commun then public.hc_texte(dj,'adresse_arrivee_rue') end) is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_liv_nom',
              'libelle', prefixe || case when n_veh > 1 then 'nom du contact à la livraison' else 'Nom du contact à la livraison' end,
              'fournie', coalesce(nullif(btrim(coalesce(v.liv_contact_nom,'')),''),
                                  case when commun then public.hc_texte(dj,'contact_liv_nom') end) is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_contact_liv_tel',
              'libelle', prefixe || case when n_veh > 1 then 'téléphone du contact à la livraison' else 'Téléphone du contact à la livraison' end,
              'fournie', coalesce(nullif(btrim(coalesce(v.liv_contact_tel,'')),''),
                                  case when commun then public.hc_texte(dj,'contact_liv_tel') end) is not null));
        end if;

        -- Restitution : uniquement si CE véhicule est concerné.
        if v.restitution_concernee is true then
          requis := requis || jsonb_build_array(
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_adresse',
              'libelle', prefixe || case when n_veh > 1 then 'adresse de restitution' else 'Adresse de restitution' end,
              'fournie', nullif(btrim(coalesce(v.restit_adresse_rue,'')),'') is not null),
            jsonb_build_object(
              'cle','vehicule_' || rang::text || '_restit_date',
              'libelle', prefixe || case when n_veh > 1 then 'date de restitution' else 'Date de restitution' end,
              'fournie', v.restit_date is not null));
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
      jsonb_build_object('cle','nettoyage_date','libelle','Date d''intervention',
                         'fournie', public.hc_texte(nd,'date_souhaitee') is not null),
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
end $$;

revoke all on function public.informations_demande(uuid) from public;
grant execute on function public.informations_demande(uuid) to authenticated;
-- Le droit d'exécution ne vaut PAS droit de lecture : la fonction
-- vérifie elle-même que l'appelant est administrateur ou propriétaire.

comment on function public.informations_demande(uuid) is
  'Rubriques réellement requises pour une demande, selon le scénario '
  'effectivement choisi, avec leur statut dérivé. Calculé côté serveur '
  'à partir des données enregistrées — jamais depuis le navigateur.';

-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- Réappliquer migrations/06_informations_manquantes.sql : il contient
-- la version précédente de informations_demande(uuid), avec la même
-- signature.
--
-- La colonne vehicules.livraison_apres_stockage doit être LAISSÉE EN
-- PLACE : elle est nullable, sans contrainte, et la version précédente
-- de l'application l'ignore purement et simplement. La retirer
-- supprimerait des informations réellement saisies par des clients.
-- Elle n'est à retirer que si l'on renonce définitivement au champ :
--   alter table public.vehicules drop column if exists livraison_apres_stockage;
--
-- public.hc_texte(jsonb, text[]) peut rester en place sans effet, ou
-- être retirée par :
--   drop function if exists public.hc_texte(jsonb, text[]);
--
-- Aucune donnée n'est perdue en appliquant cette migration : elle
-- ajoute une colonne vide et remplace une fonction de LECTURE.
