echo "── R02. RESTITUTION : CONTACT OBLIGATOIRE AVANT MISSION ──"

errR02Base=$(appliquer migrations/132_restitution_vin_immatriculation_mission.sql)
check "R02-1a : la migration 132 historique s'applique sans erreur" "" "$errR02Base"
errR02=$(appliquer migrations/134_restitution_contacts_mission.sql)
check "R02-1b : la migration corrective 134 s'applique sans erreur" "" "$errR02"

# Toutes les informations du convoyage et de la restitution sont fournies,
# sauf le nom et le téléphone du contact à la restitution. Cela prouve que
# ces deux lignes ne sont ni confondues avec le contact de livraison, ni
# artificiellement satisfaites par lui.
sql "insert into public.clients
      (id, numero_client, email, type_service, trajet_commun, statut)
     values ('eeeeeeee-0000-0000-0000-00000000f132','TEST-QA-R02',
             'restitution-r02@helixcar.test','convoyage',false,'nouveau')
     on conflict (id) do nothing;
     insert into public.vehicules
      (dossier_id, position, type_vehicule, marque_modele, immatriculation, vin,
       adresse_depart_rue, date_prise_en_charge, pc_contact_nom, pc_contact_tel,
       adresse_arrivee_rue, liv_contact_nom, liv_contact_tel,
       restitution_concernee, restit_immatriculation, restit_vin,
       restit_adresse_rue, restit_date)
     values
      ('eeeeeeee-0000-0000-0000-00000000f132',1,'suv','TEST-QA R02',
       'AA-132-AA','VIN-R02-SOURCE','1 rue Départ','2026-10-10',
       'Contact départ','0600000001','2 rue Livraison','Contact livraison','0600000002',
       true,'BB-132-BB','VIN-R02-RESTITUTION','3 rue Restitution','2026-10-11')
     on conflict do nothing;" >/dev/null

check "R02-2 : le nom du contact de restitution absent est attendu" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f132')
      where cle='vehicule_1_restit_contact_nom';" | tail -1)"
check "R02-3 : le téléphone du contact de restitution absent est attendu" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f132')
      where cle='vehicule_1_restit_contact_tel';" | tail -1)"
check "R02-4 : le contact de livraison ne remplit pas celui de restitution" "2" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f132')
      where cle like 'vehicule_1_restit_contact_%' and statut='attendue';" | tail -1)"

sql "update public.vehicules
        set restit_contact_nom='Contact restitution', restit_contact_tel='0600000003'
      where dossier_id='eeeeeeee-0000-0000-0000-00000000f132' and position=1;" >/dev/null

check "R02-5 : les deux informations complétées deviennent fournies" "fournie|fournie" \
  "$(sqlAdmin "select string_agg(statut,'|' order by cle) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f132')
      where cle like 'vehicule_1_restit_contact_%';" | tail -1)"
check "R02-6 : aucune autre information ne reste manquante" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f132')
      where statut='attendue';" | tail -1)"
