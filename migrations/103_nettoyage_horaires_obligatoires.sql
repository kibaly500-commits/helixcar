-- ============================================================
-- HelixCar — 103 : l'horaire de nettoyage, exigé et complet
-- ============================================================
-- Dépend de : 96_missions_nettoyage.sql, 101_informations_types_coherents.sql,
--             102_nettoyage_periode_et_mission.sql
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : deux colonnes nullables, trois convertisseurs
-- sans effet de bord, et deux fonctions remplacées par « create or
-- replace ». Aucune donnée modifiée, aucune RLS désactivée, aucun
-- bucket ouvert.
--
-- LES MIGRATIONS 92 À 102 NE SONT PAS RETOUCHÉES. Elles sont déjà
-- appliquées en production : toute évolution passe par ce fichier.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT
-- ------------------------------------------------------------
--   1. L'horaire sur place était FACULTATIF. Une intervention de
--      nettoyage se planifie pourtant : sans heure d'arrivée ni heure
--      de fin, ni le partenaire ni le client ne savent quand elle a
--      lieu. Le formulaire les exige désormais tous les deux.
--
--   2. Les informations manquantes ne connaissaient qu'UNE rubrique,
--      « Horaire d'intervention », satisfaite dès que l'heure de DÉBUT
--      existait. Une demande sans heure de fin était donc présentée
--      comme complète, et la mission se créait sans heure de fin.
--
--   3. La mission n'avait qu'une colonne `heure_intervention`, où les
--      deux bornes étaient concaténées en texte. Le partenaire lisait
--      « 09:00 – 17:00 » ou « 09:00 » sans pouvoir distinguer une fin
--      absente d'une intervention d'une heure.
--
-- ------------------------------------------------------------
-- 1. L'HEURE DE FIN D'INTERVENTION, DANS SA PROPRE COLONNE
-- ------------------------------------------------------------
-- `heure_intervention` est CONSERVÉE telle quelle : les missions déjà
-- créées la portent, le Dashboard et les fiches partenaire la lisent.
-- On ajoute la borne de fin à côté, sans jamais réécrire l'existant.
alter table public.missions
  add column if not exists heure_debut_intervention time,
  add column if not exists heure_fin_intervention   time;

comment on column public.missions.heure_debut_intervention is
  'Heure d''arrivée sur place. Renseignée depuis le lot D3 ; les '
  'missions antérieures la laissent vide et restent lisibles.';
comment on column public.missions.heure_fin_intervention is
  'Heure de fin sur place. Renseignée depuis le lot D3 ; les missions '
  'antérieures la laissent vide et restent lisibles.';

-- ------------------------------------------------------------
-- 2. DEUX RUBRIQUES D'INFORMATION, PAS UNE
-- ------------------------------------------------------------
-- Corps repris de la migration 101 À L'IDENTIQUE, à la seule rubrique
-- « Horaire d'intervention » près, remplacée par deux rubriques
-- distinctes. Aucune autre règle métier n'est modifiée :
--
--   * le contrôle d'autorisation interne (administrateur OU
--     propriétaire réel de la demande) est repris tel quel ;
--   * la logique booléenne qui a remplacé les COALESCE entre types
--     incompatibles est reprise telle quelle ;
--   * le scénario réellement choisi continue de commander ce qui est
--     réclamé : aucune prise en charge HelixCar n'est demandée quand le
--     client dépose lui-même, aucune livraison quand il récupère
--     lui-même, aucune restitution quand le véhicule n'est pas
--     concerné.
--
-- La clé historique 'nettoyage_horaire' n'est pas réutilisée : une
-- réponse déjà enregistrée sous cette clé répondait à une autre
-- question.
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
      jsonb_build_object('cle','nettoyage_date','libelle','Date de début d''intervention',
                         'fournie', public.hc_texte(nd,'date_souhaitee') is not null),
      -- Une intervention de nettoyage s'étale souvent sur plusieurs
      -- jours : sa FIN est aussi nécessaire pour planifier un partenaire.
      -- Les demandes antérieures ne la portent pas : elle est alors
      -- réclamée, comme n'importe quelle information manquante.
      jsonb_build_object('cle','nettoyage_date_fin','libelle','Date de fin d''intervention',
                         'fournie', public.hc_texte(nd,'date_fin') is not null),
      -- LOT D3 — l'horaire sur place devient OBLIGATOIRE, et il a deux
      -- bornes distinctes. Une seule rubrique « Horaire d'intervention »
      -- ne pouvait pas dire laquelle des deux manquait : le client
      -- voyait « fournie » alors que l'heure de fin était absente.
      --
      -- La clé historique 'nettoyage_horaire' n'est PAS réutilisée : une
      -- réponse déjà enregistrée sous cet ancien libellé porterait sur
      -- une question différente. Les anciennes réponses restent en base,
      -- simplement plus rattachées à une rubrique demandée.
      jsonb_build_object('cle','nettoyage_horaire_debut','libelle','Horaire de début sur place',
                         'fournie', coalesce(public.hc_texte(nd,'creneau_debut'),
                                             public.hc_texte(nd,'heure_precise')) is not null),
      jsonb_build_object('cle','nettoyage_horaire_fin','libelle','Horaire de fin sur place',
                         'fournie', public.hc_texte(nd,'creneau_fin') is not null),
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

comment on function public.informations_demande(uuid) is
  'Rubriques réellement requises pour une demande, selon le scénario '
  'effectivement choisi, avec leur statut dérivé. Calculé côté serveur '
  'à partir des données enregistrées — jamais depuis le navigateur. '
  'Depuis le lot D3, l''horaire de nettoyage compte DEUX rubriques : '
  'début et fin sur place.';

-- ------------------------------------------------------------
-- 3. LA MISSION REPREND LES DEUX BORNES HORAIRES
-- ------------------------------------------------------------
-- Corps repris de la migration 102 À L'IDENTIQUE, à l'écriture des deux
-- nouvelles colonnes près. Toutes les garanties de 102 sont conservées
-- telles quelles, et re-vérifiées par la suite t_rls :
--
--   * `est_admin()` exigé, fonction `security definer` à `search_path`
--     fixé ;
--   * un devis au statut `accepte` exigé ;
--   * zéro information `attendue` exigée — donc, depuis ce fichier, la
--     mission ne se crée plus tant qu'il manque une des deux heures ;
--   * une seule mission par demande, garantie par l'index unique de
--     102, et rejeu idempotent (`DEJA_CREEE`) ;
--   * la référence tirée d'une SÉQUENCE, jamais d'un `max()` relu.
-- ------------------------------------------------------------
-- 2 bis. CONVERTIR SANS JAMAIS FAIRE ÉCHOUER
-- ------------------------------------------------------------
-- La création de mission lisait `nettoyage_details`, un JSONB écrit par
-- le navigateur, et convertissait ses valeurs en filtrant d'abord leur
-- FORME par une expression régulière. Une forme n'est pas une valeur :
--
--   '25:30'       passe '^[0-2][0-9]:[0-5][0-9]$'  et ::time  ÉCHOUE
--   '2026-02-30'  passe '^\d{4}-\d{2}-\d{2}$'     et ::date  ÉCHOUE
--   '99999999999' passe '^[0-9]+$'                 et ::integer ÉCHOUE
--
-- Dans ces trois cas, l'erreur remontait jusqu'à l'appelant : la
-- mission n'était pas créée, et l'administrateur restait bloqué sur un
-- dossier qu'il ne pouvait plus débloquer. Le filtre par forme est donc
-- remplacé par une conversion qui tente vraiment, et qui rend NULL
-- quand elle échoue — ce que le commentaire d'origine promettait déjà.
--
-- Ces trois fonctions ne lisent aucune donnée, ne prennent aucune
-- décision d'autorisation et n'ont donc pas besoin d'être `security
-- definer`. Elles sont `strict` : une entrée NULL ressort NULL sans
-- rien exécuter.
create or replace function public.hc_vers_heure(p text)
returns time
language plpgsql
immutable
strict
set search_path = pg_temp
as $$
begin
  return p::time;
exception when others then
  return null;
end $$;

create or replace function public.hc_vers_date(p text)
returns date
language plpgsql
immutable
strict
set search_path = pg_temp
as $$
begin
  return p::date;
exception when others then
  return null;
end $$;

create or replace function public.hc_vers_entier(p text)
returns integer
language plpgsql
immutable
strict
set search_path = pg_temp
as $$
begin
  return p::integer;
exception when others then
  return null;
end $$;

comment on function public.hc_vers_heure(text) is
  'Heure convertie depuis un texte, ou NULL si la conversion échoue. '
  'Ne lève jamais d''erreur : une donnée inattendue laisse la colonne vide.';
comment on function public.hc_vers_date(text) is
  'Date convertie depuis un texte, ou NULL si la conversion échoue. '
  'Ne lève jamais d''erreur : une donnée inattendue laisse la colonne vide.';
comment on function public.hc_vers_entier(text) is
  'Entier converti depuis un texte, ou NULL si la conversion échoue. '
  'Ne lève jamais d''erreur : une donnée inattendue laisse la colonne vide.';

create or replace function public.creer_mission_nettoyage_si_prete(
  p_client_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d          public.clients%rowtype;
  nd         jsonb;
  m          public.missions%rowtype;
  v_manque   integer;
  v_devis    integer;
  v_ref      text;
  v_annee    integer := extract(year from now())::integer;
  v_num      bigint;
  v_contact  jsonb;
begin
  if not public.est_admin() then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;

  select * into d from public.clients c where c.id = p_client_id;
  if not found or d.type_service is distinct from 'nettoyage' then
    return jsonb_build_object('ok', false, 'code', 'DEMANDE_INTROUVABLE');
  end if;

  -- Déjà créée : on la renvoie, sans rien écrire.
  select * into m
    from public.missions mm
   where mm.client_id = p_client_id
     and mm.type_mission = 'nettoyage'
     and mm.statut <> 'annulee'
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREEE',
                              'id', m.id, 'reference', m.reference);
  end if;

  -- Un devis ACCEPTÉ, sinon rien. Un devis refusé ne crée aucune mission.
  select count(*) into v_devis
    from public.devis dv
   where dv.client_id = p_client_id
     and dv.statut = 'accepte';
  if v_devis = 0 then
    return jsonb_build_object('ok', false, 'code', 'DEVIS_NON_ACCEPTE');
  end if;

  -- Plus rien d'attendu. On réutilise la SEULE source de vérité des
  -- informations nécessaires — aucune règle recopiée ici.
  select count(*) into v_manque
    from public.informations_demande(p_client_id) i
   where i.statut = 'attendue';
  if v_manque > 0 then
    return jsonb_build_object('ok', false, 'code', 'INFORMATIONS_MANQUANTES',
                              'manquantes', v_manque);
  end if;

  nd       := coalesce(d.nettoyage_details, '{}'::jsonb);
  v_contact := coalesce(nd -> 'contact_sur_place', '{}'::jsonb);

  -- Séquence, jamais un max() : deux appels simultanés obtiennent deux
  -- numéros différents (voir § 2 bis).
  v_num := nextval('public.missions_nettoyage_numero');
  v_ref := 'HC-NET-' || v_annee || '-' || lpad(v_num::text, 4, '0');

  insert into public.missions (
    reference, type_mission, statut, client_id,
    prestation, nb_vehicules,
    adresse_intervention, code_postal_intervention, ville_intervention,
    contact_nom, contact_tel,
    date_intervention, date_fin_intervention, heure_intervention,
    heure_debut_intervention, heure_fin_intervention
  ) values (
    v_ref, 'nettoyage', 'en_attente', p_client_id,
    -- La prestation est LUE PAR LE PARTENAIRE : on écrit le libellé, pas
    -- la clé technique. Les libellés vivent d'ordinaire dans le
    -- navigateur (NETT_LIB_TYPE) ; le serveur, qui crée désormais la
    -- mission, doit connaître les mêmes. Une clé inconnue est recopiée
    -- telle quelle plutôt que perdue.
    case nd ->> 'type_nettoyage'
      when 'interieur'             then 'Nettoyage intérieur'
      when 'exterieur'             then 'Nettoyage extérieur'
      when 'interieur_exterieur'   then 'Nettoyage intérieur et extérieur'
      when 'preparation_complete'  then 'Préparation complète — intérieur et extérieur'
      when 'conseil'               then 'Client à conseiller'
      else nullif(btrim(coalesce(nd ->> 'type_nettoyage', '')), '')
    end,
    -- Conversions DÉFENSIVES (§ 2 bis). Une demande ancienne, ou une
    -- donnée inattendue, ne doit pas faire échouer la création : ce qui
    -- n'est pas convertible est simplement laissé vide. La tentative de
    -- conversion est RÉELLE, jamais un simple contrôle de forme.
    public.hc_vers_entier(nullif(btrim(coalesce(nd ->> 'nombre_vehicules_approx', '')), '')),
    coalesce(nullif(btrim(coalesce(nd ->> 'adresse_rue', '')), ''),
             case when nd ->> 'lieu' = 'helixcar' then 'Locaux HelixCar' end),
    nullif(btrim(coalesce(nd ->> 'adresse_cp', '')), ''),
    nullif(btrim(coalesce(nd ->> 'adresse_ville', '')), ''),
    nullif(btrim(coalesce(v_contact ->> 'nom', '')), ''),
    nullif(btrim(coalesce(v_contact ->> 'telephone', '')), ''),
    public.hc_vers_date(nullif(btrim(coalesce(nd ->> 'date_souhaitee', '')), '')),
    public.hc_vers_date(nullif(btrim(coalesce(nd ->> 'date_fin', '')), '')),
    nullif(btrim(
      coalesce(nd ->> 'creneau_debut', '')
      || case when coalesce(nd ->> 'creneau_fin', '') <> '' then ' – ' || (nd ->> 'creneau_fin') else '' end
    ), ''),
    -- LOT D3 — les deux bornes, chacune dans sa colonne. Même
    -- conversion réellement défensive que pour les dates : une donnée
    -- ancienne ou inattendue laisse la colonne vide plutôt que de faire
    -- échouer la création de la mission.
    public.hc_vers_heure(nullif(btrim(coalesce(nd ->> 'creneau_debut', '')), '')),
    public.hc_vers_heure(nullif(btrim(coalesce(nd ->> 'creneau_fin', '')), ''))
  )
  returning * into m;

  return jsonb_build_object('ok', true, 'code', 'CREEE',
                            'id', m.id, 'reference', m.reference);
exception
  -- Course entre deux appels simultanés : l'index unique tranche, et
  -- l'appel perdant renvoie la mission gagnante plutôt qu'une erreur.
  when unique_violation then
    select * into m
      from public.missions mm
     where mm.client_id = p_client_id
       and mm.type_mission = 'nettoyage'
       and mm.statut <> 'annulee'
     limit 1;
    return jsonb_build_object('ok', true, 'code', 'DEJA_CREEE',
                              'id', m.id, 'reference', m.reference);
end $$;
revoke all on function public.creer_mission_nettoyage_si_prete(uuid) from public;
grant execute on function public.creer_mission_nettoyage_si_prete(uuid) to authenticated;

comment on function public.creer_mission_nettoyage_si_prete(uuid) is
  'Crée LA mission de nettoyage d''une demande, une seule fois, quand le '
  'devis est accepté et qu''aucune information n''est plus attendue. '
  'Depuis le lot D3, la mission porte aussi les heures de début et de '
  'fin sur place dans leurs propres colonnes.';

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
-- Depuis le SQL Editor, en tant qu'administrateur :
--
--   select column_name, data_type
--     from information_schema.columns
--    where table_name = 'missions'
--      and column_name in ('heure_debut_intervention','heure_fin_intervention');
--   -- attendu : 2 lignes, type « time without time zone »
--
--   select cle, libelle, statut
--     from public.informations_demande('<uuid d''une demande de nettoyage>')
--    where cle like 'nettoyage_horaire%';
--   -- attendu : 2 lignes — nettoyage_horaire_debut et
--   --           nettoyage_horaire_fin — et AUCUNE erreur
--
--   select count(*) from pg_proc
--    where proname in ('informations_demande','creer_mission_nettoyage_si_prete');
--   -- attendu : 2  (une seule signature par nom, aucune ambiguïté
--   --               PostgREST)
--
--   select public.hc_vers_heure('25:30')  is null   -- attendu : true
--        , public.hc_vers_date('2026-02-30') is null -- attendu : true
--        , public.hc_vers_entier('99999999999') is null -- attendu : true
--        , public.hc_vers_heure('08:30')     -- attendu : 08:30:00
--        , public.hc_vers_date('2026-12-01') -- attendu : 2026-12-01
--        , public.hc_vers_entier('3');       -- attendu : 3
--   -- AUCUNE erreur ne doit remonter : c'est tout l'objet du § 2 bis.
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- Du moins destructeur au plus destructeur :
--
--   1. Ne rien faire. Ce fichier n'ajoute que deux colonnes nullables,
--      trois convertisseurs sans effet de bord, et affine deux
--      fonctions. Aucune donnée n'est modifiée.
--
--   2. Revenir aux fonctions de 101 et 102 : réappliquer
--      migrations/101_informations_types_coherents.sql puis
--      migrations/102_nettoyage_periode_et_mission.sql.
--      ⚠️ L'horaire de fin cesse alors d'être réclamé, et une mission
--      peut à nouveau se créer sans lui.
--
--   3. Retirer les colonnes :
--        alter table public.missions
--          drop column if exists heure_debut_intervention,
--          drop column if exists heure_fin_intervention;
--      ⚠️ DESTRUCTIF : les heures déjà enregistrées seraient perdues.
--      `heure_intervention`, elle, n'est jamais touchée par ce fichier.
