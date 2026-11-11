-- ============================================================
-- HelixCar — 110 : paiement confirmé côté serveur, mission créée
--                  seulement après paiement ET informations complètes
--                  (lot Q02, décision C02)
-- ============================================================
-- Dépend de : 00_helpers.sql (est_admin), 06_informations_manquantes.sql
--             (demande_informations_manquantes, repondre_informations_demande,
--             clients.auth_user_id), 101_informations_types_coherents.sql
--             (informations_demande), 103_nettoyage_horaires_obligatoires.sql
--             (creer_mission_nettoyage_si_prete, hc_vers_*),
--             106_devis_versions_et_journal_envois.sql (devis.version,
--             paiement_statut, paiement_confirme_le),
--             109_fidelite_points.sql (garde_paiement_devis : l'état de
--             paiement est réservé au serveur ou à un administrateur).
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : une table de journal fermée par RLS, une vue
-- client, trois fonctions et un déclencheur. La fonction
-- creer_mission_nettoyage_si_prete est REMPLACÉE par une version qui
-- exige le paiement confirmé (C02) — même signature, mêmes codes,
-- un code de plus. Aucune donnée existante modifiée, aucune RLS
-- affaiblie, aucun objet Stripe.
--
-- LES MIGRATIONS 00 À 109 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- DÉCISION C02 (définitive), telle qu'appliquée ici
-- ------------------------------------------------------------
--   * Une mission n'est JAMAIS créée sur la seule acceptation du devis.
--     Deux conditions, toutes deux vérifiées par le serveur : le
--     paiement est confirmé (devis.paiement_statut = 'paye') ET aucune
--     information indispensable ne manque (informations_demande).
--   * « Payé » n'est posé QUE par le serveur : traiter_paiement_confirme
--     n'est exécutable ni par anon ni par authenticated, et refuse
--     toute session (auth.uid() non nul). Le futur webhook Stripe
--     (fonction Edge, clé service_role) l'appellera après avoir vérifié
--     la signature de l'événement. Aucune page de succès, aucun clic,
--     aucun administrateur ne peut marquer un devis payé.
--   * Idempotence : chaque événement du prestataire est enregistré une
--     seule fois (fournisseur + identifiant uniques). Rejouer le même
--     événement ne change rien et ne crée rien.
--   * Création unique de la mission : si tout est complet au moment du
--     paiement, elle est créée dans la même transaction ; sinon elle
--     est créée par le déclencheur, quand la DERNIÈRE information
--     indispensable est transmise par le client. Toujours idempotente
--     (index unique existant sur missions, code DEJA_CREEE).
--
-- CE QUI N'EST PAS DANS CETTE MIGRATION (documenté, rien d'inventé) :
--   * Stripe (Checkout, webhook, facture) : gate Q01 non validé en
--     réception réelle ; aucun objet de paiement n'est créé ici.
--   * La création automatique ne couvre que le NETTOYAGE (seule
--     fonction serveur de création existante, migration 102/103). Pour
--     les autres services, creer_mission_si_prete répond
--     SERVICE_SANS_CREATION_AUTOMATIQUE : la mission reste créée par
--     l'administrateur, et le paiement reste tracé.

-- ------------------------------------------------------------
-- 1. LE JOURNAL DES ÉVÉNEMENTS DE PAIEMENT
-- ------------------------------------------------------------
-- Une ligne par événement REÇU du prestataire, traité ou non. C'est ce
-- qui rend le traitement idempotent (Q02-009) et traçable (Q02-012).
create table if not exists public.paiement_evenements (
  id             uuid primary key default gen_random_uuid(),
  devis_id       uuid not null references public.devis(id) on delete cascade,
  fournisseur    text not null check (fournisseur in ('stripe', 'test')),
  evenement_id   text not null,
  type           text not null default 'paiement_confirme'
                   check (type in ('paiement_confirme', 'remboursement',
                                   'remboursement_partiel', 'echec')),
  montant        numeric,
  devise         text not null default 'EUR',
  resultat       text,
  detail         jsonb not null default '{}'::jsonb,
  recu_le        timestamptz not null default now(),
  unique (fournisseur, evenement_id)
);

comment on table public.paiement_evenements is
  'Journal des événements de paiement reçus du prestataire. Une ligne '
  'par événement, jamais deux (fournisseur + identifiant uniques) : un '
  'webhook rejoué ne fait rien. resultat = code renvoyé au moment du '
  'traitement. Lecture administrateur seulement.';

create index if not exists paiement_evenements_devis_idx
  on public.paiement_evenements (devis_id, recu_le desc);

revoke all on public.paiement_evenements from anon;
revoke all on public.paiement_evenements from authenticated;
grant select on public.paiement_evenements to authenticated;
alter table public.paiement_evenements enable row level security;

drop policy if exists "paiement_evenements : lecture admin" on public.paiement_evenements;
create policy "paiement_evenements : lecture admin"
  on public.paiement_evenements for select to authenticated
  using (public.est_admin());

-- ------------------------------------------------------------
-- 2. LA VUE CLIENT : SES DEVIS, SANS RIEN D'INTERNE
-- ------------------------------------------------------------
-- Le client voit l'état de SES devis depuis son espace (envoyé,
-- accepté — paiement en attente, payé, refusé) : jamais un brouillon
-- (genere), jamais le jeton, jamais le chemin du PDF, jamais un devis
-- d'un autre compte. Même principe que v_mes_demandes (migration 06) :
-- filtre sur auth.uid(), security_invoker désactivé.
create or replace view public.v_mes_devis as
select
  dv.id,
  dv.client_id,
  dv.reference,
  dv.version,
  dv.version_envoyee,
  dv.version_acceptee,
  dv.statut,
  dv.paiement_statut,
  dv.prix,
  dv.date_envoi,
  dv.date_acceptation,
  dv.date_refus,
  dv.consulte_le,
  dv.paiement_confirme_le,
  dv.date_generation
from public.devis dv
join public.clients c on c.id = dv.client_id
where c.auth_user_id = auth.uid()
  and dv.statut in ('envoye', 'accepte', 'refuse');

alter view public.v_mes_devis set (security_invoker = off);
revoke all on public.v_mes_devis from anon;
revoke all on public.v_mes_devis from authenticated;
grant select on public.v_mes_devis to authenticated;

comment on view public.v_mes_devis is
  'Devis du client de la session (envoyés, acceptés, refusés), sans '
  'jeton ni chemin de fichier. Vide sans session ou pour un autre compte.';


-- ------------------------------------------------------------
-- 2 bis. informations_demande : lisible par le SERVEUR sous drapeau
-- ------------------------------------------------------------
-- Corps repris VERBATIM de la migration 101 (généré depuis son texte,
-- jamais réécrit à la main) ; seule la garde d'autorisation change :
-- le serveur, pendant un paiement confirmé ou une complétion, doit
-- pouvoir compter ce qui manque — sinon la mission se créerait sur
-- un rapport vide. Le drapeau n'est posé que par les fonctions de
-- cette migration ; anon et un tiers repartent toujours avec zéro
-- ligne. Grants inchangés (authenticated seulement).
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
  -- Migration 110 : le serveur (paiement confirmé, création de mission
  -- après la dernière information) lit le rapport sous le drapeau de
  -- transaction hc.creation_mission_serveur, posé uniquement par les
  -- fonctions serveur de cette migration. Aucun autre appelant.
  if not (public.est_admin() or public.est_proprietaire_demande(p_client_id)
          or coalesce(current_setting('hc.creation_mission_serveur', true), '') = '1') then
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

-- ------------------------------------------------------------
-- 3. LA CRÉATION DE MISSION NETTOYAGE EXIGE LE PAIEMENT (C02)
-- ------------------------------------------------------------
-- Même signature et mêmes codes que la version 103, plus
-- PAIEMENT_NON_CONFIRME (devis accepté mais non payé). Peut être
-- appelée par un administrateur, par le serveur (auth.uid() nul :
-- webhook, SQL Editor) ou par le déclencheur de complétion ci-dessous
-- (drapeau de transaction hc.creation_mission_serveur).
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
  v_payes    integer;
  v_ref      text;
  v_annee    integer := extract(year from now())::integer;
  v_num      bigint;
  v_contact  jsonb;
begin
  if auth.uid() is not null
     and not public.est_admin()
     and coalesce(current_setting('hc.creation_mission_serveur', true), '') <> '1' then
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
  select count(*), count(*) filter (where dv.paiement_statut = 'paye')
    into v_devis, v_payes
    from public.devis dv
   where dv.client_id = p_client_id
     and dv.statut = 'accepte';
  if v_devis = 0 then
    return jsonb_build_object('ok', false, 'code', 'DEVIS_NON_ACCEPTE');
  end if;
  -- C02 : accepté ne suffit pas. Le paiement doit être confirmé par le
  -- serveur (traiter_paiement_confirme), jamais par un clic.
  if v_payes = 0 then
    return jsonb_build_object('ok', false, 'code', 'PAIEMENT_NON_CONFIRME');
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
    case nd ->> 'type_nettoyage'
      when 'interieur'             then 'Nettoyage intérieur'
      when 'exterieur'             then 'Nettoyage extérieur'
      when 'interieur_exterieur'   then 'Nettoyage intérieur et extérieur'
      when 'preparation_complete'  then 'Préparation complète'
      when 'conseil'               then 'Client à conseiller'
      else nullif(btrim(coalesce(nd ->> 'type_nettoyage', '')), '')
    end,
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
    public.hc_vers_heure(nullif(btrim(coalesce(nd ->> 'creneau_debut', '')), '')),
    public.hc_vers_heure(nullif(btrim(coalesce(nd ->> 'creneau_fin', '')), ''))
  )
  returning * into m;
  return jsonb_build_object('ok', true, 'code', 'CREEE',
                            'id', m.id, 'reference', m.reference);
exception
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
  'devis est accepté, PAYÉ (C02, migration 110) et qu''aucune information '
  'n''est plus attendue. « Préparation complète » est écrite sous sa '
  'formule courte (F01-037).';

-- ------------------------------------------------------------
-- 4. UN SEUL POINT D'ENTRÉE : creer_mission_si_prete
-- ------------------------------------------------------------
-- Appelé par le paiement confirmé et par la complétion. Seul le
-- nettoyage dispose d'une création serveur ; pour les autres services
-- la réponse le dit, sans rien inventer ni rien créer.
create or replace function public.creer_mission_si_prete(p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service text;
begin
  select c.type_service into v_service from public.clients c where c.id = p_client_id;
  if v_service is null then
    return jsonb_build_object('ok', false, 'code', 'DEMANDE_INTROUVABLE');
  end if;
  if v_service = 'nettoyage' then
    return public.creer_mission_nettoyage_si_prete(p_client_id);
  end if;
  return jsonb_build_object('ok', false, 'code', 'SERVICE_SANS_CREATION_AUTOMATIQUE',
                            'service', v_service);
end $$;

revoke all on function public.creer_mission_si_prete(uuid) from public;
grant execute on function public.creer_mission_si_prete(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. LE PAIEMENT CONFIRMÉ : SERVEUR SEULEMENT, IDEMPOTENT
-- ------------------------------------------------------------
create or replace function public.traiter_paiement_confirme(
  p_devis_id     uuid,
  p_fournisseur  text,
  p_evenement_id text,
  p_montant      numeric default null,
  p_devise       text default 'EUR',
  p_detail       jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d         public.devis%rowtype;
  v_ev      uuid;
  v_code    text;
  v_mission jsonb := null;
begin
  -- Q02-008 : seul le serveur (webhook vérifié, SQL Editor) marque un
  -- devis payé. Une session — même administrateur — est refusée.
  if auth.uid() is not null then
    return jsonb_build_object('ok', false, 'code', 'NON_AUTORISE');
  end if;
  if p_fournisseur is null or p_fournisseur not in ('stripe', 'test')
     or nullif(btrim(coalesce(p_evenement_id, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'EVENEMENT_INVALIDE');
  end if;

  select * into d from public.devis where id = p_devis_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'DEVIS_INTROUVABLE');
  end if;

  -- Q02-009 : chaque événement est traité UNE fois. Le rejeu répond
  -- l'état courant, sans rien changer.
  insert into public.paiement_evenements
    (devis_id, fournisseur, evenement_id, type, montant, devise, detail)
  values (d.id, p_fournisseur, p_evenement_id, 'paiement_confirme', p_montant,
          coalesce(nullif(btrim(p_devise), ''), 'EUR'), coalesce(p_detail, '{}'::jsonb))
  on conflict (fournisseur, evenement_id) do nothing
  returning id into v_ev;
  if v_ev is null then
    return jsonb_build_object('ok', true, 'code', 'DEJA_TRAITE',
                              'devis_id', d.id, 'paiement_statut', d.paiement_statut);
  end if;

  -- Le paiement ne se confirme que sur un devis accepté, pour son
  -- montant, en euros. Tout écart est journalisé et refusé.
  if d.statut <> 'accepte' then
    v_code := 'DEVIS_NON_ACCEPTE';
  elsif p_montant is not null and round(p_montant, 2) <> round(coalesce(d.prix, 0), 2) then
    v_code := 'MONTANT_INCOHERENT';
  elsif upper(coalesce(nullif(btrim(p_devise), ''), 'EUR')) <> 'EUR' then
    v_code := 'DEVISE_INCOHERENTE';
  elsif d.paiement_statut = 'paye' then
    v_code := 'DEJA_PAYE';
  else
    v_code := 'PAYE';
  end if;

  if v_code in ('PAYE', 'DEJA_PAYE') then
    if v_code = 'PAYE' then
      update public.devis
         set paiement_statut = 'paye',
             paiement_confirme_le = coalesce(paiement_confirme_le, now())
       where id = d.id;
    end if;
    -- Q02-013/016 : si tout est complet, la mission est créée ICI, dans
    -- la même transaction. Sinon elle attendra la dernière information.
    perform set_config('hc.creation_mission_serveur', '1', true);
    v_mission := public.creer_mission_si_prete(d.client_id);
    perform set_config('hc.creation_mission_serveur', '', true);
  end if;

  update public.paiement_evenements set resultat = v_code where id = v_ev;

  return jsonb_build_object('ok', v_code in ('PAYE', 'DEJA_PAYE'), 'code', v_code,
                            'devis_id', d.id, 'version', d.version,
                            'mission', v_mission);
end $$;

-- Ni anon ni authenticated : uniquement la clé service_role (webhook)
-- et le SQL Editor.
revoke all on function public.traiter_paiement_confirme(uuid, text, text, numeric, text, jsonb) from public;
revoke all on function public.traiter_paiement_confirme(uuid, text, text, numeric, text, jsonb) from anon;
revoke all on function public.traiter_paiement_confirme(uuid, text, text, numeric, text, jsonb) from authenticated;
grant execute on function public.traiter_paiement_confirme(uuid, text, text, numeric, text, jsonb) to service_role;

comment on function public.traiter_paiement_confirme(uuid, text, text, numeric, text, jsonb) is
  'Marque un devis accepté comme payé à partir d''un événement serveur '
  '(webhook vérifié), une seule fois par événement, et crée la mission si '
  'tout est complet. Refuse toute session. Aucun objet Stripe ici : le '
  'webhook n''existe pas encore.';

-- ------------------------------------------------------------
-- 5 bis. Le verrou de création de mission (97) reconnaît le serveur
-- ------------------------------------------------------------
-- La migration 97 réserve l'insertion d'une mission à HelixCar
-- (auth.uid() nul ou administrateur). La création déclenchée par la
-- DERNIÈRE information transmise se produit DANS la session du client :
-- sans ce complément, le verrou la refuserait. Corps identique à 97,
-- plus le drapeau de transaction posé uniquement par les fonctions
-- serveur de cette migration. Un client qui insérerait lui-même une
-- mission reste refusé : le drapeau n'existe pas dans sa session.
create or replace function public.verrou_creation_mission()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or public.est_admin()
     or coalesce(current_setting('hc.creation_mission_serveur', true), '') = '1' then
    return new;
  end if;
  raise exception 'La création d''une mission est réservée à HelixCar.'
    using errcode = 'insufficient_privilege';
end $$;

drop trigger if exists trg_verrou_creation_mission on public.missions;
create trigger trg_verrou_creation_mission
  before insert on public.missions
  for each row execute function public.verrou_creation_mission();

-- ------------------------------------------------------------
-- 6. LA DERNIÈRE INFORMATION CRÉE LA MISSION (Q02-015)
-- ------------------------------------------------------------
-- Quand un client transmet une information (repondre_informations_demande,
-- migration 06) ou qu'un administrateur la valide, on retente la
-- création : elle n'aboutit que si le devis est payé et que plus rien
-- ne manque, et elle est idempotente.
create or replace function public.mission_apres_information()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.statut in ('transmise', 'validee')
     and (tg_op = 'INSERT' or new.statut is distinct from old.statut) then
    if exists (select 1 from public.devis dv
                where dv.client_id = new.client_id
                  and dv.statut = 'accepte' and dv.paiement_statut = 'paye') then
      perform set_config('hc.creation_mission_serveur', '1', true);
      perform public.creer_mission_si_prete(new.client_id);
      perform set_config('hc.creation_mission_serveur', '', true);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_mission_apres_information on public.demande_informations_manquantes;
create trigger trg_mission_apres_information
  after insert or update on public.demande_informations_manquantes
  for each row execute function public.mission_apres_information();

revoke all on function public.mission_apres_information() from public;

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from pg_tables where tablename = 'paiement_evenements';
--   -- attendu : 1
--   select grantee, privilege_type from information_schema.role_routine_grants
--    where routine_name = 'traiter_paiement_confirme';
--   -- attendu : service_role uniquement (jamais anon, jamais authenticated)
--   -- Depuis la session d'un administrateur :
--   --   select public.creer_mission_nettoyage_si_prete('<demande acceptée non payée>') ->> 'code';
--   --   -- attendu : PAIEMENT_NON_CONFIRME
--   -- Depuis le SQL Editor (aucune session) :
--   --   select public.traiter_paiement_confirme('<devis accepté>', 'test', 'TEST-QA-CLAUDE-HELIXCAR-EV1', <prix>) ->> 'code';
--   --   -- attendu : PAYE, puis DEJA_TRAITE au rejeu
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire : sans événement, aucun devis ne passe « payé » et
--      aucune mission de nettoyage ne se crée plus sans paiement — c'est
--      la règle C02.
--   2. Revenir à la création sans paiement (annule C02) : réappliquer la
--      fonction creer_mission_nettoyage_si_prete de la migration 103.
--   3. Retirer le déclencheur et les fonctions :
--        drop trigger if exists trg_mission_apres_information on public.demande_informations_manquantes;
--        drop function if exists public.mission_apres_information();
--        drop function if exists public.traiter_paiement_confirme(uuid, text, text, numeric, text, jsonb);
--        drop function if exists public.creer_mission_si_prete(uuid);
--        drop view if exists public.v_mes_devis;
--   4. Retirer le journal (DESTRUCTIF : la trace des paiements est perdue) :
--        drop table if exists public.paiement_evenements;
