# ============================================================
# LOT Q02 — PAIEMENT CONFIRMÉ CÔTÉ SERVEUR, MISSION SELON C02
# ============================================================
# Exécuté par tests/t_rls.sh après toutes ses sections : la base porte
# déjà les migrations 00 à 106 (et 108/109 si leurs sections ont
# tourné avant, par ordre alphabétique : l01, o01, q02). Ce fichier
# applique migrations/110 et observe le comportement RÉEL.
#
# Jeux d'essai préfixés TEST-QA-CLAUDE-HELIXCAR, identités en .test.
# Aucune connexion à Supabase, aucun paiement réel, aucun e-mail.
#
# Identités propres au lot (UUID v4 syntaxiquement valides) :
#   a0020000-0000-4000-8000-0000000000c1  : compte CLIENT du lot
#   d0020000-0000-4000-8000-0000000000NN  : demandes de nettoyage
#   f0020000-0000-4000-8000-0000000000NN  : devis

q02_client() {
  sql "begin; select public.devenir('a0020000-0000-4000-8000-0000000000c1','q02client@helixcar.test');
$1
commit;" | tail -n +2
}

# Deux demandes de nettoyage COMPLÈTES (rien d'attendu) et une troisième
# à laquelle il manque le contact sur place. Chacune avec un devis.
sql "insert into auth.users (id, email, email_confirmed_at) values
       ('a0020000-0000-4000-8000-0000000000c1', 'q02client@helixcar.test', now())
     on conflict (id) do nothing;
     insert into public.clients (id, auth_user_id, numero_client, email, prenom, nom, type_service, type_client, statut, nettoyage_details)
     select ('d0020000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
            'a0020000-0000-4000-8000-0000000000c1',
            'TEST-QA-CLAUDE-HELIXCAR-Q02-' || g, 'q02client@helixcar.test', 'TEST-QA', 'Q02-' || g,
            'nettoyage', 'pro', 'nouveau',
            jsonb_build_object('type_nettoyage','preparation_complete',
               'lieu','locaux_client',
               'adresse_rue','1 rue du Paiement','adresse_cp','69000','adresse_ville','Lyon',
               'date_souhaitee','2026-12-01','date_fin','2026-12-02',
               'creneau_debut','09:00','creneau_fin','17:00',
               'nombre_vehicules_approx', 3,
               'contact_sur_place', case when g = 3 then '{}'::jsonb
                                    else jsonb_build_object('nom','TEST-QA Q02','telephone','+33600000002') end)
       from generate_series(1, 3) g
     on conflict (id) do nothing;
     insert into public.devis (id, reference, client_id, prix, statut, version)
     select ('f0020000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
            'TEST-QA-CLAUDE-HELIXCAR-Q02-DV' || g,
            ('d0020000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
            250 * g, case when g = 2 then 'envoye' else 'accepte' end, 1
       from generate_series(1, 3) g
     on conflict (id) do nothing;" >/dev/null

# ── 1. APPLICATION ──
errQ=$(appliquer migrations/110_paiement_confirme_et_mission.sql)
check "Q02-1 : migrations/110 s'applique sans erreur" "" "$errQ"
check "Q02-2 : rejouer la migration ne change rien (idempotente)" "" "$(appliquer migrations/110_paiement_confirme_et_mission.sql)"
check "Q02-3 : le journal des paiements existe et est sous RLS" "t" \
  "$(sql "select rowsecurity from pg_tables where schemaname='public' and tablename='paiement_evenements';")"
check "Q02-4 : traiter_paiement_confirme n'est offerte ni a anon ni a authenticated" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
          where routine_name='traiter_paiement_confirme' and grantee in ('anon','authenticated');")"
check "Q02-5 : ... mais bien a service_role (le futur webhook)" "1" \
  "$(sql "select count(*) from information_schema.role_routine_grants
          where routine_name='traiter_paiement_confirme' and grantee='service_role';")"

# ── 2. C02 : ACCEPTÉ NE SUFFIT PAS ──
check "Q02-6 : devis accepte mais NON paye : aucune mission (PAIEMENT_NON_CONFIRME)" "PAIEMENT_NON_CONFIRME" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('d0020000-0000-4000-8000-000000000001') ->> 'code';" | tail -1)"
check "Q02-7 : ... et la table des missions reste vide pour cette demande" "0" \
  "$(sql "select count(*) from public.missions where client_id='d0020000-0000-4000-8000-000000000001';")"
check "Q02-8 : un administrateur ne peut PAS marquer un devis paye (execution refusee)" "refuse" \
  "$(sqlAdmin "select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000001','test','EV-ADMIN',250) ->> 'code';" 2>&1 | grep -qE 'permission denied|NON_AUTORISE' && echo refuse)"
check "Q02-9 : un client ne peut PAS non plus (execution refusee)" "refuse" \
  "$(q02_client "select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000001','test','EV-CLIENT',250) ->> 'code';" 2>&1 | grep -qE 'permission denied|NON_AUTORISE' && echo refuse)"
# Tentative d'ecriture directe par le client : refusee par le garde-fou
# de la migration 109 (ou sans effet sous RLS) — dans les deux cas le
# devis ne bouge pas (Q02-10).
q02_client "update public.devis set paiement_statut='paye' where id='f0020000-0000-4000-8000-000000000001';" >/dev/null 2>&1
check "Q02-10 : le devis n'a pas bouge" "aucun" \
  "$(sql "select paiement_statut from public.devis where id='f0020000-0000-4000-8000-000000000001';")"

# ── 3. LE SERVEUR CONFIRME : PAYE, ET LA MISSION SE CRÉE SI TOUT EST COMPLET ──
check "Q02-11 : un montant different du devis est refuse et journalise (MONTANT_INCOHERENT)" "MONTANT_INCOHERENT|aucun" \
  "$(sql "select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000001','test','EV-FAUX-MONTANT',999) ->> 'code';
          select paiement_statut from public.devis where id='f0020000-0000-4000-8000-000000000001';" | paste -sd'|')"
check "Q02-12 : un devis seulement ENVOYE ne se paie pas (DEVIS_NON_ACCEPTE)" "DEVIS_NON_ACCEPTE|aucun" \
  "$(sql "select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000002','test','EV-ENVOYE',500) ->> 'code';
          select paiement_statut from public.devis where id='f0020000-0000-4000-8000-000000000002';" | paste -sd'|')"
check "Q02-13 : evenement serveur valide : PAYE, et la mission de nettoyage est creee dans la meme transaction" "PAYE|CREEE" \
  "$(sql "with r as (select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000001','test','EV-1',250) j)
          select (j->>'code')||'|'||(j->'mission'->>'code') from r;")"
check "Q02-14 : le devis est paye, date de confirmation posee" "paye|true" \
  "$(sql "select paiement_statut||'|'||(paiement_confirme_le is not null)::text from public.devis where id='f0020000-0000-4000-8000-000000000001';")"
check "Q02-15 : UNE mission, sous sa formule courte « Preparation complete »" "1|Préparation complète" \
  "$(sql "select count(*)||'|'||min(prestation) from public.missions where client_id='d0020000-0000-4000-8000-000000000001';")"
check "Q02-16 : le meme evenement rejoue ne fait rien (DEJA_TRAITE), une seule ligne de journal" "DEJA_TRAITE|1" \
  "$(sql "select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000001','test','EV-1',250) ->> 'code';
          select count(*) from public.paiement_evenements where evenement_id='EV-1';" | paste -sd'|')"
check "Q02-17 : un second evenement sur un devis deja paye : DEJA_PAYE, toujours une seule mission" "DEJA_PAYE|1" \
  "$(sql "select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000001','test','EV-1bis',250) ->> 'code';
          select count(*) from public.missions where client_id='d0020000-0000-4000-8000-000000000001';" | paste -sd'|')"
check "Q02-18 : les evenements refuses sont journalises avec leur resultat" "DEVIS_NON_ACCEPTE|MONTANT_INCOHERENT" \
  "$(sql "select resultat from public.paiement_evenements where evenement_id in ('EV-FAUX-MONTANT','EV-ENVOYE') order by evenement_id;" | paste -sd'|')"
check "Q02-19 : le journal n'est lisible que par un administrateur" "0|4" \
  "$(q02_client "select count(*) from public.paiement_evenements;" | tail -1)|$(sqlAdmin "select count(*) from public.paiement_evenements;" | tail -1)"

# ── 4. PAYÉ MAIS INCOMPLET : LA DERNIÈRE INFORMATION CRÉE LA MISSION ──
check "Q02-20 : demande 3 : il manque le contact sur place" "2" \
  "$(sqlAdmin "select count(*) from public.informations_demande('d0020000-0000-4000-8000-000000000003') where statut='attendue';" | tail -1)"
check "Q02-21 : paiement confirme, mais informations manquantes : PAYE sans mission" "PAYE|INFORMATIONS_MANQUANTES" \
  "$(sql "with r as (select public.traiter_paiement_confirme('f0020000-0000-4000-8000-000000000003','test','EV-3',750) j)
          select (j->>'code')||'|'||(j->'mission'->>'code') from r;")"
check "Q02-22 : aucune mission pour la demande 3 a ce stade" "0" \
  "$(sql "select count(*) from public.missions where client_id='d0020000-0000-4000-8000-000000000003';")"
q02_client "select public.repondre_informations_demande('d0020000-0000-4000-8000-000000000003',
  '{\"contact_sur_place_nom\":\"TEST-QA Q02 Contact\"}'::jsonb);" >/dev/null
check "Q02-23 : une information sur deux transmise : toujours pas de mission" "0" \
  "$(sql "select count(*) from public.missions where client_id='d0020000-0000-4000-8000-000000000003';")"
q02_client "select public.repondre_informations_demande('d0020000-0000-4000-8000-000000000003',
  '{\"contact_sur_place_tel\":\"+33600000003\"}'::jsonb);" >/dev/null
check "Q02-24 : la DERNIERE information transmise par le client cree la mission, sans administrateur" "1|en_attente" \
  "$(sql "select count(*)||'|'||min(statut) from public.missions where client_id='d0020000-0000-4000-8000-000000000003';")"
check "Q02-25 : l'administrateur qui rejoue la creation retrouve la meme mission (DEJA_CREEE)" "DEJA_CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('d0020000-0000-4000-8000-000000000003') ->> 'code';" | tail -1)"

# ── 5. LA VUE CLIENT DES DEVIS ──
check "Q02-26 : le client voit ses devis envoyes/acceptes avec l'etat de paiement, jamais un brouillon" "3|paye" \
  "$(q02_client "select count(*)||'|'||(select paiement_statut from public.v_mes_devis where id='f0020000-0000-4000-8000-000000000001') from public.v_mes_devis;" | tail -1)"
check "Q02-27 : la vue ne projette ni jeton ni chemin de PDF" "0" \
  "$(sql "select count(*) from information_schema.columns where table_name='v_mes_devis' and column_name in ('acceptation_token_hash','pdf_path','snapshot_devis');")"
check "Q02-28 : un autre compte n'y voit rien, anon non plus" "0|0" \
  "$(sql "begin; select public.devenir('a0010000-0000-4000-8000-0000000000c1','o01client@helixcar.test'); select count(*) from public.v_mes_devis; commit;" | tail -1)|$(sql "begin; select public.devenir_anon(); select count(*) from public.v_mes_devis; commit;" 2>&1 | tail -1 | grep -oE '^[0-9]+$|permission denied' | sed 's/permission denied/0/')"

# Le drapeau serveur n'ouvre rien a un client : une insertion directe
# d'une mission dans sa session reste refusee par le verrou de 97.
check "Q02-29 : un client ne peut toujours pas creer une mission lui-meme" "refuse" \
  "$(q02_client "insert into public.missions (reference, type_mission, statut, client_id) values ('TEST-QA-CLAUDE-HELIXCAR-Q02-PIRATE','nettoyage','en_attente','d0020000-0000-4000-8000-000000000001');" 2>&1 | grep -qE 'réservée à HelixCar|permission denied' && echo refuse)"
