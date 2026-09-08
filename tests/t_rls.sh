#!/usr/bin/env bash
# ============================================================
# VÉRIFICATION RÉELLE DES POLITIQUES RLS — PostgreSQL 16 local
# ============================================================
# Monte une base JETABLE, y applique les VRAIS fichiers de migrations/
# sans les modifier, et observe le comportement effectif :
#   * ce que voit l'ANCIEN Dashboard (clé anon, aucune session) ;
#   * ce que voit la NOUVELLE version (JWT de la session) ;
#   * ce que voit un partenaire, bloqué ou non ;
#   * ce que voit un client authentifié quelconque.
#
# AUCUNE connexion à Supabase. Aucune donnée réelle. Les jeux d'essai
# sont préfixés TEST-QA et utilisent des adresses en .test.
set -u
BIN=/usr/lib/postgresql/16/bin
BASE=/var/lib/postgresql/verif
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0; ECHECS=()

check() { # libellé, attendu, obtenu
  if [ "$2" = "$3" ]; then echo "PASS - $1"; PASS=$((PASS+1))
  else echo "FAIL - $1  [attendu: $2 | obtenu: $3]"; FAIL=$((FAIL+1)); ECHECS+=("$1"); fi
}

sql() { # exécute du SQL et renvoie la sortie brute
  printf '%s\n' "$1" > "$BASE/req.sql"
  chown postgres:postgres "$BASE/req.sql"
  su postgres -c "psql -U postgres -d verif -qAt -f $BASE/req.sql" 2>&1
}

appliquer() { # applique un fichier de migration
  cp "$REPO/$1" "$BASE/mig.sql"; chown postgres:postgres "$BASE/mig.sql"
  su postgres -c "psql -U postgres -d verif -v ON_ERROR_STOP=1 -q -f $BASE/mig.sql" 2>&1 | grep -iE '^psql.*error' | head -2
}

# ── Démarrage du cluster jetable ──
if ! su postgres -c "psql -U postgres -tAc 'select 1'" >/dev/null 2>&1; then
  rm -rf "$BASE/data"; mkdir -p "$BASE" /var/run/postgresql
  chown postgres:postgres "$BASE" /var/run/postgresql
  su postgres -c "PATH=$BIN:\$PATH initdb -D $BASE/data -U postgres --auth=trust" >/dev/null 2>&1
  su postgres -c "PATH=$BIN:\$PATH pg_ctl -D $BASE/data -o '-k /var/run/postgresql -c listen_addresses=' -l $BASE/pg.log start" >/dev/null 2>&1
  sleep 2
fi

su postgres -c "psql -U postgres -qc 'drop database if exists verif' -c 'create database verif'" >/dev/null 2>&1

# ── Socle : l'état AVANT ce lot ──
appliquer tests/pg/00_socle_supabase.sql
appliquer tests/pg/identites.sql
sql "insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','admin@helixcar.test'),
  ('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'),
  ('33333333-3333-3333-3333-333333333333','client@helixcar.test'),
  ('44444444-4444-4444-4444-444444444444','ancien@helixcar.test');
insert into public.admins (auth_user_id, email, actif) values
  ('11111111-1111-1111-1111-111111111111','admin@helixcar.test', true);
insert into public.convoyeurs (id, auth_user_id, prenom, nom, email, activites, statut) values
  ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','TEST-QA','Partenaire','partenaire@helixcar.test','{convoyage,nettoyage}','actif'),
  ('aaaaaaaa-0000-0000-0000-000000000002', null,'TEST-QA','Ancien','ancien@helixcar.test','{convoyage}','actif');
insert into public.missions (id, convoyeur_id, reference, statut) values
  ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','TEST-QA-M1','acceptee'),
  ('bbbbbbbb-0000-0000-0000-000000000002', null,'TEST-QA-M2','en_attente');" >/dev/null

echo "── A. PHASE PRÉPARATOIRE : compatible avec l'ANCIEN dashboard ──"
for f in 00_helpers 04_decisions_activites 05_blocage_partenaire 06_informations_manquantes; do
  err=$(appliquer "migrations/$f.sql")
  check "A0 : migrations/$f.sql s'applique sans erreur" "" "$err"
done

check "A1 : l'ancien dashboard lit toujours les candidatures" "2" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "A2 : l'ancien dashboard lit toujours les missions" "2" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.missions; commit;" | tail -1)"
check "A3 : validation d'une candidature (PATCH statut) toujours possible" "UPDATE 1" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir_anon(); update public.convoyeurs set statut='actif' where id='aaaaaaaa-0000-0000-0000-000000000002'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "A4 : création d'une mission toujours possible" "INSERT 0 1" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir_anon(); insert into public.missions (reference,statut) values ('TEST-QA-M3','en_attente'); commit;\"" 2>&1 | grep -E '^INSERT')"
check "A5 : le partenaire historique a été rattaché à son compte" "1" \
  "$(sql "select count(*) from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000002' and auth_user_id='44444444-4444-4444-4444-444444444444';")"
check "A6 : diagnostic — aucun partenaire actif sans compte lié" "0" \
  "$(sql "select count(*) from public.convoyeurs where auth_user_id is null and statut='actif';")"
check "A7 : les tables de décisions sont fermées dès leur création" "0" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.convoyeur_decisions; commit;" | tail -1)"

# Demandes client : la colonne clients.auth_user_id est créée par la
# migration 06, ce seed ne peut donc pas précéder la phase A.
sql "insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'),
  ('66666666-6666-6666-6666-666666666666','clientB@helixcar.test');
insert into public.clients (id, auth_user_id, numero_client, email, prenom, nom, telephone,
                            type_service, statut, immatriculation, marque_modele,
                            date_prise_en_charge, adresse_arrivee_rue, prix_interne) values
  ('cccccccc-0000-0000-0000-00000000000A','55555555-5555-5555-5555-555555555555','TEST-QA-A1',
   'clientA@helixcar.test','TEST-QA','ClientA','+33600000010','convoyage','nouveau',
   'AA-123-AA','Peugeot 208','2026-10-01','12 rue de la Paix', 990.00),
  ('cccccccc-0000-0000-0000-00000000000B','66666666-6666-6666-6666-666666666666','TEST-QA-B1',
   'clientB@helixcar.test','TEST-QA','ClientB','+33600000011','nettoyage','nouveau',
   null,null,null,null, 120.00);" >/dev/null


echo
echo "── B. DURCISSEMENT (après déploiement de la nouvelle interface) ──"
err=$(appliquer migrations/90_durcissement_rls_partenaires.sql)
check "B0 : migrations/90 s'applique sans erreur" "" "$err"
err91=$(appliquer migrations/91_durcissement_rls_clients.sql)
check "B0b : migrations/91 s'applique sans erreur" "" "$err91"
check "B1 : la clé anon ne lit plus aucune candidature" "0" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "B2 : la clé anon ne lit plus aucune mission" "0" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.missions; commit;" | tail -1)"
check "B3 : l'administrateur authentifié voit toutes les candidatures" "2" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "B4 : l'administrateur authentifié voit toutes les missions" "3" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); select count(*) from public.missions; commit;" | tail -1)"
check "B5 : le dépôt public d'une candidature reste possible" "INSERT 0 1" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir_anon(); insert into public.convoyeurs (prenom,nom,email,statut) values ('TEST-QA','Nouveau','nouveau@helixcar.test','en_attente'); commit;\"" 2>&1 | grep -E '^INSERT')"
check "B6 : un client authentifié ne lit aucune candidature" "0" \
  "$(sql "begin; select public.devenir('33333333-3333-3333-3333-333333333333','client@helixcar.test'); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "B7 : un client authentifié ne lit aucune décision" "0" \
  "$(sql "begin; select public.devenir('33333333-3333-3333-3333-333333333333','client@helixcar.test'); select count(*) from public.convoyeur_decisions; commit;" | tail -1)"
check "B8 : l'administrateur peut supprimer une candidature" "DELETE 1" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); delete from public.convoyeurs where email='nouveau@helixcar.test'; commit;\"" 2>&1 | grep -E '^DELETE')"

echo
echo "── C. PARTENAIRE NON BLOQUÉ ──"
check "C1 : il lit sa propre fiche" "1" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "C2 : il voit ses missions et celles non attribuées" "3" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.missions; commit;" | tail -1)"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
 values ('aaaaaaaa-0000-0000-0000-000000000001','convoyage','oui')
 on conflict (convoyeur_id, activite) do update set decision='oui'; commit;" >/dev/null
check "C3 : l'administrateur enregistre une décision" "oui" \
  "$(sql "select decision from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and activite='convoyage';")"
check "C4 : l'historique est alimenté par le trigger" "1" \
  "$(sql "select count(*) from public.convoyeur_decisions_historique where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and nouvelle_decision='oui';")"

check "C5 : un partenaire actif ne peut PAS se bloquer/débloquer lui-même" "reserve-admin" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.convoyeurs set bloque=true where auth_user_id=auth.uid(); commit;" | grep -qE 'Modification réservée' && echo reserve-admin || echo passe)"
check "C6 : un partenaire actif ne peut PAS changer son statut" "reserve-admin" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.convoyeurs set statut='en_attente' where auth_user_id=auth.uid(); commit;" | grep -qE 'Modification réservée' && echo reserve-admin || echo passe)"
check "C7 : mais il peut mettre à jour ses propres coordonnées" "UPDATE 1" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.convoyeurs set telephone='+33600000002' where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^UPDATE')"

echo
echo "── D. PARTENAIRE BLOQUÉ ──"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.convoyeurs set bloque=true, bloque_motif='TEST-QA motif'
  where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" >/dev/null
check "D1 : le blocage est réellement enregistré" "t" \
  "$(sql "select bloque from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000001';")"
check "D2 : qui et quand sont tracés automatiquement" "1" \
  "$(sql "select count(*) from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000001' and bloque_le is not null and bloque_par='11111111-1111-1111-1111-111111111111';")"
check "D3 : il reste visible pour l'administrateur" "1" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); select count(*) from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" | tail -1)"
check "D4 : il voit encore sa fiche (message de suspension possible)" "1" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "D5 : il voit ZÉRO mission" "0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.missions; commit;" | tail -1)"
check "D6 : il ne lit AUCUNE décision" "0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.convoyeur_decisions; commit;" | tail -1)"
# La RLS retire la ligne du champ d'action AVANT que le garde-fou ne
# s'exécute : le refus est donc silencieux (UPDATE 0), pas une exception.
# Ce qui doit être prouvé est que l'état ne change pas.
check "D7 : sa tentative de déblocage ne modifie AUCUNE ligne" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.convoyeurs set bloque=false where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^UPDATE')"
check "D8 : il reste bloqué après sa tentative" "t" \
  "$(sql "select bloque from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000001';")"
check "D9 : il ne peut PAS accepter une mission" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.missions set statut='acceptee' where reference='TEST-QA-M2'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "D10 : ses décisions sont EXACTEMENT conservées" "oui" \
  "$(sql "select decision from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and activite='convoyage';")"

echo
echo "── E. DÉBLOCAGE PAR L'ADMINISTRATEUR ──"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.convoyeurs set bloque=false where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" >/dev/null
check "E1 : l'accès aux missions est rétabli" "3" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.missions; commit;" | tail -1)"
check "E2 : la trace de blocage est effacée" "1" \
  "$(sql "select count(*) from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000001' and bloque_le is null and bloque_par is null and bloque_motif is null;")"
check "E3 : les décisions ne sont PAS modifiées par le déblocage" "oui" \
  "$(sql "select decision from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and activite='convoyage';")"
check "E4 : une activité en attente le reste (aucune acceptation automatique)" "en_attente" \
  "$(sql "select decision from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and activite='nettoyage';")"
check "E5 : aucune mission attribuée automatiquement" "0" \
  "$(sql "select count(*) from public.missions where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and statut='proposee';")"

echo
echo "── G. ESPACE CLIENT : cloisonnement et informations ──"
check "G1 : le client A ne lit AUCUNE ligne de public.clients (colonnes internes)" "0" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select count(*) from public.clients; commit;" | tail -1)"
check "G2 : le client A voit SA demande via la vue" "TEST-QA-A1" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select numero_client from public.v_mes_demandes; commit;" | tail -1)"
check "G3 : le client A ne voit PAS la demande du client B" "1" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select count(*) from public.v_mes_demandes; commit;" | tail -1)"
check "G4 : la vue n'expose AUCUNE colonne interne" "0" \
  "$(sql "select count(*) from information_schema.columns where table_name='v_mes_demandes' and column_name in ('prix_interne','auth_user_id');")"
check "G5 : informations requises calculées pour un convoyage" "6" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select count(*) from public.informations_demande('cccccccc-0000-0000-0000-00000000000A'); commit;" | tail -1)"
check "G6 : une donnée déjà enregistrée n'est JAMAIS redemandée" "fournie" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select statut from public.informations_demande('cccccccc-0000-0000-0000-00000000000A') where cle='immatriculation'; commit;" | tail -1)"
check "G7 : une donnée absente est marquée manquante" "attendue" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select statut from public.informations_demande('cccccccc-0000-0000-0000-00000000000A') where cle='contact_pc_nom'; commit;" | tail -1)"
check "G8 : les rubriques diffèrent selon le service" "3" \
  "$(sql "begin; select public.devenir('66666666-6666-6666-6666-666666666666','clientB@helixcar.test'); select count(*) from public.informations_demande('cccccccc-0000-0000-0000-00000000000B'); commit;" | tail -1)"

check "G9 : le client ne peut PAS modifier sa demande (prix, statut, devis)" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); update public.clients set statut='validee', prix_interne=1 where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^UPDATE|^ERROR' | head -1)"
check "G10 : et sa demande reste intacte" "nouveau|990.00" \
  "$(sql "select statut||'|'||prix_interne from public.clients where id='cccccccc-0000-0000-0000-00000000000A';")"
check "G11 : le client ne peut PAS supprimer sa demande" "DELETE 0" \
  "$(su postgres -c "psql -U postgres -d verif -c \"begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); delete from public.clients where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^DELETE|^ERROR' | head -1)"
check "G12 : un dépôt anonyme ne permet PAS de relire la demande" "refuse" \
  "$(sql "begin; select public.devenir_anon(); insert into public.clients (numero_client,email,type_service,statut) values ('TEST-QA-REPR','r@helixcar.test','convoyage','nouveau') returning id; commit;" | grep -qiE 'row-level security|error' && echo refuse || echo passe)"

echo
echo "── H. RÉPONSE DU CLIENT ET VALIDATION ADMINISTRATEUR ──"
check "H1 : le client A répond à ses rubriques manquantes" "2" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select public.repondre_informations_demande('cccccccc-0000-0000-0000-00000000000A', '{\"contact_pc_nom\":\"TEST-QA Dupont\",\"contact_pc_tel\":\"+33600000012\"}'::jsonb); commit;" | tail -1)"
check "H2 : la réponse passe en transmise" "transmise" \
  "$(sql "select statut from public.demande_informations_manquantes where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_nom';")"
check "H3 : le client NE PEUT PAS répondre pour la demande d'un autre" "insufficient" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select public.repondre_informations_demande('cccccccc-0000-0000-0000-00000000000B', '{\"contact_pc_nom\":\"PIRATE\"}'::jsonb); commit;" | grep -qiE 'non autorisée|insufficient' && echo insufficient || echo passe)"
check "H4 : le client NE PEUT PAS valider lui-même" "reserve-admin" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); update public.demande_informations_manquantes set statut='validee' where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_nom'; commit;" | grep -qE 'réservée à un administrateur|row-level security' && echo reserve-admin || echo passe)"
check "H4b : et sa rubrique reste NON validée" "transmise" \
  "$(sql "select statut from public.demande_informations_manquantes where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_nom';")"
check "H5 : une rubrique NON REQUISE est ignorée" "0" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select public.repondre_informations_demande('cccccccc-0000-0000-0000-00000000000A', '{\"prix_interne\":\"1\"}'::jsonb); commit;" | tail -1)"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.demande_informations_manquantes set statut='validee'
  where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_nom'; commit;" >/dev/null
check "H6 : l'administrateur valide" "validee" \
  "$(sql "select statut from public.demande_informations_manquantes where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_nom';")"
check "H7 : qui et quand sont tracés" "1" \
  "$(sql "select count(*) from public.demande_informations_manquantes where cle='contact_pc_nom' and validee_le is not null and validee_par='11111111-1111-1111-1111-111111111111';")"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.demande_informations_manquantes set statut='a_corriger', commentaire='Numéro incomplet'
  where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_tel'; commit;" >/dev/null
check "H8 : demande de correction avec motif" "Numéro incomplet" \
  "$(sql "select commentaire from public.demande_informations_manquantes where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_tel';")"
check "H9 : nouvelle transmission après correction" "1" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select public.repondre_informations_demande('cccccccc-0000-0000-0000-00000000000A', '{\"contact_pc_tel\":\"+33600000099\"}'::jsonb); commit;" | tail -1)"
check "H10 : l'information déjà VALIDÉE est conservée intacte" "validee" \
  "$(sql "select statut from public.demande_informations_manquantes where client_id='cccccccc-0000-0000-0000-00000000000A' and cle='contact_pc_nom';")"
check "H11 : le motif de correction est effacé par la nouvelle réponse" "0" \
  "$(sql "select count(*) from public.demande_informations_manquantes where cle='contact_pc_tel' and commentaire is not null;")"
sql "update public.clients set type_service='stockage' where id='cccccccc-0000-0000-0000-00000000000A';" >/dev/null
check "H12 : changer de service RECALCULE les rubriques" "3" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select count(*) from public.informations_demande('cccccccc-0000-0000-0000-00000000000A'); commit;" | tail -1)"
sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); select public.repondre_informations_demande('cccccccc-0000-0000-0000-00000000000A', '{\"stockage_ville\":\"Lyon\"}'::jsonb); commit;" >/dev/null
check "H13 : les valeurs conditionnelles obsolètes sont SUPPRIMÉES" "0" \
  "$(sql "select count(*) from public.demande_informations_manquantes where client_id='cccccccc-0000-0000-0000-00000000000A' and cle in ('contact_pc_nom','contact_pc_tel');")"

echo
echo "── V. CRÉATION D'UNE DEMANDE AVEC VÉHICULES (erreur 42501) ──"
# On reproduit d'abord la panne telle qu'elle se produit en production,
# AVANT d'appliquer le correctif : sans cela, le test ne prouverait pas
# que la migration 92 corrige quelque chose de réel.
# Le navigateur émet DEUX requêtes HTTP distinctes : deux transactions
# séparées. Les enchaîner dans un seul begin/commit annulerait la
# première quand la seconde échoue — ce qui ne reproduirait PAS la
# création partielle constatée en production.
sql "begin; select public.devenir_anon();
   insert into public.clients (id,numero_client,email,type_service,statut)
     values ('eeeeeeee-0000-0000-0000-0000000000e1','TEST-QA-REPRO','r@helixcar.test','convoyage','nouveau');
   commit;" >/dev/null
check "V1 : REPRODUCTION — l'écriture directe des véhicules est rejetée" "refuse" \
  "$(sql "begin; select public.devenir_anon();
   insert into public.vehicules (dossier_id,position,marque_modele)
     values ('eeeeeeee-0000-0000-0000-0000000000e1',1,'TEST-QA'); commit;" \
   | grep -qE 'row-level security policy for table \"vehicules\"' && echo refuse || echo passe)"
check "V2 : et elle laisse une création PARTIELLE (demande sans véhicule)" "1|0" \
  "$(sql "select (select count(*) from public.clients where numero_client='TEST-QA-REPRO')||'|'||(select count(*) from public.vehicules where dossier_id='eeeeeeee-0000-0000-0000-0000000000e1');")"

errV=$(appliquer migrations/92_creation_demande_atomique.sql)
check "V3 : migrations/92 s'applique sans erreur" "" "$errV"

check "V4 : après correctif, un dépôt public écrit demande ET véhicules" "2" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000A','numero_client','TEST-QA-V4',
                        'email','v4@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA A'),
                       jsonb_build_object('position',2,'marque_modele','TEST-QA B'))); commit;
   select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000A';" | tail -1)"
check "V5 : un seul véhicule fonctionne aussi" "1" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B','numero_client','TEST-QA-V5',
                        'email','v5@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA Seul'))); commit;
   select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000B';" | tail -1)"
check "V6 : REJEU — aucune duplication" "1|1" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B','numero_client','TEST-QA-V5',
                        'email','v5@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA Seul'))); commit;
   select (select count(*) from public.clients where numero_client='TEST-QA-V5')||'|'||(select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000B');" | tail -1)"
check "V7 : un dépôt anonyme ne peut PAS se déclarer propriétaire" "NULL" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000C','numero_client','TEST-QA-V7',
                        'email','v7@helixcar.test','type_service','convoyage',
                        'auth_user_id','11111111-1111-1111-1111-111111111111'),'[]'::jsonb); commit;
   select coalesce(auth_user_id::text,'NULL') from public.clients where id='ffffffff-0000-0000-0000-00000000000C';" | tail -1)"
check "V8 : un client authentifié devient propriétaire de SA demande" "55555555-5555-5555-5555-555555555555" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000D','numero_client','TEST-QA-V8',
                        'email','clientA@helixcar.test','type_service','nettoyage'),'[]'::jsonb); commit;
   select auth_user_id::text from public.clients where id='ffffffff-0000-0000-0000-00000000000D';" | tail -1)"
check "V9 : le statut envoyé par le navigateur est IGNORÉ" "nouveau" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000E','numero_client','TEST-QA-V9',
                        'email','v9@helixcar.test','type_service','convoyage','statut','validee'),'[]'::jsonb); commit;
   select statut from public.clients where id='ffffffff-0000-0000-0000-00000000000E';" | tail -1)"
check "V10 : une colonne administrative envoyée est IGNORÉE" "0" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000F','numero_client','TEST-QA-V10',
                        'email','v10@helixcar.test','type_service','convoyage','prix_interne',999),'[]'::jsonb); commit;
   select count(*) from public.clients where id='ffffffff-0000-0000-0000-00000000000F' and prix_interne is not null;" | tail -1)"
check "V11 : la RLS de vehicules reste ACTIVE" "t" \
  "$(sql "select relrowsecurity from pg_class where relname='vehicules';")"
check "V12 : aucune écriture anonyme directe n'a été ouverte" "refuse" \
  "$(sql "begin; select public.devenir_anon();
   insert into public.vehicules (dossier_id,position,marque_modele)
     values ('ffffffff-0000-0000-0000-00000000000A',9,'TEST-QA PIRATE'); commit;" \
   | grep -qiE 'row-level security|error' && echo refuse || echo passe)"

echo
echo "── F. IDEMPOTENCE : rejouer les migrations ne duplique rien ──"
DEC_AVANT=$(sql "select count(*) from public.convoyeur_decisions;")
HIST_AVANT=$(sql "select count(*) from public.convoyeur_decisions_historique;")
err5=$(appliquer migrations/05_blocage_partenaire.sql)
err9=$(appliquer migrations/90_durcissement_rls_partenaires.sql)
err4=$(appliquer migrations/04_decisions_activites.sql)
err92=$(appliquer migrations/92_creation_demande_atomique.sql)
check "F1 : 05 se rejoue sans erreur" "" "$err5"
check "F2 : 90 se rejoue sans erreur" "" "$err9"
check "F3 : 04 se rejoue sans erreur" "" "$err4"
check "F3b : 92 se rejoue sans erreur" "" "$err92"
check "F4 : aucune décision dupliquée" "$DEC_AVANT" "$(sql "select count(*) from public.convoyeur_decisions;")"
check "F5 : aucune ligne d'historique inventée par un rejeu" "$HIST_AVANT" \
  "$(sql "select count(*) from public.convoyeur_decisions_historique;")"
check "F6 : aucune politique en double" "0" \
  "$(sql "select count(*) from (select schemaname, tablename, policyname from pg_policies group by 1,2,3 having count(*) > 1) d;")"
check "F7 : aucun trigger en double sur convoyeurs" "0" \
  "$(sql "select count(*) from (select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='convoyeurs' and not t.tgisinternal group by tgname having count(*) > 1) d;")"

echo
echo "=== $PASS PASS / $FAIL FAIL ==="
for e in "${ECHECS[@]:-}"; do [ -n "$e" ] && echo "  - $e"; done
[ "$FAIL" -eq 0 ] || exit 1
