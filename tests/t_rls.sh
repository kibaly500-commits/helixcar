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
if [ ! -x "$BIN/psql" ] || ! id postgres >/dev/null 2>&1; then
  echo "BLOQUÉ — PostgreSQL 16 et utilisateur de recette postgres indisponibles. Aucune commande SQL exécutée."
  exit 2
fi
# Nom de la base JETABLE. Paramétrable pour que deux campagnes puissent
# tourner en même temps sur la même machine (HC_RLS_DB=verif_lot1).
DB="${HC_RLS_DB:-verif}"
if [[ ! "$DB" =~ ^verif(_[a-z0-9_]+)?$ ]]; then
  echo "BLOQUÉ — le nom de base de recette doit être verif ou verif_<suffixe>."
  exit 2
fi
BASE="/var/lib/postgresql/$DB"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0; FAIL=0; ECHECS=()

check() { # libellé, attendu, obtenu
  if [ "$2" = "$3" ]; then echo "PASS - $1"; PASS=$((PASS+1))
  else echo "FAIL - $1  [attendu: $2 | obtenu: $3]"; FAIL=$((FAIL+1)); ECHECS+=("$1"); fi
}

sql() { # exécute du SQL et renvoie la sortie brute
  printf '%s\n' "$1" > "$BASE/req.sql"
  chown postgres:postgres "$BASE/req.sql"
  su postgres -c "psql -U postgres -d $DB -qAt -f $BASE/req.sql" 2>&1
}

# Exécute du SQL EN TANT QU'ADMINISTRATEUR. Depuis que
# informations_demande() vérifie elle-même l'autorisation de son
# appelant, lire un rapport « à nu » (rôle postgres, auth.uid() nul) ne
# renvoie plus rien — et c'est voulu. Les contrôles de CONTENU passent
# donc par un administrateur, comme le Dashboard réel.
sqlAdmin() {
  # La première ligne est le retour de devenir() : on la retire pour que
  # l'appelant retrouve EXACTEMENT la sortie de sa propre requête.
  sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
$1
commit;" | tail -n +2
}

appliquer() {
  if [ ! -f "$REPO/$1" ]; then echo "Migration introuvable : $1"; return 1; fi
  cp "$REPO/$1" "$BASE/mig.sql" || return 1
  chown postgres:postgres "$BASE/mig.sql" || return 1
  local sortie
  if ! sortie=$(su postgres -c "psql -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f $BASE/mig.sql" 2>&1); then
    printf '%s\n' "$sortie" | tail -5
    return 1
  fi
}

# ── Démarrage du cluster jetable ──
if ! su postgres -c "psql -U postgres -tAc 'select 1'" >/dev/null 2>&1; then
  CLUSTER=/var/lib/postgresql/verif
  rm -rf "$CLUSTER/data"; mkdir -p "$CLUSTER" "$BASE" /var/run/postgresql
  chown postgres:postgres "$CLUSTER" "$BASE" /var/run/postgresql
  su postgres -c "PATH=$BIN:\$PATH initdb -D $CLUSTER/data -U postgres --auth=trust" >/dev/null 2>&1
  su postgres -c "PATH=$BIN:\$PATH pg_ctl -D $CLUSTER/data -o '-k /var/run/postgresql -c listen_addresses=' -l $CLUSTER/pg.log start" >/dev/null 2>&1
  sleep 2
fi
# Le répertoire de travail de CETTE base (fichiers SQL temporaires).
mkdir -p "$BASE"; chown postgres:postgres "$BASE"

su postgres -c "psql -U postgres -qc 'drop database if exists $DB' -c 'create database $DB'" >/dev/null 2>&1

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
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir_anon(); update public.convoyeurs set statut='actif' where id='aaaaaaaa-0000-0000-0000-000000000002'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "A4 : création d'une mission toujours possible" "INSERT 0 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir_anon(); insert into public.missions (reference,statut) values ('TEST-QA-M3','en_attente'); commit;\"" 2>&1 | grep -E '^INSERT')"
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
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir_anon(); insert into public.convoyeurs (prenom,nom,email,statut) values ('TEST-QA','Nouveau','nouveau@helixcar.test','en_attente'); commit;\"" 2>&1 | grep -E '^INSERT')"
check "B6 : un client authentifié ne lit aucune candidature" "0" \
  "$(sql "begin; select public.devenir('33333333-3333-3333-3333-333333333333','client@helixcar.test'); select count(*) from public.convoyeurs; commit;" | tail -1)"
check "B7 : un client authentifié ne lit aucune décision" "0" \
  "$(sql "begin; select public.devenir('33333333-3333-3333-3333-333333333333','client@helixcar.test'); select count(*) from public.convoyeur_decisions; commit;" | tail -1)"
check "B8 : l'administrateur peut supprimer une candidature" "DELETE 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); delete from public.convoyeurs where email='nouveau@helixcar.test'; commit;\"" 2>&1 | grep -E '^DELETE')"

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
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.convoyeurs set telephone='+33600000002' where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^UPDATE')"

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
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.convoyeurs set bloque=false where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^UPDATE')"
check "D8 : il reste bloqué après sa tentative" "t" \
  "$(sql "select bloque from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-000000000001';")"
check "D9 : il ne peut PAS accepter une mission" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.missions set statut='acceptee' where reference='TEST-QA-M2'; commit;\"" 2>&1 | grep -E '^UPDATE')"
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
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); update public.clients set statut='validee', prix_interne=1 where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^UPDATE|^ERROR' | head -1)"
check "G10 : et sa demande reste intacte" "nouveau|990.00" \
  "$(sql "select statut||'|'||prix_interne from public.clients where id='cccccccc-0000-0000-0000-00000000000A';")"
check "G11 : le client ne peut PAS supprimer sa demande" "DELETE 0" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test'); delete from public.clients where auth_user_id=auth.uid(); commit;\"" 2>&1 | grep -E '^DELETE|^ERROR' | head -1)"
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
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA Seul')),
     repeat('5',48)); commit;
   select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000B';" | tail -1)"
# Le rejeu doit être PROUVÉ : un secret de création, dont seule
# l'empreinte est stockée. On rejoue la demande V5 en le fournissant.
check "V6 : REJEU PROUVÉ (bon secret) — aucune duplication" "1|1" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B','numero_client','TEST-QA-V5',
                        'email','v5@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA Seul')),
     repeat('5',48)); commit;
   select (select count(*) from public.clients where numero_client='TEST-QA-V5')||'|'||(select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000B');" | tail -1)"
check "V6b : le rejeu prouvé se déclare bien comme un rejeu" "true" \
  "$(sql "begin; select public.devenir_anon();
   select (public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B','numero_client','TEST-QA-V5',
                        'email','v5@helixcar.test','type_service','convoyage'),
     '[]'::jsonb, repeat('5',48)) ->> 'deja_existante'); commit;" | tail -1)"
check "V6c : le secret n'est JAMAIS renvoyé au navigateur" "0" \
  "$(sql "begin; select public.devenir_anon();
   select (public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B'),
     '[]'::jsonb, repeat('5',48))::text ~ '(creation_cle|55555)')::int; commit;" | tail -1)"
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

# ── V bis. TESTS OFFENSIFS SUR creer_demande_avec_vehicules ──
# Cette fonction est SECURITY DEFINER et exécutable par `anon`. Tout ce
# qui suit tente de s'en servir contre son propriétaire légitime.
#
# La demande cible : celle du client A (V8), qui existe, appartient à
# un compte, et n'a AUCUN véhicule. C'est le pire cas — l'ancienne
# version s'y greffait sans rien demander.
sql "insert into auth.users (id,email) values
  ('66666666-6666-6666-6666-666666666666','clientB@helixcar.test')
  on conflict do nothing;" >/dev/null

# 1. Client B connaît l'UUID de la demande du client A.
sqlV="begin; select public.devenir('66666666-6666-6666-6666-666666666666','clientB@helixcar.test');
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000D','numero_client','TEST-QA-PIRATE-B',
                        'email','pirate@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',9,'marque_modele','TEST-QA VOL B'))); commit;"
resV=$(sql "$sqlV")
check "V13 : le client B ne peut PAS greffer ses véhicules sur la demande du client A" "0" \
  "$(sql "select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000D';" | tail -1)"
check "V14 : la demande du client A n'a pas changé de propriétaire" "55555555-5555-5555-5555-555555555555" \
  "$(sql "select auth_user_id::text from public.clients where id='ffffffff-0000-0000-0000-00000000000D';" | tail -1)"
check "V15 : le numéro client d'autrui ne lui est PAS révélé" "0" \
  "$(echo "$resV" | grep -c 'TEST-QA-V8')"
check "V16 : sa propre demande a bien été créée, sous un identifiant NEUF" "1" \
  "$(sql "select count(*) from public.clients where numero_client='TEST-QA-PIRATE-B' and id<>'ffffffff-0000-0000-0000-00000000000D';" | tail -1)"

# 2. Un partenaire connaît une demande via une mission qui lui est
#    attribuée : il tente d'y rattacher un véhicule.
sql "insert into public.missions (reference,statut,client_id,convoyeur_id)
  values ('TEST-QA-MV','acceptee','ffffffff-0000-0000-0000-00000000000D',
          'aaaaaaaa-0000-0000-0000-000000000001') on conflict do nothing;" >/dev/null
sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000D','numero_client','TEST-QA-PIRATE-P',
                        'email','p@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',8,'marque_modele','TEST-QA VOL P'))); commit;" >/dev/null
check "V17 : un partenaire ne greffe rien sur la demande d'un client" "0" \
  "$(sql "select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000D';" | tail -1)"

# 3. Visiteur anonyme visant une demande existante sans véhicules.
sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000D','numero_client','TEST-QA-PIRATE-A',
                        'email','a@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',7,'marque_modele','TEST-QA VOL A'))); commit;" >/dev/null
check "V18 : un visiteur anonyme non plus" "0" \
  "$(sql "select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000D';" | tail -1)"

# 4. Mauvais secret : ce n'est pas un rejeu, c'est une tentative.
sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B','numero_client','TEST-QA-PIRATE-S',
                        'email','s@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',6,'marque_modele','TEST-QA VOL S')),
     repeat('9',48)); commit;" >/dev/null
check "V19 : un MAUVAIS secret ne vaut pas rejeu" "1" \
  "$(sql "select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000B';" | tail -1)"
check "V20 : un secret trop court est refusé comme preuve" "1" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000B'),'[]'::jsonb,'court'); commit;
   select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-00000000000B';" | tail -1)"

# 5. Le propriétaire authentifié, lui, rejoue légitimement SA demande.
check "V21 : le propriétaire authentifié rejoue SA demande sans doublon" "true" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
   select (public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-00000000000D','numero_client','TEST-QA-V8',
                        'email','clientA@helixcar.test','type_service','nettoyage'),
     '[]'::jsonb) ->> 'deja_existante'); commit;" | tail -1)"

# 6. Colonnes administratives — celles d'aujourd'hui ET une ajoutée
#    APRÈS la migration : une liste blanche doit la refuser d'office.
sql "alter table public.clients add column if not exists remise_exceptionnelle numeric;" >/dev/null
check "V22 : une colonne administrative FUTURE est ignorée d'office" "0" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-0000000000AA','numero_client','TEST-QA-V22',
                        'email','v22@helixcar.test','type_service','convoyage',
                        'remise_exceptionnelle',999,'prix_interne',888),'[]'::jsonb,repeat('a',48)); commit;
   select count(*) from public.clients where id='ffffffff-0000-0000-0000-0000000000AA'
     and (remise_exceptionnelle is not null or prix_interne is not null);" | tail -1)"
check "V23 : mais les colonnes légitimes de la même demande sont bien écrites" "v22@helixcar.test" \
  "$(sql "select email from public.clients where id='ffffffff-0000-0000-0000-0000000000AA';" | tail -1)"

# 7. Colonnes inattendues DANS les véhicules — l'ancienne version
#    n'avait aucune liste blanche ici.
sql "alter table public.vehicules add column if not exists cout_interne numeric;" >/dev/null
check "V24 : une colonne inattendue d'un véhicule est ignorée" "0" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-0000000000BB','numero_client','TEST-QA-V24',
                        'email','v24@helixcar.test','type_service','convoyage'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA V24',
                                          'cout_interne',777)),repeat('b',48)); commit;
   select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-0000000000BB'
     and cout_interne is not null;" | tail -1)"
check "V25 : et le véhicule est bien créé avec ses champs légitimes" "TEST-QA V24" \
  "$(sql "select marque_modele from public.vehicules where dossier_id='ffffffff-0000-0000-0000-0000000000BB';" | tail -1)"
check "V26 : une clé totalement inventée ne fait pas échouer l'appel" "1" \
  "$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','ffffffff-0000-0000-0000-0000000000CC','numero_client','TEST-QA-V26',
                        'email','v26@helixcar.test','type_service','convoyage',
                        'colonne_qui_nexiste_pas','x'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA V26',
                                          'champ_invente','y')),repeat('c',48)); commit;
   select count(*) from public.vehicules where dossier_id='ffffffff-0000-0000-0000-0000000000CC';" | tail -1)"

# 8. L'ancienne signature à deux arguments ne doit plus exister seule :
#    la laisser ouverte laisserait une porte sans preuve d'idempotence.
check "V27 : une seule signature de la fonction est exposée" "1" \
  "$(sql "select count(*) from pg_proc where proname='creer_demande_avec_vehicules';" | tail -1)"
check "V28 : les listes blanches sont bien des fonctions du schéma public" "2" \
  "$(sql "select count(*) from pg_proc where proname in ('champs_publics_demande','champs_publics_vehicule');" | tail -1)"

check "V11 : la RLS de vehicules reste ACTIVE" "t" \
  "$(sql "select relrowsecurity from pg_class where relname='vehicules';")"
check "V12 : aucune écriture anonyme directe n'a été ouverte" "refuse" \
  "$(sql "begin; select public.devenir_anon();
   insert into public.vehicules (dossier_id,position,marque_modele)
     values ('ffffffff-0000-0000-0000-00000000000A',9,'TEST-QA PIRATE'); commit;" \
   | grep -qiE 'row-level security|error' && echo refuse || echo passe)"

echo
echo "── W. INFORMATIONS RÉELLEMENT MANQUANTES (§10) ──"
# Jeux d'essai TEST-QA couvrant les scénarios que la version livrée avec
# 06 traitait mal. Ils sont créés AVANT d'appliquer 94 pour reproduire
# d'abord le défaut, puis prouver la correction sur les mêmes données.
sql "insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777','clientW@helixcar.test');

-- 1. NETTOYAGE complet, contact sur place IMBRIQUÉ, chez le client.
insert into public.clients (id, auth_user_id, numero_client, email, prenom, nom,
                            type_service, statut, nettoyage_details) values
 ('dddddddd-0000-0000-0000-0000000000a1','77777777-7777-7777-7777-777777777777','TEST-QA-W-NETT',
  'clientW@helixcar.test','TEST-QA','ClientW','nettoyage','nouveau',
  '{\"type_nettoyage\":\"complet\",\"lieu\":\"locaux_client\",\"date_souhaitee\":\"2026-11-02\",
    \"heure_precise\":\"09:00\",\"adresse_rue\":\"3 rue des Lilas\",\"adresse_ville\":\"Lyon\",
    \"contact_sur_place\":{\"type\":\"autre\",\"nom\":\"TEST-QA Martin\",\"telephone\":\"+33600000020\"}}'::jsonb);

-- 2. NETTOYAGE dans les locaux HelixCar : aucune adresse à réclamer.
insert into public.clients (id, auth_user_id, numero_client, email,
                            type_service, statut, nettoyage_details) values
 ('dddddddd-0000-0000-0000-0000000000a2','77777777-7777-7777-7777-777777777777','TEST-QA-W-NETT-HC',
  'clientW@helixcar.test','nettoyage','nouveau',
  '{\"type_nettoyage\":\"complet\",\"lieu\":\"helixcar\",\"date_souhaitee\":\"2026-11-03\",
    \"heure_precise\":\"10:00\",
    \"contact_sur_place\":{\"type\":\"moi\",\"nom\":\"TEST-QA ClientW\",\"telephone\":\"+33600000021\"}}'::jsonb);

-- 3. STOCKAGE : le client dépose ET récupère lui-même.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            stockage_ville, stockage_date_debut,
                            stockage_acheminement, stockage_sortie, trajet_commun) values
 ('dddddddd-0000-0000-0000-0000000000a3','77777777-7777-7777-7777-777777777777','TEST-QA-W-DEPOT',
  'clientW@helixcar.test','stockage','nouveau','Marseille','2026-12-01',
  'depot_client','recuperation_client', false);
insert into public.vehicules (dossier_id, position, immatriculation, marque_modele) values
 ('dddddddd-0000-0000-0000-0000000000a3',1,'DD-111-DD','Renault Clio');

-- 4. STOCKAGE : HelixCar achemine ET restitue.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            stockage_ville, stockage_date_debut,
                            stockage_acheminement, stockage_sortie, trajet_commun) values
 ('dddddddd-0000-0000-0000-0000000000a4','77777777-7777-7777-7777-777777777777','TEST-QA-W-STOCK-HC',
  'clientW@helixcar.test','stockage','nouveau','Marseille','2026-12-01',
  'helixcar','helixcar', false);
insert into public.vehicules (dossier_id, position, immatriculation, marque_modele) values
 ('dddddddd-0000-0000-0000-0000000000a4',1,'SS-111-SS','Renault Clio');

-- 5. CONVOYAGE MULTI-VÉHICULES : le 1 est complet, le 2 non.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            nb_vehicules, trajet_commun) values
 ('dddddddd-0000-0000-0000-0000000000a5','77777777-7777-7777-7777-777777777777','TEST-QA-W-MULTI',
  'clientW@helixcar.test','convoyage','nouveau',2,false);
insert into public.vehicules (dossier_id, position, immatriculation, marque_modele,
                              adresse_depart_rue, date_prise_en_charge, pc_contact_nom, pc_contact_tel,
                              adresse_arrivee_rue, liv_contact_nom, liv_contact_tel) values
 ('dddddddd-0000-0000-0000-0000000000a5',1,'MM-111-MM','Peugeot 208',
  '1 rue Un','2026-10-05','TEST-QA Un','+33600000031',
  '2 rue Deux','TEST-QA Deux','+33600000032'),
 ('dddddddd-0000-0000-0000-0000000000a5',2,null,'Citroen C3',
  '1 rue Un','2026-10-05','TEST-QA Un','+33600000031',
  '2 rue Deux','TEST-QA Deux','+33600000032');

-- 6. CONVOYAGE MONO-VÉHICULE entièrement renseigné.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            nb_vehicules, trajet_commun) values
 ('dddddddd-0000-0000-0000-0000000000a6','77777777-7777-7777-7777-777777777777','TEST-QA-W-MONO',
  'clientW@helixcar.test','convoyage','nouveau',1,false);
insert into public.vehicules (dossier_id, position, immatriculation, marque_modele,
                              adresse_depart_rue, date_prise_en_charge, pc_contact_nom, pc_contact_tel,
                              adresse_arrivee_rue, liv_contact_nom, liv_contact_tel) values
 ('dddddddd-0000-0000-0000-0000000000a6',1,'UU-111-UU','Tesla Model 3',
  '5 rue Cinq','2026-10-09','TEST-QA Cinq','+33600000041',
  '6 rue Six','TEST-QA Six','+33600000042');

-- 7. STOCKAGE sortie HelixCar, mais UN SEUL des deux véhicules est
--    récupéré par le client (heure de récupération enregistrée).
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            stockage_ville, stockage_date_debut,
                            stockage_acheminement, stockage_sortie, nb_vehicules, trajet_commun) values
 ('dddddddd-0000-0000-0000-0000000000a7','77777777-7777-7777-7777-777777777777','TEST-QA-W-RECUP',
  'clientW@helixcar.test','stockage','nouveau','Marseille','2026-12-01',
  'helixcar','helixcar',2,false);
insert into public.vehicules (dossier_id, position, immatriculation, marque_modele,
                              heure_recuperation_client) values
 ('dddddddd-0000-0000-0000-0000000000a7',1,'RR-111-RR','Fiat 500', null),
 ('dddddddd-0000-0000-0000-0000000000a7',2,'RR-222-RR','Fiat Panda','14:00');

-- 8. PROFESSIONNEL, contact sur place IMBRIQUÉ.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            professionnel_details) values
 ('dddddddd-0000-0000-0000-0000000000a8','77777777-7777-7777-7777-777777777777','TEST-QA-W-PRO',
  'clientW@helixcar.test','professionnel','nouveau',
  '{\"categorie\":\"technicien\",\"specialite\":\"carrosserie\",\"adresse_rue\":\"9 rue Neuf\",
    \"adresse_ville\":\"Nantes\",\"date_debut\":\"2026-11-10\",\"date_fin\":\"2026-11-12\",
    \"heure_debut\":\"08:00\",\"heure_fin\":\"17:00\",\"description\":\"TEST-QA remise en etat\",
    \"contact_sur_place\":{\"type\":\"autre\",\"nom\":\"TEST-QA Durand\",\"telephone\":\"+33600000050\"}}'::jsonb);

-- 8b. PROFESSIONNEL en mode CONSEIL : le client demande à HelixCar de
--     déterminer le métier. Ne rien lui réclamer est la bonne réponse.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            professionnel_details) values
 ('dddddddd-0000-0000-0000-0000000000b2','77777777-7777-7777-7777-777777777777','TEST-QA-W-CONSEIL',
  'clientW@helixcar.test','professionnel','nouveau',
  '{\"categorie\":\"technicien\",\"conseil\":true,\"adresse_rue\":\"9 rue Neuf\",
    \"adresse_ville\":\"Nantes\",\"date_debut\":\"2026-11-10\",\"date_fin\":\"2026-11-12\",
    \"heure_debut\":\"08:00\",\"heure_fin\":\"17:00\",\"description\":\"TEST-QA a definir\",
    \"contact_sur_place\":{\"type\":\"autre\",\"nom\":\"TEST-QA Durand\",\"telephone\":\"+33600000051\"}}'::jsonb);

-- 8c. PROFESSIONNEL hors conseil, métier NON choisi : là, il manque
--     réellement quelque chose.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            professionnel_details) values
 ('dddddddd-0000-0000-0000-0000000000b3','77777777-7777-7777-7777-777777777777','TEST-QA-W-SANS-METIER',
  'clientW@helixcar.test','professionnel','nouveau',
  '{\"categorie\":\"technicien\",\"conseil\":false,\"adresse_rue\":\"9 rue Neuf\",
    \"adresse_ville\":\"Nantes\",\"date_debut\":\"2026-11-10\",\"date_fin\":\"2026-11-12\",
    \"heure_debut\":\"08:00\",\"heure_fin\":\"17:00\",\"description\":\"TEST-QA sans metier\",
    \"contact_sur_place\":{\"type\":\"autre\",\"nom\":\"TEST-QA Durand\",\"telephone\":\"+33600000052\"}}'::jsonb);

-- 9. CRÉATION DE COMPTE seule : aucun service, donc aucune rubrique.
insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut) values
 ('dddddddd-0000-0000-0000-0000000000a9','77777777-7777-7777-7777-777777777777','TEST-QA-W-COMPTE',
  'clientW@helixcar.test', null,'compte_cree');" >/dev/null

# ── REPRODUCTION DU DÉFAUT (fonction livrée avec 06, 94 non appliquée) ──
check "W1 : REPRODUCTION — le contact sur place imbriqué est réclamé à tort" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1') where cle='contact_pc_nom';")"
check "W2 : REPRODUCTION — l'immatriculation portée par la fiche véhicule est réclamée à tort" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where cle='immatriculation';")"
check "W3 : REPRODUCTION — une seule rubrique immatriculation pour DEUX véhicules" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where cle like '%immatriculation%';")"
check "W4 : REPRODUCTION — un dépôt par le client réclame quand même une prise en charge" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a3') where cle='immatriculation' and statut='attendue';")"

# ── CORRECTIF ──
errW=$(appliquer migrations/94_informations_selon_scenario.sql)
check "W5 : migrations/94 s'applique sans erreur" "" "$errW"

check "W6 : le contact sur place imbriqué est reconnu (nettoyage)" "fournie|fournie" \
  "$(sqlAdmin "select string_agg(statut,'|' order by cle) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1') where cle like 'contact_sur_place%';")"
check "W7 : plus AUCUNE information manquante sur ce nettoyage complet" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1') where statut='attendue';")"
check "W8 : l'adresse est demandée quand l'intervention a lieu chez le client" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1') where cle='nettoyage_adresse';")"
check "W9 : elle ne l'est PAS dans les locaux HelixCar" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a2') where cle like 'nettoyage_adresse%' or cle like 'nettoyage_ville%';")"
check "W10 : et ce nettoyage-là n'a lui non plus rien de manquant" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a2') where statut='attendue';")"

check "W11 : dépôt par le client — AUCUNE prise en charge n'est réclamée" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a3') where cle like '%prise_en_charge%' or cle like '%adresse_depart%' or cle like '%contact_pc%';")"
check "W12 : récupération par le client — AUCUNE livraison n'est réclamée" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a3') where cle like '%adresse_arrivee%' or cle like '%contact_liv%';")"
check "W13 : ce stockage-là ne réclame plus rien" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a3') where statut='attendue';")"
check "W14 : acheminement ET sortie HelixCar — les deux extrémités sont réclamées" "4|3" \
  "$(sqlAdmin "select (select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a4') where cle like '%adresse_depart%' or cle like '%prise_en_charge%' or cle like '%contact_pc%')||'|'||(select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a4') where cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"
check "W15 : la ville et la date de stockage restent demandées dans les deux cas" "2|2" \
  "$(sqlAdmin "select (select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a3') where cle like 'stockage_%')||'|'||(select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a4') where cle like 'stockage_%');")"

check "W16 : multi-véhicules — le véhicule concerné est nommé" "Véhicule 2 — immatriculation" \
  "$(sqlAdmin "select libelle from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where statut='attendue';")"
check "W17 : le véhicule 1 est reconnu comme fourni" "fournie" \
  "$(sqlAdmin "select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where cle='vehicule_1_immatriculation';")"
check "W18 : les véhicules ne sont JAMAIS mélangés (une rubrique par véhicule)" "2" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where cle like 'vehicule_%_immatriculation';")"
check "W19 : et une seule information manque au total" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where statut='attendue';")"
check "W20 : mono-véhicule — le libellé ne préfixe PAS inutilement un rang" "Immatriculation du véhicule" \
  "$(sqlAdmin "select libelle from public.informations_demande('dddddddd-0000-0000-0000-0000000000a6') where cle='vehicule_1_immatriculation';")"
check "W21 : et ce convoyage mono-véhicule complet ne réclame plus rien" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a6') where statut='attendue';")"

check "W22 : véhicule récupéré par le client — aucune livraison pour LUI" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a7') where cle like 'vehicule_2_%' and (cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"
check "W23 : mais son voisin, livré par HelixCar, garde les siennes" "3" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a7') where cle like 'vehicule_1_%' and (cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"

check "W24 : professionnel — le contact sur place imbriqué est reconnu" "fournie|fournie" \
  "$(sqlAdmin "select string_agg(statut,'|' order by cle) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a8') where cle like 'contact_sur_place%';")"
check "W25 : et cette demande professionnelle complète ne réclame rien" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a8') where statut='attendue';")"
check "W26 : création de compte seule — aucune rubrique inventée" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a9');")"

# ── Le parcours de réponse continue de fonctionner avec les clés du scénario ──
check "W27 : le client répond sur la clé nommée de SON véhicule" "1" \
  "$(sql "begin; select public.devenir('77777777-7777-7777-7777-777777777777','clientW@helixcar.test');
   select public.repondre_informations_demande('dddddddd-0000-0000-0000-0000000000a5',
     '{\"vehicule_2_immatriculation\":\"MM-222-MM\"}'::jsonb); commit;" | tail -1)"
check "W28 : la réponse est bien portée par le véhicule 2, jamais par le 1" "transmise|fournie" \
  "$(sqlAdmin "select (select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where cle='vehicule_2_immatriculation')||'|'||(select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000a5') where cle='vehicule_1_immatriculation');")"
check "W29 : une clé NON REQUISE par le scénario reste ignorée" "0" \
  "$(sql "begin; select public.devenir('77777777-7777-7777-7777-777777777777','clientW@helixcar.test');
   select public.repondre_informations_demande('dddddddd-0000-0000-0000-0000000000a3',
     '{\"contact_pc_nom\":\"TEST-QA Personne\"}'::jsonb); commit;" | tail -1)"
check "W30 : le client d'une AUTRE demande ne peut toujours pas répondre" "insufficient" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
   select public.repondre_informations_demande('dddddddd-0000-0000-0000-0000000000a5',
     '{\"vehicule_1_immatriculation\":\"PIRATE\"}'::jsonb); commit;" | grep -qiE 'non autorisée|insufficient' && echo insufficient || echo passe)"
check "W31 : aucune donnée réelle n'a été écrite dans public.vehicules par la réponse" "" \
  "$(sql "select immatriculation from public.vehicules where dossier_id='dddddddd-0000-0000-0000-0000000000a5' and position=2;")"

# ── DÉCISION DE LIVRAISON APRÈS STOCKAGE : ENREGISTRÉE, PLUS DEVINÉE ──
# Le cas que le repli seul ne pouvait pas traiter : le client a choisi de
# venir rechercher son véhicule mais n'a pas encore donné son heure de
# passage. Sans la décision enregistrée, on lui réclamerait une adresse
# de livraison qui n'a aucune raison d'exister.
check "W32 : la colonne de décision est bien ajoutée par la migration" "1" \
  "$(sql "select count(*) from information_schema.columns where table_schema='public' and table_name='vehicules' and column_name='livraison_apres_stockage';")"
sql "insert into public.clients (id, auth_user_id, numero_client, email, type_service, statut,
                            stockage_ville, stockage_date_debut,
                            stockage_acheminement, stockage_sortie, nb_vehicules, trajet_commun) values
 ('dddddddd-0000-0000-0000-0000000000b1','77777777-7777-7777-7777-777777777777','TEST-QA-W-DECISION',
  'clientW@helixcar.test','stockage','nouveau','Marseille','2026-12-01',
  'helixcar','helixcar',3,false);
insert into public.vehicules (dossier_id, position, immatriculation, marque_modele,
                              livraison_apres_stockage, heure_recuperation_client,
                              adresse_arrivee_rue, liv_contact_nom, liv_contact_tel) values
 ('dddddddd-0000-0000-0000-0000000000b1',1,'BB-111-BB','Audi A3', true, null,
  '7 rue Sept','TEST-QA Sept','+33600000061'),
 ('dddddddd-0000-0000-0000-0000000000b1',2,'BB-222-BB','Audi A4', false, null, null, null, null),
 ('dddddddd-0000-0000-0000-0000000000b1',3,'BB-333-BB','Audi A5', null, '15:30', null, null, null);" >/dev/null
check "W33 : décision « HelixCar livre » — les rubriques de livraison existent" "3" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000b1') where cle like 'vehicule_1_%' and (cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"
check "W34 : décision « le client récupère » — AUCUNE, même sans heure de passage" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000b1') where cle like 'vehicule_2_%' and (cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"
check "W35 : décision inconnue (ligne ancienne) — le repli par l'heure s'applique" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000b1') where cle like 'vehicule_3_%' and (cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"
# Le véhicule 1 a sa livraison entièrement renseignée, mais AUCUNE
# information de prise en charge : l'acheminement étant confié à
# HelixCar, ces quatre-là manquent réellement et doivent être signalées.
check "W36 : la livraison du véhicule 1, renseignée, n'est pas réclamée" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000b1') where statut='attendue' and cle like 'vehicule_1_%' and (cle like '%adresse_arrivee%' or cle like '%contact_liv%');")"
check "W36b : sa prise en charge, elle, manque bel et bien" "4" \
  "$(sqlAdmin "select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000b1') where statut='attendue' and cle like 'vehicule_1_%' and (cle like '%adresse_depart%' or cle like '%prise_en_charge%' or cle like '%contact_pc%');")"
check "W36c : et elle est réclamée pour CHAQUE véhicule, sans mélange" "4|4|4" \
  "$(sqlAdmin "select string_agg(n::text,'|' order by v) from (select split_part(cle,'_',2) as v, count(*) as n from public.informations_demande('dddddddd-0000-0000-0000-0000000000b1') where cle like '%adresse_depart%' or cle like '%prise_en_charge%' or cle like '%contact_pc%' group by 1) t;")"
check "W37 : mode conseil — aucun métier n'est réclamé au client" "fournie" \
  "$(sqlAdmin "select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000b2') where cle='professionnel_besoin';")"
check "W38 : hors conseil, un métier non choisi EST réclamé" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('dddddddd-0000-0000-0000-0000000000b3') where cle='professionnel_besoin';")"


# ── W bis. QUI A LE DROIT DE LIRE UN RAPPORT D'INFORMATIONS ? ──
# informations_demande() est SECURITY DEFINER : elle lit clients et
# vehicules en passant OUTRE la RLS, et elle est accordée à tout
# utilisateur `authenticated`. Sans autorisation interne, connaître un
# identifiant suffisait à obtenir les coordonnées du contact, les
# adresses et les dates d'une demande. Un partenaire lit précisément
# cet identifiant sur chaque mission qui lui est attribuée.
check "W39 : le PROPRIÉTAIRE lit bien le rapport de SA demande" "true" \
  "$(sql "begin; select public.devenir('77777777-7777-7777-7777-777777777777','clientW@helixcar.test');
   select (count(*) > 0)::text from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1'); commit;" | tail -1)"
check "W40 : l'ADMINISTRATEUR aussi" "true" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   select (count(*) > 0)::text from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1'); commit;" | tail -1)"
check "W41 : un AUTRE client n'obtient RIEN, même en connaissant l'identifiant" "0" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
   select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1'); commit;" | tail -1)"
check "W42 : ... et n'obtient pas davantage une erreur qui confirmerait l'existence" "0" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
   select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1'); commit;" \
   | grep -ciE 'error|exception' )"
# Le partenaire connaît le client_id : il le lit sur sa propre mission.
sql "insert into public.missions (reference,statut,client_id,convoyeur_id)
  values ('TEST-QA-MW','acceptee','dddddddd-0000-0000-0000-0000000000a1',
          'aaaaaaaa-0000-0000-0000-000000000001') on conflict do nothing;" >/dev/null
check "W43 : le partenaire lit bien le client_id sur SA mission" "1" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   select count(*) from public.missions where reference='TEST-QA-MW' and client_id is not null; commit;" | tail -1)"
check "W44 : mais ce client_id ne lui ouvre AUCUN rapport d'informations" "0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1'); commit;" | tail -1)"
check "W45 : un identifiant inexistant ne distingue pas d'un identifiant interdit" "0|0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   select (select count(*) from public.informations_demande('dddddddd-0000-0000-0000-0000000000a1'))||'|'||
          (select count(*) from public.informations_demande('00000000-0000-0000-0000-000000000000')); commit;" | tail -1)"

echo
echo "── X. MÉTIERS DÉCLARÉS PAR LES PARTENAIRES (§13) ──"
# AVANT la migration : un candidat ne peut pas se déclarer technicien,
# alors qu'un client peut en demander un. On le prouve d'abord.
check "X1 : REPRODUCTION — la colonne des métiers n'existe pas encore" "0" \
  "$(sql "select count(*) from information_schema.columns where table_schema='public' and table_name='convoyeurs' and column_name='metiers';")"
# La candidature technicien est créée AVANT la migration : c'est
# exactement le cas d'une candidature déposée puis rattrapée par la mise
# à jour, et cela prouve que la migration crée ses décisions manquantes.
sql "insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888','tech@helixcar.test');
insert into public.convoyeurs (id, auth_user_id, prenom, nom, email, activites, statut) values
 ('aaaaaaaa-0000-0000-0000-00000000000e','88888888-8888-8888-8888-888888888888','TEST-QA','Technicien',
  'tech@helixcar.test','{renfort}','en_attente');" >/dev/null
# (l'activite technicien lui sera ajoutee plus bas : la contrainte de
# production, reproduite par le socle, la refuse encore a ce stade.)
check "X2 : REPRODUCTION — l'activité technicien est refusée par la base" "refuse" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
     values ('aaaaaaaa-0000-0000-0000-00000000000e','technicien','en_attente'); commit;" \
   | grep -qiE 'violates check constraint|error' && echo refuse || echo passe)"
check "X2b : REPRODUCTION — sa candidature reste donc sans décision technicien" "0" \
  "$(sql "select count(*) from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-00000000000e' and activite='technicien';")"

# Une contrainte SANS RAPPORT, mais dont la définition contient le mot
# « activite » : la version précédente de 95 la supprimait au passage.
sql "alter table public.convoyeur_decisions
       add column if not exists activite_libelle text;
     alter table public.convoyeur_decisions
       drop constraint if exists tq_activite_libelle_court;
     alter table public.convoyeur_decisions
       add constraint tq_activite_libelle_court
       check (activite_libelle is null or char_length(activite_libelle) < 60);" >/dev/null

errX=$(appliquer migrations/95_metiers_partenaires.sql)
check "X3 : migrations/95 s'applique sans erreur" "" "$errX"

# ── CE QUE 95 NE SUFFIT PAS À FAIRE ────────────────────────────────
# 95 a ouvert l'activité 'technicien' du côté des DÉCISIONS. Mais la
# table convoyeurs porte, depuis bien avant ce dépôt, sa propre
# contrainte d'énumération — absente de migrations/, et que le socle
# reproduit désormais. Avec 95 seule, aucune candidature de technicien
# ne peut être enregistrée : c'est le blocage constaté en production.
check "X3 bis : REPRODUCTION — avec 95 seule, se déclarer technicien est refusé (23514)" "refuse" \
  "$(sql "update public.convoyeurs set activites='{technicien,renfort}'
      where id='aaaaaaaa-0000-0000-0000-00000000000e';" \
   | grep -qiE '23514|violates check constraint' && echo refuse || echo passe)"
check "X3 ter : REPRODUCTION — sa candidature reste sans l'activité technicien" "0" \
  "$(sql "select count(*) from public.convoyeurs
      where id='aaaaaaaa-0000-0000-0000-00000000000e' and 'technicien' = any(activites);")"

errX100=$(appliquer migrations/100_activites_partenaire.sql)
check "X3 quater : migrations/100 s'applique sans erreur" "" "$errX100"

# Le candidat peut enfin se déclarer technicien ; 95 rejouée lui crée
# alors les décisions qui manquaient, sans en accepter aucune d'office.
sql "update public.convoyeurs set activites='{technicien,renfort}'
      where id='aaaaaaaa-0000-0000-0000-00000000000e';" >/dev/null
errX95b=$(appliquer migrations/95_metiers_partenaires.sql)
check "X3 quinquies : 95 rejouée après 100 rattrape les décisions manquantes" "" "$errX95b"

check "X4 : la colonne des métiers existe et accepte un tableau" "1" \
  "$(sql "select count(*) from information_schema.columns where table_schema='public' and table_name='convoyeurs' and column_name='metiers' and data_type='ARRAY';")"
check "X5 : aucune candidature existante n'a été modifiée" "2|0" \
  "$(sql "select count(*)||'|'||count(metiers) from public.convoyeurs where id in ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000002');")"
sql "update public.convoyeurs set metiers = '{carrosserie,mecanique,jockey}'
 where id='aaaaaaaa-0000-0000-0000-00000000000e';" >/dev/null
check "X6 : un candidat peut désormais se déclarer technicien" "1" \
  "$(sql "select count(*) from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-00000000000e' and 'technicien' = any(activites);")"
check "X7 : et déclarer PLUSIEURS métiers" "3" \
  "$(sql "select array_length(metiers,1) from public.convoyeurs where id='aaaaaaaa-0000-0000-0000-00000000000e';")"
check "X8 : la migration a créé les décisions manquantes de cette candidature" "renfort|technicien" \
  "$(sql "select string_agg(activite,'|' order by activite) from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-00000000000e';")"
check "X9 : une activité INVENTÉE reste refusée" "refuse" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
     values ('aaaaaaaa-0000-0000-0000-00000000000e','pirate','oui'); commit;" \
   | grep -qiE 'violates check constraint|error' && echo refuse || echo passe)"
check "X10 : les décisions restent EN ATTENTE, jamais acceptées d'office" "2" \
  "$(sql "select count(*) from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-00000000000e' and decision='en_attente';")"
check "X11 : une décision par métier déclaré n'est PAS créée — la décision reste par activité" "2" \
  "$(sql "select count(*) from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-00000000000e';")"
check "X12 : les décisions déjà prises ne sont pas réinitialisées" "oui" \
  "$(sql "select decision from public.convoyeur_decisions where convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' and activite='convoyage';")"

check "X20 : une contrainte SANS RAPPORT n'est pas emportée" "1" \
  "$(sql "select count(*) from pg_constraint where conrelid='public.convoyeur_decisions'::regclass and conname='tq_activite_libelle_court';")"
check "X21 : et elle protège toujours réellement" "refuse" \
  "$(sql "insert into public.convoyeur_decisions (convoyeur_id,activite,decision,activite_libelle)
     values ('aaaaaaaa-0000-0000-0000-000000000002','technicien','en_attente',repeat('x',80));" \
   | grep -qiE 'violates check constraint|error' && echo refuse || echo passe)"
check "X22 : une seule contrainte d'énumération sur activite" "1" \
  "$(sql "select count(*) from pg_constraint con
     join lateral unnest(con.conkey) as k(attnum) on true
     join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.attnum
    where con.conrelid='public.convoyeur_decisions'::regclass and con.contype='c'
      and array_length(con.conkey,1)=1 and a.attname='activite'
      and pg_get_constraintdef(con.oid) ilike '%convoyage%';")"

echo
echo "── Y. MISSIONS DE NETTOYAGE ET PHOTOS D'INTERVENTION (§14) ──"
check "Y1 : REPRODUCTION — public.missions ne sait pas décrire un nettoyage" "0" \
  "$(sql "select count(*) from information_schema.columns where table_schema='public' and table_name='missions' and column_name='type_mission';")"
check "Y2 : REPRODUCTION — aucune table de photos d'intervention" "0" \
  "$(sql "select count(*) from information_schema.tables where table_schema='public' and table_name='mission_photos';")"

errY=$(appliquer migrations/96_missions_nettoyage.sql)
check "Y3 : migrations/96 s'applique sans erreur" "" "$errY"

# Ce qui compte n'est pas COMBIEN de missions préexistaient, mais
# qu'AUCUNE n'ait changé de nature : la valeur par défaut de 96 les
# laisse toutes en convoyage. Compter en dur rendait ce contrôle
# dépendant des jeux d'essai créés plus haut.
check "Y4 : toute mission existante reste un convoyage" "0" \
  "$(sql "select count(*) from public.missions where type_mission is distinct from 'convoyage';")"
check "Y4b : et il y en a bien" "true" \
  "$(sql "select (count(*) > 0)::text from public.missions;")"
check "Y5 : une mission de nettoyage peut être créée" "INSERT 0 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); insert into public.missions (id,reference,statut,type_mission,client_id,prestation,adresse_intervention,ville_intervention,contact_nom,contact_tel,date_intervention,prix_ttc) values ('bbbbbbbb-0000-0000-0000-0000000000c1','TEST-QA-NET-1','en_attente','nettoyage','dddddddd-0000-0000-0000-0000000000a1','Nettoyage intérieur et extérieur','3 rue des Lilas','Lyon','TEST-QA Martin','+33600000020','2026-11-02',400); commit;\"" 2>&1 | grep -E '^INSERT')"
check "Y6 : un type de mission INVENTÉ est refusé" "refuse" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   insert into public.missions (reference,statut,type_mission) values ('TEST-QA-PIRATE','en_attente','pirate'); commit;" \
   | grep -qiE 'violates check constraint|error' && echo refuse || echo passe)"

# Le partenaire de la mission, et lui seul.
sql "update public.missions set convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001'
      where id='bbbbbbbb-0000-0000-0000-0000000000c1';" >/dev/null
check "Y7 : le partenaire affecté est reconnu comme tel" "t" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   select public.est_partenaire_de_mission('bbbbbbbb-0000-0000-0000-0000000000c1'); commit;" | tail -1)"
check "Y8 : un AUTRE partenaire ne l'est pas" "f" \
  "$(sql "begin; select public.devenir('44444444-4444-4444-4444-444444444444','ancien@helixcar.test');
   select public.est_partenaire_de_mission('bbbbbbbb-0000-0000-0000-0000000000c1'); commit;" | tail -1)"

check "Y9 : le partenaire dépose une photo de SA mission" "INSERT 0 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); insert into public.mission_photos (mission_id,etape,chemin) values ('bbbbbbbb-0000-0000-0000-0000000000c1','avant','missions/bbbbbbbb-0000-0000-0000-0000000000c1/avant-1.jpg'); commit;\"" 2>&1 | grep -E '^INSERT')"
check "Y10 : et il la relit" "1" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.mission_photos; commit;" | tail -1)"
check "Y11 : un AUTRE partenaire ne voit AUCUNE de ces photos" "0" \
  "$(sql "begin; select public.devenir('44444444-4444-4444-4444-444444444444','ancien@helixcar.test'); select count(*) from public.mission_photos; commit;" | tail -1)"
check "Y12 : et ne peut pas en déposer sur cette mission" "refuse" \
  "$(sql "begin; select public.devenir('44444444-4444-4444-4444-444444444444','ancien@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000c1','apres','missions/bbbbbbbb-0000-0000-0000-0000000000c1/pirate.jpg'); commit;" \
   | grep -qiE 'row-level security|error' && echo refuse || echo passe)"
check "Y13 : un visiteur anonyme ne voit RIEN" "0" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.mission_photos; commit;" | tail -1)"
check "Y14 : une étape inventée est refusée" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000c1','pendant','missions/x/y.jpg'); commit;" \
   | grep -qiE 'violates check constraint|error' && echo refuse || echo passe)"
check "Y15 : un partenaire ne peut PAS supprimer une photo déjà déposée" "DELETE 0" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); delete from public.mission_photos; commit;\"" 2>&1 | grep -E '^DELETE')"
check "Y16 : l'administrateur les voit toutes" "1" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test'); select count(*) from public.mission_photos; commit;" | tail -1)"

# Un partenaire BLOQUÉ perd l'accès, ici comme ailleurs.
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.convoyeurs set bloque=true where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" >/dev/null
check "Y17 : un partenaire BLOQUÉ ne voit plus les photos de sa mission" "0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); select count(*) from public.mission_photos; commit;" | tail -1)"
check "Y18 : et ne peut plus en déposer" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000c1','apres','missions/bbbbbbbb-0000-0000-0000-0000000000c1/apres-1.jpg'); commit;" \
   | grep -qiE 'row-level security|error' && echo refuse || echo passe)"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.convoyeurs set bloque=false where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" >/dev/null

# Le bucket des photos.
check "Y19 : le bucket des photos est PRIVÉ" "f" \
  "$(sql "select public from storage.buckets where id='missions-photos';")"
check "Y20 : il n'accepte que des images" "3" \
  "$(sql "select array_length(allowed_mime_types,1) from storage.buckets where id='missions-photos';")"
check "Y21 : le partenaire dépose un fichier dans le dossier de SA mission" "INSERT 0 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); insert into storage.objects (bucket_id,name) values ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000c1/avant-1.jpg'); commit;\"" 2>&1 | grep -E '^INSERT')"
check "Y22 : mais PAS dans le dossier d'une autre mission" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into storage.objects (bucket_id,name)
     values ('missions-photos','missions/bbbbbbbb-0000-0000-0000-000000000002/pirate.jpg'); commit;" \
   | grep -qiE 'row-level security|error' && echo refuse || echo passe)"
check "Y23 : un visiteur anonyme ne lit AUCUN fichier de ce bucket" "0" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from storage.objects where bucket_id='missions-photos'; commit;" | tail -1)"
check "Y24 : aucune politique de ce bucket n'est accordée à anon" "0" \
  "$(sql "select count(*) from pg_policies where tablename='objects' and policyname like 'photos mission%' and 'anon' = any(roles);")"


echo
echo "── Z. CE QU'UN PARTENAIRE PEUT VRAIMENT CHANGER SUR UNE MISSION ──"
# On n'appuie sur aucun bouton : on écrit DIRECTEMENT en base, comme le
# ferait un PATCH sur l'API REST avec le jeton de session du partenaire.
# C'est le seul niveau où la question se pose.

# REPRODUCTION, avant la migration 97 : la policy de 90 laisse passer.
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 insert into public.missions (id,reference,statut,type_mission,client_id,prix_ttc,convoyeur_id)
   values ('bbbbbbbb-0000-0000-0000-0000000000d1','TEST-QA-Z1','acceptee','convoyage',
           'dddddddd-0000-0000-0000-0000000000a1',500,'aaaaaaaa-0000-0000-0000-000000000001')
   on conflict do nothing;
 insert into public.missions (id,reference,statut,type_mission,prix_ttc)
   values ('bbbbbbbb-0000-0000-0000-0000000000d2','TEST-QA-Z2','en_attente','convoyage',600)
   on conflict do nothing;
 commit;" >/dev/null

check "Z1 : REPRODUCTION — le partenaire peut changer le PRIX de sa mission" "500|900" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set prix_ttc=900 where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select '500|'||prix_ttc::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z2 : REPRODUCTION — il peut aussi se déclarer « terminee » tout seul" "terminee" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='terminee' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"

# Remise en état, puis application du verrou.
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.missions set prix_ttc=500, statut='acceptee'
  where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;" >/dev/null

errZ=$(appliquer migrations/97_missions_verrou_serveur.sql)
check "Z3 : migrations/97 s'applique sans erreur" "" "$errZ"

# ── Colonnes administratives ──
check "Z4 : le prix devient intouchable pour le partenaire" "500" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set prix_ttc=900 where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select prix_ttc::int from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z5 : ... et le refus est explicite, pas silencieux" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set prix_ttc=900 where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;" \
   | grep -qiE 'réservé à HelixCar' && echo refuse || echo passe)"
check "Z6 : il ne peut pas rattacher la mission à un autre client" "dddddddd-0000-0000-0000-0000000000a1" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set client_id='cccccccc-0000-0000-0000-00000000000A'
    where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select client_id::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z7 : il ne peut pas cocher la validation de paiement" "false" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set validee_paiement=true where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select coalesce(validee_paiement,false)::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z8 : il ne peut pas se fixer sa propre rémunération" "" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set remuneration_convoyeur=9999 where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select remuneration_convoyeur::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z9 : une colonne administrative FUTURE lui est fermée d'office" "" \
  "$(sql "alter table public.missions add column if not exists prime_exceptionnelle numeric;
   begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set prime_exceptionnelle=500 where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select prime_exceptionnelle::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"

# ── Transitions de statut ──
check "Z10 : « terminee » lui est refusé" "acceptee" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='terminee' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z11 : « annulee » aussi" "acceptee" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='annulee' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z12 : mais la transition légitime acceptee -> en_cours passe" "en_cours" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='en_cours' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z13 : et en_cours -> fini aussi" "fini" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='fini' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
check "Z14 : un saut de statut inventé est refusé" "fini" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='en_attente' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"

# ── Attribution ──
check "Z15 : il PREND bien une mission libre" "aaaaaaaa-0000-0000-0000-000000000001" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001', statut='acceptee'
    where id='bbbbbbbb-0000-0000-0000-0000000000d2'; commit;
   select convoyeur_id::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d2';" | tail -1)"
check "Z16 : il ne peut PAS l'attribuer à quelqu'un d'autre" "refuse" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   update public.missions set convoyeur_id=null, statut='en_attente' where id='bbbbbbbb-0000-0000-0000-0000000000d2'; commit;
   begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set convoyeur_id='aaaaaaaa-0000-0000-0000-000000000002'
    where id='bbbbbbbb-0000-0000-0000-0000000000d2'; commit;" \
   | grep -qiE 'attribuée qu.à soi-même|insufficient' && echo refuse || echo passe)"
# Ici, la mission appartient déjà à un collègue : la policy de 90 la
# rend INVISIBLE en écriture, donc l'UPDATE ne touche aucune ligne et
# PostgreSQL ne lève pas d'erreur. Ce qui compte n'est pas le message,
# c'est que la mission n'ait pas changé de mains.
check "Z17 : il ne peut pas s'arracher la mission d'un collègue" "aaaaaaaa-0000-0000-0000-000000000002" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   update public.missions set convoyeur_id='aaaaaaaa-0000-0000-0000-000000000002', statut='acceptee'
    where id='bbbbbbbb-0000-0000-0000-0000000000d2'; commit;
   begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001'
    where id='bbbbbbbb-0000-0000-0000-0000000000d2'; commit;
   select convoyeur_id::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d2';" | tail -1)"
check "Z17b : ... et l'écriture ne touche RIEN plutôt que de réussir à moitié" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.missions set convoyeur_id='aaaaaaaa-0000-0000-0000-000000000001' where id='bbbbbbbb-0000-0000-0000-0000000000d2'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "Z18 : la création d'une mission lui est interdite" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.missions (reference,statut,prix_ttc,convoyeur_id)
     values ('TEST-QA-Z-PIRATE','acceptee',9999,'aaaaaaaa-0000-0000-0000-000000000001'); commit;" \
   | grep -qiE 'réservée à HelixCar|insufficient|row-level' && echo refuse || echo passe)"

# ── Photos : la preuve se vérifie en base, pas à l'œil ──
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 insert into public.missions (id,reference,statut,type_mission,convoyeur_id,prix_ttc)
   values ('bbbbbbbb-0000-0000-0000-0000000000d3','TEST-QA-Z3','acceptee','nettoyage',
           'aaaaaaaa-0000-0000-0000-000000000001',300) on conflict do nothing; commit;" >/dev/null
check "Z19 : un nettoyage SANS photo ne peut pas être déclaré fini" "acceptee" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='fini' where id='bbbbbbbb-0000-0000-0000-0000000000d3'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"

# ── Z bis. UNE PHOTO SANS FICHIER N'EST PAS UNE PREUVE ──
#
# REPRODUCTION du defaut, AVANT la migration 98 : la ligne suffisait.
# Les anciens controles Z20 et Z21 inseraient justement des metadonnees
# sans jamais creer l'objet Storage, puis concluaient que la mission
# etait justifiee. Ils validaient le defaut qu'ils devaient interdire.
sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
 insert into public.mission_photos (mission_id,etape,chemin) values
   ('bbbbbbbb-0000-0000-0000-0000000000d3','avant','missions/bbbbbbbb-0000-0000-0000-0000000000d3/fantome-avant.jpg'),
   ('bbbbbbbb-0000-0000-0000-0000000000d3','apres','missions/bbbbbbbb-0000-0000-0000-0000000000d3/fantome-apres.jpg');
 commit;" >/dev/null
check "Z20 : REPRODUCTION — deux photos SANS FICHIER suffisaient a finir" "fini" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='fini' where id='bbbbbbbb-0000-0000-0000-0000000000d3'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"
# Le partenaire attribue sa photo a l'ADMINISTRATEUR : l'appelant
# choisissait librement qui etait cense l'avoir deposee.
check "Z21 : REPRODUCTION — et l'appelant choisissait qui les avait deposees" "11111111-1111-1111-1111-111111111111" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin,ajoutee_par) values
     ('bbbbbbbb-0000-0000-0000-0000000000d3','avant','missions/bbbbbbbb-0000-0000-0000-0000000000d3/faux-auteur.jpg',
      '11111111-1111-1111-1111-111111111111'); commit;
   select ajoutee_par::text from public.mission_photos
    where chemin='missions/bbbbbbbb-0000-0000-0000-0000000000d3/faux-auteur.jpg';" | tail -1)"

# Remise a zero, puis application du verrou.
sql "delete from public.mission_photos where mission_id='bbbbbbbb-0000-0000-0000-0000000000d3';
 update public.missions set statut='acceptee' where id='bbbbbbbb-0000-0000-0000-0000000000d3';" >/dev/null

errP=$(appliquer migrations/98_photos_justificatives_reelles.sql)
check "Z21b : migrations/98 s'applique sans erreur" "" "$errP"

check "Z21c : un chemin SANS FICHIER est desormais refuse" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000d3','avant',
             'missions/bbbbbbbb-0000-0000-0000-0000000000d3/inexistant.jpg'); commit;" \
   | grep -qiE 'Aucun fichier ne correspond' && echo refuse || echo passe)"
check "Z21d : et rien n'a ete ecrit" "0" \
  "$(sql "select count(*) from public.mission_photos where mission_id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"

# Le fichier d'une AUTRE mission ne justifie pas celle-ci.
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 insert into storage.objects (bucket_id,name)
   values ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000c1/avant-autre.jpg')
   on conflict do nothing; commit;" >/dev/null
check "Z21e : un chemin appartenant a une AUTRE mission est refuse" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000d3','avant',
             'missions/bbbbbbbb-0000-0000-0000-0000000000c1/avant-autre.jpg'); commit;" \
   | grep -qiE 'hors de la mission' && echo refuse || echo passe)"

# Le bon chemin, mais dans le mauvais bucket.
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 insert into storage.objects (bucket_id,name)
   values ('candidatures-videos','missions/bbbbbbbb-0000-0000-0000-0000000000d3/mauvais-bucket.jpg')
   on conflict do nothing; commit;" >/dev/null
check "Z21f : un fichier du MAUVAIS BUCKET ne compte pas" "refuse" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000d3','avant',
             'missions/bbbbbbbb-0000-0000-0000-0000000000d3/mauvais-bucket.jpg'); commit;" \
   | grep -qiE 'Aucun fichier ne correspond' && echo refuse || echo passe)"

# LE PARCOURS LEGITIME : le fichier est envoye, PUIS sa trace ecrite.
sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
 insert into storage.objects (bucket_id,name) values
   ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000d3/avant-1.jpg'); commit;" >/dev/null
check "Z22a : le depot legitime de la photo AVANT est accepte" "1" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000d3','avant',
             'missions/bbbbbbbb-0000-0000-0000-0000000000d3/avant-1.jpg'); commit;
   select count(*) from public.mission_photos where mission_id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"
check "Z22b : ajoutee_par est impose par le serveur, pas par l'appelant" "22222222-2222-2222-2222-222222222222" \
  "$(sql "select ajoutee_par::text from public.mission_photos
    where chemin='missions/bbbbbbbb-0000-0000-0000-0000000000d3/avant-1.jpg';" | tail -1)"
check "Z22c : avec la seule photo AVANT, la mission ne peut pas finir" "acceptee" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='fini' where id='bbbbbbbb-0000-0000-0000-0000000000d3'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"
sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
 insert into storage.objects (bucket_id,name) values
   ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000d3/apres-1.jpg');
 insert into public.mission_photos (mission_id,etape,chemin)
   values ('bbbbbbbb-0000-0000-0000-0000000000d3','apres',
           'missions/bbbbbbbb-0000-0000-0000-0000000000d3/apres-1.jpg'); commit;" >/dev/null
check "Z22d : avec DEUX vrais fichiers, la mission peut etre declaree finie" "fini" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   update public.missions set statut='fini' where id='bbbbbbbb-0000-0000-0000-0000000000d3'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"
check "Z22e : si le fichier disparait, la preuve disparait avec lui" "false" \
  "$(sql "delete from storage.objects where name='missions/bbbbbbbb-0000-0000-0000-0000000000d3/apres-1.jpg';
   select public.mission_photos_completes('bbbbbbbb-0000-0000-0000-0000000000d3')::text;" | tail -1)"
sql "insert into storage.objects (bucket_id,name) values
   ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000d3/apres-1.jpg')
   on conflict do nothing;" >/dev/null
check "Z22f : le partenaire ne supprime toujours pas ses justificatifs" "0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   delete from public.mission_photos where mission_id='bbbbbbbb-0000-0000-0000-0000000000d3'; commit;
   select 0; " | tail -1)"
check "Z22g : ... et ses photos sont toujours la" "2" \
  "$(sql "select count(*) from public.mission_photos where mission_id='bbbbbbbb-0000-0000-0000-0000000000d3';" | tail -1)"

# ── L'administrateur, lui, valide — mais sur pièces ──
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 insert into public.missions (id,reference,statut,type_mission,convoyeur_id,prix_ttc)
   values ('bbbbbbbb-0000-0000-0000-0000000000d4','TEST-QA-Z4','fini','nettoyage',
           'aaaaaaaa-0000-0000-0000-000000000001',300) on conflict do nothing; commit;" >/dev/null
check "Z22 : l'ADMINISTRATEUR non plus ne valide pas un nettoyage sans photos" "fini" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   update public.missions set statut='terminee', prestation_validee_le=now()
    where id='bbbbbbbb-0000-0000-0000-0000000000d4'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d4';" | tail -1)"
# Les fichiers sont deposes par le PARTENAIRE, seul a en avoir le droit
# (policy « depot partenaire » de 96), puis leurs traces sont ecrites.
sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
 insert into storage.objects (bucket_id,name) values
   ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000d4/a.jpg'),
   ('missions-photos','missions/bbbbbbbb-0000-0000-0000-0000000000d4/b.jpg');
 insert into public.mission_photos (mission_id,etape,chemin) values
   ('bbbbbbbb-0000-0000-0000-0000000000d4','avant','missions/bbbbbbbb-0000-0000-0000-0000000000d4/a.jpg'),
   ('bbbbbbbb-0000-0000-0000-0000000000d4','apres','missions/bbbbbbbb-0000-0000-0000-0000000000d4/b.jpg');
 commit;" >/dev/null
check "Z23 : avec des photos REELLEMENT deposees, il valide" "terminee" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   update public.missions set statut='terminee', prestation_validee_le=now()
    where id='bbbbbbbb-0000-0000-0000-0000000000d4'; commit;
   select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d4';" | tail -1)"
check "Z23b : l'ADMINISTRATEUR non plus ne justifie pas avec un fichier absent" "refuse" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   insert into public.mission_photos (mission_id,etape,chemin)
     values ('bbbbbbbb-0000-0000-0000-0000000000d4','avant',
             'missions/bbbbbbbb-0000-0000-0000-0000000000d4/fantome.jpg'); commit;" \
   | grep -qiE 'Aucun fichier ne correspond' && echo refuse || echo passe)"
check "Z24 : le validateur est posé PAR LE SERVEUR, jamais déclaré" "11111111-1111-1111-1111-111111111111" \
  "$(sql "select prestation_validee_par::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d4';" | tail -1)"
check "Z25 : un validateur envoyé par l'appelant est écrasé" "11111111-1111-1111-1111-111111111111" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   update public.missions set prestation_validee_le=now(),
     prestation_validee_par='22222222-2222-2222-2222-222222222222'
    where id='bbbbbbbb-0000-0000-0000-0000000000d4'; commit;
   select prestation_validee_par::text from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d4';" | tail -1)"
# Un partenaire bloqué est écarté dès la policy de 90 : l'UPDATE ne voit
# aucune ligne. Là encore, c'est l'effet qui se vérifie, pas le message.
check "Z26 : un partenaire BLOQUÉ ne modifie plus rien du tout" "UPDATE 0" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
   update public.convoyeurs set bloque=true where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" >/dev/null;
   su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test'); update public.missions set statut='en_cours' where id='bbbbbbbb-0000-0000-0000-0000000000d1'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "Z26b : et la mission garde son statut" "fini" \
  "$(sql "select statut from public.missions where id='bbbbbbbb-0000-0000-0000-0000000000d1';" | tail -1)"
sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
 update public.convoyeurs set bloque=false where id='aaaaaaaa-0000-0000-0000-000000000001'; commit;" >/dev/null


echo
echo "── R. RATTACHEMENT APRÈS CONFIRMATION DE L'ADRESSE ──"
# Le parcours REEL, de bout en bout.
#
#   1. signUp() cree l'utilisateur mais NE rend PAS de session, parce que
#      la confirmation d'e-mail est active — le defaut Supabase.
#   2. La demande est donc ecrite ANONYMEMENT : auth_user_id vaut NULL.
#   3. Le client confirme ensuite son adresse et ouvre une session.
#   4. Sa demande apparait-elle dans son espace ?
#
# L'ecran lui promettait que oui. On commence par verifier ce qui se
# passe vraiment.

# Le compte, cree mais PAS ENCORE confirme.
sql "insert into auth.users (id, email, email_confirmed_at) values
  ('99999999-9999-9999-9999-999999999999','tardif@helixcar.test', null)
  on conflict (id) do update set email = excluded.email,
                                 email_confirmed_at = excluded.email_confirmed_at;" >/dev/null

# La demande, deposee sans session — exactement ce que fait le
# navigateur quand signUp ne rend pas de session.
sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000001',
                        'numero_client','TEST-QA-R1','email','tardif@helixcar.test',
                        'prenom','TEST-QA','nom','Tardif','type_service','convoyage'),
     '[]'::jsonb, repeat('r',48)); commit;" >/dev/null

check "R1 : la demande est bien enregistrée — elle n'est jamais perdue" "1" \
  "$(sql "select count(*) from public.clients where id='aaaaaaaa-1111-4111-8111-000000000001';")"
check "R2 : mais elle n'a AUCUN propriétaire" "NULL" \
  "$(sql "select coalesce(auth_user_id::text,'NULL') from public.clients where id='aaaaaaaa-1111-4111-8111-000000000001';")"

# Le client confirme son adresse, puis se connecte.
sql "update auth.users set email_confirmed_at = now()
      where id='99999999-9999-9999-9999-999999999999';" >/dev/null

check "R3 : REPRODUCTION — après confirmation, sa demande reste INVISIBLE" "0" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select count(*) from public.v_mes_demandes; commit;" | tail -1)"
check "R4 : REPRODUCTION — et elle n'a toujours pas de propriétaire" "NULL" \
  "$(sql "select coalesce(auth_user_id::text,'NULL') from public.clients where id='aaaaaaaa-1111-4111-8111-000000000001';")"

errR=$(appliquer migrations/99_reclamation_demande.sql)
check "R5 : migrations/99 s'applique sans erreur" "" "$errR"

# ── Une NOUVELLE demande, deposee apres 99 : la reclamation est armee ──
sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000002',
                        'numero_client','TEST-QA-R2','email','tardif@helixcar.test',
                        'prenom','TEST-QA','nom','Tardif','type_service','convoyage'),
     '[]'::jsonb, repeat('c',48), repeat('k',48)); commit;" >/dev/null

check "R6 : le secret n'est JAMAIS stocké — seule son empreinte l'est" "1|0" \
  "$(sql "select (reclamation_cle_hash is not null)::int||'|'||
                 (reclamation_cle_hash = repeat('k',48))::int
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"
check "R7 : l'empreinte est bien celle du secret de RÉCLAMATION fourni" "1" \
  "$(sql "select (reclamation_cle_hash = public.empreinte_secret('reclamation', repeat('k',48)))::int
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"
check "R7 bis : et surtout PAS celle du secret de création" "0" \
  "$(sql "select (reclamation_cle_hash = public.empreinte_secret('creation', repeat('c',48)))::int
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"
check "R8 : et elle a une date d'expiration" "1" \
  "$(sql "select (reclamation_expire_le > now())::int
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"

# ── LES REFUS ──
# Un visiteur anonyme n'a meme pas le droit d'EXECUTER la fonction : le
# refus arrive avant la premiere ligne de code. C'est plus strict que le
# code SESSION_REQUISE, qui reste le filet pour un role authentifie sans
# session valide.
check "R9 : sans session, on ne réclame rien — refus au niveau du privilège" "refuse" \
  "$(sql "begin; select public.devenir_anon();
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('k',48)); commit;" \
   | grep -qiE 'permission denied|SESSION_REQUISE' && echo refuse || echo passe)"

# Le tiers qui va tenter sa chance est un compte REELLEMENT confirme :
# sans cela, il serait ecarte des l'etape 2 et la suite ne prouverait
# rien sur le secret ni sur l'adresse.
sql "update auth.users set email_confirmed_at = now()
      where id='66666666-6666-6666-6666-666666666666';" >/dev/null

sql "insert into auth.users (id, email, email_confirmed_at) values
  ('88888888-8888-8888-8888-888888888888','tardif@helixcar.test', null)
  on conflict (id) do update set email_confirmed_at = null;" >/dev/null
check "R10 : un compte NON CONFIRMÉ ne réclame rien, même avec le bon secret" "ADRESSE_NON_CONFIRMEE" \
  "$(sql "begin; select public.devenir('88888888-8888-8888-8888-888888888888','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('k',48)) ->> 'code'; commit;" | tail -1)"

check "R11 : le BON secret entre les mains d'un AUTRE compte est refusé" "RECLAMATION_REFUSEE" \
  "$(sql "begin; select public.devenir('66666666-6666-6666-6666-666666666666','clientB@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('k',48)) ->> 'code'; commit;" | tail -1)"
check "R12 : ... et la demande n'a pas changé de mains" "NULL" \
  "$(sql "select coalesce(auth_user_id::text,'NULL') from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"

check "R13 : le BON compte avec un MAUVAIS secret est refusé" "RECLAMATION_REFUSEE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('z',48)) ->> 'code'; commit;" | tail -1)"
check "R14 : un secret trop court est refusé d'emblée" "CLE_INVALIDE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', 'court') ->> 'code'; commit;" | tail -1)"
check "R15 : connaître l'UUID SANS secret ne donne rien" "RECLAMATION_REFUSEE" \
  "$(sql "begin; select public.devenir('66666666-6666-6666-6666-666666666666','clientB@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('x',48)) ->> 'code'; commit;" | tail -1)"

# Bon secret, bon compte confirme — mais l'adresse de la demande differe.
sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000003',
                        'numero_client','TEST-QA-R3','email','quelquun.dautre@helixcar.test',
                        'type_service','convoyage'),
     '[]'::jsonb, repeat('n',48), repeat('m',48)); commit;" >/dev/null
check "R16 : bon secret mais adresse de la demande DIFFÉRENTE — refusé" "RECLAMATION_REFUSEE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000003', repeat('m',48)) ->> 'code'; commit;" | tail -1)"
check "R17 : ... et cette demande-là non plus n'a pas bougé" "NULL" \
  "$(sql "select coalesce(auth_user_id::text,'NULL') from public.clients where id='aaaaaaaa-1111-4111-8111-000000000003';")"

# Secret expire.
sql "update public.clients set reclamation_expire_le = now() - interval '1 day'
      where id='aaaaaaaa-1111-4111-8111-000000000003';" >/dev/null
check "R18 : un secret EXPIRÉ ne vaut plus rien" "RECLAMATION_EXPIREE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000003', repeat('m',48)) ->> 'code'; commit;" | tail -1)"

# ── LE PARCOURS LEGITIME ──
check "R19 : le bon compte, confirmé, avec le bon secret : la demande est rattachée" "RATTACHEE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('k',48)) ->> 'code'; commit;" | tail -1)"
check "R20 : elle appartient désormais au compte" "99999999-9999-9999-9999-999999999999" \
  "$(sql "select auth_user_id::text from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"
check "R21 : et elle est ENFIN visible dans son espace client" "TEST-QA-R2" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select numero_client from public.v_mes_demandes
    where id='aaaaaaaa-1111-4111-8111-000000000002'; commit;" | tail -1)"
check "R22 : le secret est CONSOMMÉ — l'empreinte est effacée" "NULL|NULL" \
  "$(sql "select coalesce(reclamation_cle_hash,'NULL')||'|'||coalesce(reclamation_expire_le::text,'NULL')
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"
check "R23 : le rejeu par le MÊME compte est idempotent, jamais une erreur" "DEJA_RATTACHEE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('k',48)) ->> 'code'; commit;" | tail -1)"
check "R24 : le rejeu du secret par un TIERS est refusé" "RECLAMATION_REFUSEE" \
  "$(sql "begin; select public.devenir('66666666-6666-6666-6666-666666666666','clientB@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000002', repeat('k',48)) ->> 'code'; commit;" | tail -1)"
check "R25 : ... et le propriétaire n'a pas changé" "99999999-9999-9999-9999-999999999999" \
  "$(sql "select auth_user_id::text from public.clients where id='aaaaaaaa-1111-4111-8111-000000000002';")"

# ── AUCUN RATTACHEMENT PAR SIMPLE CORRESPONDANCE D'E-MAIL ──
check "R26 : la demande ANCIENNE, de même adresse, n'a PAS suivi" "NULL" \
  "$(sql "select coalesce(auth_user_id::text,'NULL') from public.clients where id='aaaaaaaa-1111-4111-8111-000000000001';")"
check "R27 : elle reste invisible dans l'espace du client" "0" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select count(*) from public.v_mes_demandes where id='aaaaaaaa-1111-4111-8111-000000000001'; commit;" | tail -1)"
check "R28 : son espace ne contient QUE ce qu'il a réellement réclamé" "1" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select count(*) from public.v_mes_demandes; commit;" | tail -1)"

# ── LE DROIT D'EXECUTION ──
check "R29 : réclamer n'est PAS accordé à un visiteur anonyme" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='reclamer_demande' and grantee='anon';")"
check "R30 : armer_reclamation n'est appelable par personne de l'extérieur" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='armer_reclamation' and grantee in ('anon','authenticated');")"


echo
echo "── R bis. LE SECRET DE RÉCLAMATION NE DOIT RIEN OUVRIR D'AUTRE ──"
# Un audit a montré que la première version se contentait d'un SEUL
# secret : celui de création servait aussi de secret de réclamation, et
# le navigateur le gardait trente jours. Or ce secret-là est une PREUVE
# DE REJEU pour creer_demande_avec_vehicules(). Le conserver revenait à
# laisser sur l'appareil, sans aucune session, de quoi rejouer la
# création, en relire le numéro client, et greffer des véhicules sur une
# demande qui n'en avait pas.
#
# La séparation est maintenant STRUCTURELLE : chaque empreinte est
# préfixée par son usage. Ce n'est pas une question de probabilité.

check "R31 : la même chaîne ne produit PAS la même empreinte selon l'usage" "1" \
  "$(sql "select (public.empreinte_secret('creation', repeat('K',48))
                <> public.empreinte_secret('reclamation', repeat('K',48)))::int;")"

# Une demande anonyme toute neuve, sans véhicule, avec DEUX secrets.
sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000004',
                        'numero_client','TEST-QA-R4','email','tardif@helixcar.test',
                        'prenom','TEST-QA','nom','Separation','type_service','convoyage'),
     '[]'::jsonb, repeat('C',48), repeat('K',48)); commit;" >/dev/null

check "R32 : la demande part sans aucun véhicule" "0" \
  "$(sql "select count(*) from public.vehicules where dossier_id='aaaaaaaa-1111-4111-8111-000000000004';")"
check "R33 : seule l'empreinte de RÉCLAMATION correspond au secret gardé" "1|0" \
  "$(sql "select (reclamation_cle_hash = public.empreinte_secret('reclamation', repeat('K',48)))::int
              ||'|'||
                 (creation_cle_hash    = public.empreinte_secret('creation',    repeat('K',48)))::int
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000004';")"

# ── L'ATTAQUE : le secret gardé par le navigateur, présenté comme
#    secret de création, par un visiteur SANS session. ──
ATTAQUE=$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000004',
                        'numero_client','TEST-QA-VOL','email','voleur@helixcar.test'),
     jsonb_build_array(jsonb_build_object('position',1,'marque_modele','TEST-QA-GREFFE')),
     repeat('K',48)); commit;" | tail -1)

check "R34 : le secret de réclamation ne REJOUE PAS la création" "0" \
  "$(echo "$ATTAQUE" | grep -c 'aaaaaaaa-1111-4111-8111-000000000004')"
check "R35 : ... il ne livre donc pas le numéro client visé" "0" \
  "$(echo "$ATTAQUE" | grep -c 'TEST-QA-R4')"
check "R36 : ... et il n'a greffé AUCUN véhicule sur la demande visée" "0" \
  "$(sql "select count(*) from public.vehicules where dossier_id='aaaaaaaa-1111-4111-8111-000000000004';")"
check "R37 : ... la demande visée n'a pas bougé d'un pouce" "TEST-QA-R4|NULL" \
  "$(sql "select numero_client||'|'||coalesce(auth_user_id::text,'NULL')
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000004';")"
check "R38 : ... et il ne réclame rien non plus par la mauvaise porte" "RECLAMATION_REFUSEE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000004', repeat('C',48)) ->> 'code'; commit;" | tail -1)"

# ── NON-RÉGRESSION : le VRAI secret de création, lui, rejoue bien ──
LEGITIME=$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000004',
                        'numero_client','TEST-QA-R4','email','tardif@helixcar.test'),
     '[]'::jsonb, repeat('C',48)); commit;" | tail -1)
check "R39 : le VRAI secret de création rejoue toujours, lui" "1" \
  "$(echo "$LEGITIME" | grep -c 'aaaaaaaa-1111-4111-8111-000000000004')"
check "R40 : et le serveur le dit : demande déjà existante" "1" \
  "$(echo "$LEGITIME" | grep -c '"deja_existante" *: *true')"

# ── APRÈS RATTACHEMENT : plus aucune empreinte ne subsiste ──
check "R41 : le rattachement légitime aboutit" "RATTACHEE" \
  "$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.reclamer_demande('aaaaaaaa-1111-4111-8111-000000000004', repeat('K',48)) ->> 'code'; commit;" | tail -1)"
check "R42 : les DEUX empreintes sont effacées, pas seulement celle de réclamation" "NULL|NULL" \
  "$(sql "select coalesce(reclamation_cle_hash,'NULL')||'|'||coalesce(creation_cle_hash,'NULL')
            from public.clients where id='aaaaaaaa-1111-4111-8111-000000000004';")"
APRES=$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000004',
                        'numero_client','TEST-QA-APRES','email','voleur@helixcar.test'),
     '[]'::jsonb, repeat('C',48)); commit;" | tail -1)
check "R43 : l'ancien secret de création ne rejoue plus rien" "0" \
  "$(echo "$APRES" | grep -c 'aaaaaaaa-1111-4111-8111-000000000004')"
PROPRIO=$(sql "begin; select public.devenir('99999999-9999-9999-9999-999999999999','tardif@helixcar.test');
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','aaaaaaaa-1111-4111-8111-000000000004',
                        'numero_client','TEST-QA-R4','email','tardif@helixcar.test'),
     '[]'::jsonb); commit;" | tail -1)
check "R44 : mais le PROPRIÉTAIRE, lui, reprend toujours sa demande" "1" \
  "$(echo "$PROPRIO" | grep -c 'aaaaaaaa-1111-4111-8111-000000000004')"

# ── UNE SEULE SIGNATURE : sans quoi PostgREST refuserait de choisir ──
check "R45 : creer_demande_avec_vehicules n'existe qu'en UNE signature" "1" \
  "$(sql "select count(*) from pg_proc where proname='creer_demande_avec_vehicules';")"
check "R46 : et elle prend bien quatre arguments" "4" \
  "$(sql "select pronargs from pg_proc where proname='creer_demande_avec_vehicules';")"
check "R47 : empreinte_secret n'est offerte à personne de l'extérieur" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='empreinte_secret' and grantee in ('anon','authenticated');")"


echo
echo "── S. LES ACTIVITÉS QUE LE FORMULAIRE PROPOSE RÉELLEMENT ──"
# La migration 95 a ajouté l'activité 'technicien' et trois métiers qui
# la portent (mécanique, carrosserie, diagnostic). Elle a élargi la
# contrainte de convoyeur_decisions.activite — mais PAS celle de
# convoyeurs.activites, qui existe en production depuis bien avant ce
# dépôt et n'apparaît dans aucun fichier de migrations/.
#
# Résultat en production : plus AUCUNE candidature de technicien ne
# passe. Le socle de tests ne reproduisait pas cette contrainte : il la
# déclare désormais, et voici ce qu'elle fait AVANT le correctif.

# On remet un instant la contrainte telle qu'elle est en production
# AVANT le correctif, pour montrer le refus sur pièce, puis on
# réapplique la migration 100 — qui est idempotente.
# NOT VALID : la contrainte ne contrôle que les NOUVELLES lignes. Sans
# cela, elle refuserait de se poser — une candidature de technicien a
# déjà été enregistrée en section X. C'est exactement le comportement
# d'une contrainte posée en production avant l'apparition du technicien.
sql "alter table public.convoyeurs drop constraint if exists convoyeurs_activites_valides;
 alter table public.convoyeurs add constraint convoyeurs_activites_valides
   check (activites is null or activites <@ array['convoyage','nettoyage','renfort']::text[])
   not valid;" >/dev/null

check "S1 : REPRODUCTION — une candidature de technicien est refusée (23514)" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites, metiers)
     values ('TEST-QA-CLAUDE-POSTPR2','tech1@helixcar.test',
             array['technicien'], array['mecanique']);" \
   | grep -qiE '23514|violates check constraint' && echo refuse || echo passe)"
check "S2 : REPRODUCTION — et rien n'a été enregistré" "0" \
  "$(sql "select count(*) from public.convoyeurs where email='tech1@helixcar.test';")"

errS=$(appliquer migrations/100_activites_partenaire.sql)
check "S3 : migrations/100 se rejoue sans erreur et rétablit la nomenclature" "" "$errS"

check "S4 : la source de vérité énumère EXACTEMENT quatre activités" "convoyage|nettoyage|renfort|technicien" \
  "$(sql "select array_to_string(public.activites_partenaire(), '|');")"

# ── CHAQUE ACTIVITÉ SEULE ──
for a in convoyage nettoyage renfort technicien; do
  sql "delete from public.convoyeurs where email='seule-$a@helixcar.test';" >/dev/null
  check "S5.$a : l'activité « $a » seule est acceptée" "1" \
    "$(sql "insert into public.convoyeurs (prenom, email, activites)
       values ('TEST-QA-CLAUDE-POSTPR2','seule-$a@helixcar.test', array['$a']);
       select count(*) from public.convoyeurs where email='seule-$a@helixcar.test';" | tail -1)"
done

# ── TOUTES LES COMBINAISONS AUTORISÉES ──
# 15 sous-ensembles non vides de 4 activités : aucun ne doit être refusé.
NB_OK=$(sql "with a as (select unnest(public.activites_partenaire()) v),
 combi as (
   select array_agg(v order by v) c
     from (select v, generate_series(1,15) g from a) x
    where (g >> (case v when 'convoyage' then 0 when 'nettoyage' then 1
                        when 'renfort' then 2 else 3 end)) & 1 = 1
    group by g)
 select count(*) from combi where c <@ public.activites_partenaire();")
check "S6 : les 15 combinaisons non vides sont toutes acceptables" "15" "$NB_OK"

# ── CE QUI DOIT RESTER REFUSÉ ──
check "S7 : une valeur INCONNUE est refusée" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites)
     values ('TEST-QA-CLAUDE-POSTPR2','inconnue@helixcar.test', array['livraison_drone']);" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"
check "S8 : une ANCIENNE valeur hors nomenclature est refusée" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites)
     values ('TEST-QA-CLAUDE-POSTPR2','ancienne@helixcar.test', array['jockey']);" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"
check "S9 : un tableau VIDE est refusé — il ne dit rien du candidat" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites)
     values ('TEST-QA-CLAUDE-POSTPR2','vide@helixcar.test', array[]::text[]);" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"
check "S10 : une valeur FORGÉE est refusée" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites)
     values ('TEST-QA-CLAUDE-POSTPR2','forge@helixcar.test',
             array['convoyage'',''admin']);" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"
check "S11 : une valeur valide MÉLANGÉE à une inconnue est refusée en bloc" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites)
     values ('TEST-QA-CLAUDE-POSTPR2','melange@helixcar.test',
             array['convoyage','livraison_drone']);" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"
check "S12 : NULL reste accepté — les candidatures antérieures restent valides" "1" \
  "$(sql "insert into public.convoyeurs (prenom, email) values
     ('TEST-QA-CLAUDE-POSTPR2','ancienne-nulle@helixcar.test');
     select count(*) from public.convoyeurs where email='ancienne-nulle@helixcar.test';" | tail -1)"

# ── LA CANDIDATURE QUI ÉCHOUAIT PASSE MAINTENANT ──
check "S13 : la candidature de technicien est ENFIN enregistrée" "1" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites, metiers)
     values ('TEST-QA-CLAUDE-POSTPR2','tech1@helixcar.test',
             array['technicien'], array['mecanique']);
     select count(*) from public.convoyeurs where email='tech1@helixcar.test';" | tail -1)"
check "S14 : les trois activités visibles à l'écran passent ensemble" "1" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites, metiers)
     values ('TEST-QA-CLAUDE-POSTPR2','trois@helixcar.test',
             array['convoyage','nettoyage','renfort'],
             array['convoyage','nettoyage','jockey']);
     select count(*) from public.convoyeurs where email='trois@helixcar.test';" | tail -1)"

# ── LES MÉTIERS AUSSI SONT ÉNUMÉRÉS ──
check "S15 : un métier INVENTÉ est refusé" "refuse" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites, metiers)
     values ('TEST-QA-CLAUDE-POSTPR2','metier-faux@helixcar.test',
             array['renfort'], array['pilote_essai']);" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"
check "S16 : les huit métiers du formulaire sont tous acceptés" "1" \
  "$(sql "insert into public.convoyeurs (prenom, email, activites, metiers)
     values ('TEST-QA-CLAUDE-POSTPR2','metiers-tous@helixcar.test',
             public.activites_partenaire(), public.metiers_partenaire());
     select count(*) from public.convoyeurs where email='metiers-tous@helixcar.test';" | tail -1)"

# ── LES DEUX CONTRAINTES S'ACCORDENT ENFIN ──
check "S17 : convoyeur_decisions accepte les mêmes quatre activités" "4" \
  "$(sql "select count(*) from unnest(public.activites_partenaire()) a
     where pg_get_constraintdef(
             (select oid from pg_constraint
               where conrelid='public.convoyeur_decisions'::regclass
                 and conname='convoyeur_decisions_activite_check')) like '%'||a||'%';")"
check "S18 : une décision sur une activité inconnue reste refusée" "refuse" \
  "$(sql "insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
     select id, 'livraison_drone', 'en_attente' from public.convoyeurs
      where email='tech1@helixcar.test';" \
   | grep -qiE 'violates check constraint' && echo refuse || echo passe)"

# MÉNAGE. Les candidatures d'essai sont préfixées TEST-QA-CLAUDE-POSTPR2
# et retirées ici : sans cela, le rejeu de 95 en section F leur créerait
# des décisions et fausserait l'invariant d'idempotence.
sql "delete from public.convoyeur_decisions where convoyeur_id in
      (select id from public.convoyeurs where prenom='TEST-QA-CLAUDE-POSTPR2');
     delete from public.convoyeurs where prenom='TEST-QA-CLAUDE-POSTPR2';" >/dev/null
check "S19 : les candidatures d'essai sont retirées, la base reste propre" "0" \
  "$(sql "select count(*) from public.convoyeurs where prenom='TEST-QA-CLAUDE-POSTPR2';")"

echo
echo "── T. LES INFORMATIONS DE MISSION NE DOIVENT PLUS TOMBER SUR UN TYPE ──"
# Le Dashboard affichait, sur un dossier réel :
#   Informations indisponibles : COALESCE types date and text cannot be matched
#
# informations_demande() rassemblait la date portée par le VÉHICULE et,
# à défaut, celle portée par la DEMANDE quand le trajet est commun.
# COALESCE exige un type commun ; ces deux colonnes n'en ont pas le même
# en production. PostgreSQL refuse alors la requête ENTIÈRE : plus une
# seule rubrique ne s'affiche, pour aucun véhicule.
#
# Le socle déclarait les deux colonnes en `date` et ne pouvait donc pas
# voir le défaut. On reproduit ici la divergence réelle.

# Un dossier de convoyage à trajet COMMUN, avec un véhicule : c'est la
# combinaison qui atteint l'expression fautive.
sql "insert into public.clients
      (id, numero_client, email, type_service, trajet_commun,
       adresse_depart_rue, ville_depart, adresse_arrivee_rue, ville_arrivee,
       date_prise_en_charge, statut)
     values ('eeeeeeee-0000-0000-0000-00000000f0f1','TEST-QA-CLAUDE-POSTPR2-T1',
             'typet@helixcar.test','convoyage', true,
             '1 rue du Test','Lyon','2 rue de la Recette','Nice',
             '2026-10-01','nouveau')
     on conflict (id) do nothing;
     insert into public.vehicules (dossier_id, position, marque_modele)
     values ('eeeeeeee-0000-0000-0000-00000000f0f1', 1, 'TEST-QA Peugeot')
     on conflict do nothing;" >/dev/null

check "T0 : le dossier d'essai est en place, avec son véhicule" "1|1" \
  "$(sql "select (select count(*) from public.clients where id='eeeeeeee-0000-0000-0000-00000000f0f1')
              ||'|'||
                 (select count(*) from public.vehicules where dossier_id='eeeeeeee-0000-0000-0000-00000000f0f1');")"

# La divergence de types, telle qu'elle existe en production. C'est la
# colonne du VÉHICULE qui est déplacée ici : celle de la demande est
# citée par la vue v_mes_demandes et ne peut pas changer de type sans
# la reconstruire. Le conflit produit est le même, et le message aussi —
# seul l'ordre des deux types cités par PostgreSQL diffère.
sql "alter table public.vehicules alter column date_prise_en_charge type text;" >/dev/null
check "T0 bis : les deux colonnes ont bien des types différents" "date|text" \
  "$(sql "select (select data_type from information_schema.columns
                   where table_schema='public' and table_name='clients'
                     and column_name='date_prise_en_charge')
              ||'|'||
                 (select data_type from information_schema.columns
                   where table_schema='public' and table_name='vehicules'
                     and column_name='date_prise_en_charge');")"

check "T1 : REPRODUCTION — la lecture échoue sur le conflit de types" "42804" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f1');" \
   | grep -qiE 'COALESCE types .* cannot be matched' && echo 42804 || echo passe)"
check "T2 : REPRODUCTION — et AUCUNE rubrique ne remonte" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f1');" \
   | grep -cE '^[0-9]+$')"

errT=$(appliquer migrations/101_informations_types_coherents.sql)
check "T3 : migrations/101 s'applique sans erreur" "" "$errT"

check "T4 : les informations reviennent, malgré les deux types différents" "oui" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f1');" \
   | grep -qE '^[1-9][0-9]*$' && echo oui || echo non)"
check "T5 : plus aucun message SQL dans la réponse" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f1');" \
   | grep -ciE 'ERROR|COALESCE' || true)"
check "T6 : la date portée par la DEMANDE compte bien pour le véhicule" "fournie" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f1')
      where cle like 'vehicule\\_%\\_date_prise_en_charge';" | tail -1)"
check "T7 : et une donnée réellement absente reste attendue" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f1')
      where cle like 'vehicule\\_%\\_immatriculation';" | tail -1)"

# ── LES RÈGLES MÉTIER, VÉHICULE PAR VÉHICULE ──
# Une adresse de prise en charge ne se demande QUE si HelixCar vient
# chercher le véhicule ; une adresse de livraison QUE si HelixCar le
# rapporte. Un dépôt ou une récupération par le client ne doit rien
# réclamer du tout.
sql "insert into public.clients
      (id, numero_client, email, type_service, trajet_commun,
       stockage_acheminement, stockage_sortie, stockage_ville, stockage_date_debut, statut)
     values ('eeeeeeee-0000-0000-0000-00000000f0f2','TEST-QA-CLAUDE-POSTPR2-T2',
             'typet2@helixcar.test','stockage', false,
             'client','client','Lyon','2026-10-01','nouveau')
     on conflict (id) do nothing;
     insert into public.vehicules (dossier_id, position, marque_modele)
     values ('eeeeeeee-0000-0000-0000-00000000f0f2', 1, 'TEST-QA Clio')
     on conflict do nothing;" >/dev/null

check "T8 : dépôt par le client — AUCUNE adresse de prise en charge demandée" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f2')
      where cle like '%adresse_depart%';" | tail -1)"
check "T9 : récupération par le client — AUCUNE adresse de livraison demandée" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f2')
      where cle like '%adresse_arrivee%';" | tail -1)"
check "T10 : ni contact de prise en charge, ni contact de livraison" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f2')
      where cle like '%contact_pc%' or cle like '%contact_liv%';" | tail -1)"
check "T11 : mais la prestation de stockage, elle, reste demandée" "oui" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f2')
      where cle like 'stockage%';" | grep -qE '^[1-9]' && echo oui || echo non)"

# Stockage avec acheminement ET sortie HelixCar : là, tout se demande.
sql "insert into public.clients
      (id, numero_client, email, type_service, trajet_commun,
       stockage_acheminement, stockage_sortie, stockage_ville, stockage_date_debut, statut)
     values ('eeeeeeee-0000-0000-0000-00000000f0f3','TEST-QA-CLAUDE-POSTPR2-T3',
             'typet3@helixcar.test','stockage', false,
             'helixcar','helixcar','Lyon','2026-10-01','nouveau')
     on conflict (id) do nothing;
     insert into public.vehicules (dossier_id, position, marque_modele, livraison_apres_stockage)
     values ('eeeeeeee-0000-0000-0000-00000000f0f3', 1, 'TEST-QA Golf', true)
     on conflict do nothing;
     insert into public.vehicules (dossier_id, position, marque_modele, livraison_apres_stockage)
     values ('eeeeeeee-0000-0000-0000-00000000f0f3', 2, 'TEST-QA Twingo', false)
     on conflict do nothing;" >/dev/null

check "T12 : acheminement HelixCar — l'adresse de prise en charge est demandée pour les 2" "2" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f3')
      where cle like '%adresse_depart%';" | tail -1)"
check "T13 : le manque d'un véhicule ne se reporte PAS sur l'autre" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f3')
      where cle like '%adresse_arrivee%';" | tail -1)"
check "T14 : et c'est bien celui que HelixCar livre" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f3')
      where cle = 'vehicule_1_adresse_arrivee';" | tail -1)"
check "T15 : le véhicule que le client vient rechercher n'en demande aucune" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f3')
      where cle = 'vehicule_2_adresse_arrivee';" | tail -1)"
check "T16 : aucune restitution n'est réclamée si aucun véhicule n'est concerné" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000f0f3')
      where cle like '%restit%';" | tail -1)"

echo "── U. NETTOYAGE : UNE PERIODE, ET UNE SEULE MISSION ──"
# La mission de nettoyage se creait a la main, par un bouton. Deux
# clics, un rechargement au mauvais moment, un rejeu : rien n'empechait
# STRUCTURELLEMENT deux missions pour la meme demande, et rien ne
# verifiait cote serveur que le devis avait ete accepte.

errU=$(appliquer migrations/102_nettoyage_periode_et_mission.sql)
check "U1 : migrations/102 s'applique sans erreur" "" "$errU"

check "U2 : la mission porte desormais une date de fin" "1" \
  "$(sql "select count(*) from information_schema.columns
     where table_schema='public' and table_name='missions'
       and column_name='date_fin_intervention';")"
check "U3 : l'unicite d'une mission par demande est posee EN BASE" "1" \
  "$(sql "select count(*) from pg_indexes
     where schemaname='public' and indexname='missions_nettoyage_une_par_demande';")"
check "U4 : creer_mission_nettoyage_si_prete n'est pas offerte a anon" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='creer_mission_nettoyage_si_prete' and grantee='anon';")"

sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff01','TEST-QA-CLAUDE-POSTPR2-N1',
             'nett1@helixcar.test','nettoyage','nouveau',
             jsonb_build_object(
               'schema_version', 2,
               'type_nettoyage','preparation_complete',
               'lieu','locaux_client',
               'adresse_rue','12 rue du Test','adresse_cp','69000','adresse_ville','Lyon',
               'date_souhaitee','2026-11-02','date_fin','2026-11-04',
               'creneau_debut','09:00','creneau_fin','17:00',
               'nombre_vehicules_approx', 8,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Karim','telephone','+33600000001')))
     on conflict (id) do nothing;" >/dev/null

check "U5 : plus aucune information n'est attendue pour cette demande" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff01') where statut='attendue';" | tail -1)"
check "U6 : SANS devis accepte, aucune mission n'est creee" "DEVIS_NON_ACCEPTE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01') ->> 'code';" | tail -1)"
check "U7 : ... et la table des missions reste vide pour elle" "0" \
  "$(sql "select count(*) from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff01';")"

sql "insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-POSTPR2-D1','eeeeeeee-0000-0000-0000-00000000ff01', 900, 'refuse');" >/dev/null
check "U8 : un devis REFUSE ne cree aucune mission" "DEVIS_NON_ACCEPTE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01') ->> 'code';" | tail -1)"

sql "update public.devis set statut='accepte' where reference='TEST-QA-CLAUDE-POSTPR2-D1';" >/dev/null
check "U9 : devis accepte et rien qui manque : la mission est creee" "CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01') ->> 'code';" | tail -1)"
check "U10 : elle est bien typee « nettoyage » et en attente d'un partenaire" "nettoyage|en_attente" \
  "$(sql "select type_mission||'|'||statut from public.missions
      where client_id='eeeeeeee-0000-0000-0000-00000000ff01';")"
check "U11 : elle reprend la PERIODE complete, debut et fin" "2026-11-02|2026-11-04" \
  "$(sql "select date_intervention||'|'||date_fin_intervention from public.missions
      where client_id='eeeeeeee-0000-0000-0000-00000000ff01';")"
check "U12 : elle reprend l'adresse, le contact et l'horaire" "12 rue du Test|Lyon|TEST-QA Karim|09:00 – 17:00" \
  "$(sql "select adresse_intervention||'|'||ville_intervention||'|'||contact_nom||'|'||heure_intervention
      from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff01';")"

check "U13 : rejouer l'appel renvoie la mission existante" "DEJA_CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01') ->> 'code';" | tail -1)"
sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01');
   select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01');
   select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01');
   select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01');
   select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01');" >/dev/null
check "U14 : cinq rejeux de plus, et toujours UNE seule mission" "1" \
  "$(sql "select count(*) from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff01';")"
check "U15 : et meme une insertion DIRECTE en double est refusee par la base" "refuse" \
  "$(sql "insert into public.missions (reference, type_mission, statut, client_id)
     values ('TEST-QA-CLAUDE-POSTPR2-DOUBLE','nettoyage','en_attente',
             'eeeeeeee-0000-0000-0000-00000000ff01');" \
   | grep -qiE 'duplicate key|unique' && echo refuse || echo passe)"

sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff02','TEST-QA-CLAUDE-POSTPR2-N2',
             'nett2@helixcar.test','nettoyage','nouveau',
             jsonb_build_object('schema_version',2,'type_nettoyage','preparation_complete',
                                'lieu','locaux_client','date_souhaitee','2026-11-02'))
     on conflict (id) do nothing;
     insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-POSTPR2-D2','eeeeeeee-0000-0000-0000-00000000ff02', 700, 'accepte');" >/dev/null
check "U16 : la date de FIN manquante est reclamee au client" "1" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff02')
      where cle='nettoyage_date_fin' and statut='attendue';" | tail -1)"
check "U17 : et tant qu'il manque quelque chose, aucune mission" "INFORMATIONS_MANQUANTES" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff02') ->> 'code';" | tail -1)"
check "U18 : rien n'a ete cree pour elle" "0" \
  "$(sql "select count(*) from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff02';")"

check "U19 : un client ne peut pas creer une mission" "NON_AUTORISE" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
   select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01') ->> 'code'; commit;" | tail -1)"
check "U20 : un partenaire non plus" "NON_AUTORISE" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
   select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff01') ->> 'code'; commit;" | tail -1)"

# ── U bis. DEUX CREATIONS SIMULTANEES : LA REFERENCE ──
# Le Dashboard appelle la fonction EN PARALLELE pour toutes les demandes
# pretes (Promise.all). Deux appels concurrents lisent donc le meme
# « dernier numero » avant qu'aucun des deux n'ait insere : sans
# precaution, ils forgent la MEME reference.
#
# On synchronise deux sessions psql sur un meme instant, a la
# milliseconde, pour que la course ait vraiment lieu.
sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     select ('eeeeeeee-0000-0000-0000-00000000fc0' || g)::uuid,
            'TEST-QA-CLAUDE-POSTPR2-C' || g,
            'conc' || g || '@helixcar.test','nettoyage','nouveau',
            jsonb_build_object(
              'schema_version', 2, 'type_nettoyage','interieur',
              'lieu','locaux_client',
              'adresse_rue','1 rue Course','adresse_cp','75001','adresse_ville','Paris',
              'date_souhaitee','2026-12-01','date_fin','2026-12-02',
              'creneau_debut','08:00','creneau_fin','12:00',
              'nombre_vehicules_approx', 2,
              'contact_sur_place', jsonb_build_object('nom','TEST-QA Course','telephone','+33600000009'))
       from generate_series(1,2) g
     on conflict (id) do nothing;
     insert into public.devis (reference, client_id, prix, statut)
     select 'TEST-QA-CLAUDE-POSTPR2-DC' || g,
            ('eeeeeeee-0000-0000-0000-00000000fc0' || g)::uuid, 500, 'accepte'
       from generate_series(1,2) g;" >/dev/null

INSTANT=$(sql "select (now() + interval '2 seconds')::text;" | tail -1)
for g in 1 2; do
  printf '%s\n' "begin;
select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
select pg_sleep(greatest(0, extract(epoch from (timestamptz '$INSTANT' - clock_timestamp()))));
select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000fc0$g');
commit;" > "$BASE/course$g.sql"
  chown postgres:postgres "$BASE/course$g.sql"
done
su postgres -c "psql -U postgres -d $DB -qAt -f $BASE/course1.sql" >/dev/null 2>&1 &
su postgres -c "psql -U postgres -d $DB -qAt -f $BASE/course2.sql" >/dev/null 2>&1 &
wait

check "U21 : les deux missions concurrentes sont bien creees" "2" \
  "$(sql "select count(*) from public.missions
     where client_id in ('eeeeeeee-0000-0000-0000-00000000fc01','eeeeeeee-0000-0000-0000-00000000fc02');")"
check "U22 : REPRODUCTION — elles ne portent JAMAIS la meme reference" "2" \
  "$(sql "select count(distinct reference) from public.missions
     where client_id in ('eeeeeeee-0000-0000-0000-00000000fc01','eeeeeeee-0000-0000-0000-00000000fc02');")"
check "U23 : aucune reference de nettoyage n'est en double, nulle part" "0" \
  "$(sql "select count(*) from (select reference from public.missions
      where type_mission='nettoyage' and reference is not null
      group by reference having count(*) > 1) d;")"
check "U24 : et la base le refuse structurellement" "refuse" \
  "$(sql "insert into public.missions (reference, type_mission, statut, client_id)
     select reference, 'nettoyage', 'en_attente', 'eeeeeeee-0000-0000-0000-00000000ff02'
       from public.missions where type_mission='nettoyage' limit 1;" \
   | grep -qiE 'duplicate key|unique' && echo refuse || echo passe)"

echo
echo "── F. IDEMPOTENCE : rejouer les migrations ne duplique rien ──"
DEC_AVANT=$(sql "select count(*) from public.convoyeur_decisions;")
HIST_AVANT=$(sql "select count(*) from public.convoyeur_decisions_historique;")
err5=$(appliquer migrations/05_blocage_partenaire.sql)
err9=$(appliquer migrations/90_durcissement_rls_partenaires.sql)
err4=$(appliquer migrations/04_decisions_activites.sql)
err92=$(appliquer migrations/92_creation_demande_atomique.sql)
err94=$(appliquer migrations/94_informations_selon_scenario.sql)
err95=$(appliquer migrations/95_metiers_partenaires.sql)
err96=$(appliquer migrations/96_missions_nettoyage.sql)
err97=$(appliquer migrations/97_missions_verrou_serveur.sql)
err98=$(appliquer migrations/98_photos_justificatives_reelles.sql)
err99=$(appliquer migrations/99_reclamation_demande.sql)
err100=$(appliquer migrations/100_activites_partenaire.sql)
err101=$(appliquer migrations/101_informations_types_coherents.sql)
err102=$(appliquer migrations/102_nettoyage_periode_et_mission.sql)
check "F1 : 05 se rejoue sans erreur" "" "$err5"
check "F2 : 90 se rejoue sans erreur" "" "$err9"
check "F3 : 04 se rejoue sans erreur" "" "$err4"
check "F3b : 92 se rejoue sans erreur" "" "$err92"
check "F3c : 94 se rejoue sans erreur" "" "$err94"
check "F3d : 95 se rejoue sans erreur" "" "$err95"
check "F3e : 96 se rejoue sans erreur" "" "$err96"
check "F3f : 97 se rejoue sans erreur" "" "$err97"
check "F3g : 98 se rejoue sans erreur" "" "$err98"
check "F3h : 99 se rejoue sans erreur" "" "$err99"
check "F3i : 100 se rejoue sans erreur" "" "$err100"
check "F3j : 101 se rejoue sans erreur" "" "$err101"
check "F3k : 102 se rejoue sans erreur" "" "$err102"
check "F4 : aucune décision dupliquée" "$DEC_AVANT" "$(sql "select count(*) from public.convoyeur_decisions;")"
check "F5 : aucune ligne d'historique inventée par un rejeu" "$HIST_AVANT" \
  "$(sql "select count(*) from public.convoyeur_decisions_historique;")"
check "F6 : aucune politique en double" "0" \
  "$(sql "select count(*) from (select schemaname, tablename, policyname from pg_policies group by 1,2,3 having count(*) > 1) d;")"
check "F7 : aucun trigger en double sur convoyeurs" "0" \
  "$(sql "select count(*) from (select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='convoyeurs' and not t.tgisinternal group by tgname having count(*) > 1) d;")"
# Rejouer 92 ne doit pas ressusciter l'ancienne signature à trois
# arguments : PostgREST se retrouverait devant deux candidates et
# refuserait de choisir, ce qui casserait TOUTES les créations.
check "F8 : aucune signature en double pour creer_demande_avec_vehicules" "1" \
  "$(sql "select count(*) from pg_proc where proname='creer_demande_avec_vehicules';")"
check "F9 : une seule contrainte d'activités sur convoyeurs" "1" \
  "$(sql "select count(*) from pg_constraint
     where conrelid='public.convoyeurs'::regclass and contype='c'
       and pg_get_constraintdef(oid) ilike '%activites%';")"
check "F10 : une seule signature pour informations_demande" "1" \
  "$(sql "select count(*) from pg_proc where proname='informations_demande';")"

echo "── V bis. LOT D3 : L'HORAIRE DE NETTOYAGE, EXIGE ET COMPLET ──"
# REPRODUCTION D'ABORD. Avec les seules migrations 101 et 102, une
# demande de nettoyage SANS heure de fin est presentee comme complete,
# et la mission se cree quand meme : la rubrique unique « Horaire
# d'intervention » etait satisfaite des que l'heure de DEBUT existait.

sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff40','TEST-QA-CLAUDE-PR4-H1',
             'nett-h1@helixcar.test','nettoyage','nouveau',
             jsonb_build_object(
               'schema_version', 2,
               'type_nettoyage','interieur',
               'lieu','locaux_client',
               'adresse_rue','9 rue Sans Fin','adresse_cp','75000','adresse_ville','Paris',
               'date_souhaitee','2026-12-01','date_fin','2026-12-03',
               'creneau_debut','08:30',
               'nombre_vehicules_approx', 3,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Sonia','telephone','+33600000042')))
     on conflict (id) do nothing;" >/dev/null

AVANT_ATTENDUES=$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40') where statut='attendue';" | tail -1)
check "V-D3-1 : REPRODUCTION — sans heure de fin, rien n'est reclame avant 103" "0" "$AVANT_ATTENDUES"
AVANT_RUBRIQUES=$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40') where cle like 'nettoyage_horaire%';" | tail -1)
check "V-D3-2 : REPRODUCTION — une seule rubrique d'horaire avant 103" "1" "$AVANT_RUBRIQUES"

errD3=$(appliquer migrations/103_nettoyage_horaires_obligatoires.sql)
check "V-D3-3 : migrations/103 s'applique sans erreur" "" "$errD3"

check "V-D3-4 : la mission porte ses deux bornes horaires" "2" \
  "$(sql "select count(*) from information_schema.columns
     where table_schema='public' and table_name='missions'
       and column_name in ('heure_debut_intervention','heure_fin_intervention');")"
check "V-D3-5 : heure_intervention n'est PAS retiree" "1" \
  "$(sql "select count(*) from information_schema.columns
     where table_schema='public' and table_name='missions' and column_name='heure_intervention';")"

check "V-D3-6 : l'horaire compte desormais DEUX rubriques" "2" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40')
      where cle in ('nettoyage_horaire_debut','nettoyage_horaire_fin');" | tail -1)"
check "V-D3-7 : le debut fourni est reconnu comme fourni" "fournie" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40')
      where cle='nettoyage_horaire_debut';" | tail -1)"
check "V-D3-8 : la fin absente est desormais RECLAMEE" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40')
      where cle='nettoyage_horaire_fin';" | tail -1)"
check "V-D3-9 : son libelle est celui du formulaire" "Horaire de fin sur place" \
  "$(sqlAdmin "select libelle from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40')
      where cle='nettoyage_horaire_fin';" | tail -1)"

sql "insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-PR4-DH1','eeeeeeee-0000-0000-0000-00000000ff40', 400, 'accepte');" >/dev/null
check "V-D3-10 : devis accepte mais heure de fin absente : AUCUNE mission" "INFORMATIONS_MANQUANTES" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff40') ->> 'code';" | tail -1)"
check "V-D3-11 : ... et la table des missions reste vide pour elle" "0" \
  "$(sql "select count(*) from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff40';")"

# Le client complete son horaire de fin : la mission se cree alors.
sql "update public.clients
        set nettoyage_details = nettoyage_details || jsonb_build_object('creneau_fin','16:45')
      where id='eeeeeeee-0000-0000-0000-00000000ff40';" >/dev/null
check "V-D3-12 : une fois la fin fournie, plus rien n'est attendu" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff40') where statut='attendue';" | tail -1)"
check "V-D3-13 : et la mission se cree enfin" "CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff40') ->> 'code';" | tail -1)"
check "V-D3-14 : elle porte les deux heures, chacune dans sa colonne" "08:30:00|16:45:00" \
  "$(sql "select heure_debut_intervention||'|'||heure_fin_intervention from public.missions
      where client_id='eeeeeeee-0000-0000-0000-00000000ff40';")"
check "V-D3-15 : et le texte lisible reste renseigne pour les fiches existantes" "08:30 – 16:45" \
  "$(sql "select heure_intervention from public.missions
      where client_id='eeeeeeee-0000-0000-0000-00000000ff40';")"
check "V-D3-16 : une seule mission, toujours" "1" \
  "$(sql "select count(*) from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff40';")"

# Une demande ANCIENNE, sans aucun horaire, reste lisible et passe par
# le mecanisme des informations manquantes — jamais une erreur.
sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff41','TEST-QA-CLAUDE-PR4-H2',
             'nett-h2@helixcar.test','nettoyage','nouveau',
             jsonb_build_object(
               'schema_version', 1,
               'type_nettoyage','exterieur',
               'lieu','locaux_client',
               'adresse_rue','3 place Ancienne','adresse_cp','33000','adresse_ville','Bordeaux',
               'date_souhaitee','2026-12-10',
               'nombre_vehicules_approx', 2,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Ancien','telephone','+33600000043')))
     on conflict (id) do nothing;" >/dev/null
check "V-D3-17 : un ancien dossier sans horaire reste LISIBLE" "1" \
  "$(sqlAdmin "select case when count(*) > 0 then 1 else 0 end
      from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff41');" | tail -1)"
check "V-D3-18 : ses deux horaires manquants lui sont reclames" "2" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff41')
      where cle like 'nettoyage_horaire%' and statut='attendue';" | tail -1)"
check "V-D3-19 : et sa date de fin aussi" "attendue" \
  "$(sqlAdmin "select statut from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff41')
      where cle='nettoyage_date_fin';" | tail -1)"

# Une heure de forme inattendue ne fait jamais echouer la creation.
sql "update public.clients
        set nettoyage_details = nettoyage_details
            || jsonb_build_object('date_fin','2026-12-11','creneau_debut','n''importe quoi','creneau_fin','25:99')
      where id='eeeeeeee-0000-0000-0000-00000000ff41';" >/dev/null
sql "insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-PR4-DH2','eeeeeeee-0000-0000-0000-00000000ff41', 300, 'accepte');" >/dev/null
check "V-D3-20 : une heure illisible n'empeche pas la creation" "CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff41') ->> 'code';" | tail -1)"
check "V-D3-21 : elle laisse simplement les colonnes vides" "true" \
  "$(sql "select (heure_debut_intervention is null and heure_fin_intervention is null)::text
      from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff41';")"

# ----------------------------------------------------------------
# V-D3-30 a V-D3-35 — LA CONVERSION DEFENSIVE DOIT L'ETRE VRAIMENT
# ----------------------------------------------------------------
# REPRODUCTION. Le filtre par expression reguliere laisse passer des
# valeurs qui franchissent la forme mais qui ne se convertissent PAS :
#
#   '25:30'       ~ '^[0-2][0-9]:[0-5][0-9]$'   -> vrai, ::time  ECHOUE
#   '2026-02-30'  ~ '^\d{4}-\d{2}-\d{2}$'      -> vrai, ::date  ECHOUE
#   '99999999999' ~ '^[0-9]+$'                  -> vrai, ::integer ECHOUE
#
# Le commentaire de la migration promet qu'une donnee inattendue
# « laisse la colonne vide plutot que de faire echouer la creation ».
# V-D3-20 ne l'avait pas prouve : '25:99' est REJETE par le filtre, donc
# n'atteignait jamais la conversion. Ces controles visent la fenetre
# reellement dangereuse — celle que le filtre accepte.
#
# Consequence si elle n'est pas fermee : un dossier portant une telle
# valeur fait echouer creer_mission_nettoyage_si_prete par une erreur
# SQL brute, et l'administrateur ne peut plus creer la mission du tout.

sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff42','TEST-QA-CLAUDE-PR4-H3',
             'nett-h3@helixcar.test','nettoyage','nouveau',
             jsonb_build_object(
               'schema_version', 2,
               'type_nettoyage','interieur',
               'lieu','locaux_client',
               'adresse_rue','5 rue Hors Plage','adresse_cp','69000','adresse_ville','Lyon',
               'date_souhaitee','2026-12-01','date_fin','2026-12-02',
               'creneau_debut','25:30','creneau_fin','17:00',
               'nombre_vehicules_approx', 2,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Hors Plage','telephone','+33600000044')))
     on conflict (id) do nothing;
     insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-PR4-DH3','eeeeeeee-0000-0000-0000-00000000ff42', 310, 'accepte')
     on conflict do nothing;" >/dev/null
check "V-D3-30 : une heure hors plage (25:30) n'empeche pas la creation" "CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff42') ->> 'code';" | tail -1)"
check "V-D3-31 : elle laisse le debut vide et garde la fin valide" "|17:00:00" \
  "$(sql "select coalesce(heure_debut_intervention::text,'')||'|'||coalesce(heure_fin_intervention::text,'')
      from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff42';")"

sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff43','TEST-QA-CLAUDE-PR4-H4',
             'nett-h4@helixcar.test','nettoyage','nouveau',
             jsonb_build_object(
               'schema_version', 2,
               'type_nettoyage','exterieur',
               'lieu','locaux_client',
               'adresse_rue','7 rue Date Impossible','adresse_cp','31000','adresse_ville','Toulouse',
               'date_souhaitee','2026-02-30','date_fin','2026-12-05',
               'creneau_debut','09:00','creneau_fin','12:00',
               'nombre_vehicules_approx', 1,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Date','telephone','+33600000045')))
     on conflict (id) do nothing;
     insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-PR4-DH4','eeeeeeee-0000-0000-0000-00000000ff43', 320, 'accepte')
     on conflict do nothing;" >/dev/null
check "V-D3-32 : une date impossible (30 fevrier) n'empeche pas la creation" "CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff43') ->> 'code';" | tail -1)"
check "V-D3-33 : elle laisse la date de debut vide et garde la fin valide" "|2026-12-05" \
  "$(sql "select coalesce(date_intervention::text,'')||'|'||coalesce(date_fin_intervention::text,'')
      from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff43';")"

sql "insert into public.clients
      (id, numero_client, email, type_service, statut, nettoyage_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff44','TEST-QA-CLAUDE-PR4-H5',
             'nett-h5@helixcar.test','nettoyage','nouveau',
             jsonb_build_object(
               'schema_version', 2,
               'type_nettoyage','interieur_exterieur',
               'lieu','locaux_client',
               'adresse_rue','11 rue Trop Grand','adresse_cp','44000','adresse_ville','Nantes',
               'date_souhaitee','2026-12-08','date_fin','2026-12-09',
               'creneau_debut','07:00','creneau_fin','19:00',
               'nombre_vehicules_approx', 99999999999,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Grand','telephone','+33600000046')))
     on conflict (id) do nothing;
     insert into public.devis (reference, client_id, prix, statut)
     values ('TEST-QA-CLAUDE-PR4-DH5','eeeeeeee-0000-0000-0000-00000000ff44', 330, 'accepte')
     on conflict do nothing;" >/dev/null
check "V-D3-34 : un nombre de vehicules hors bornes n'empeche pas la creation" "CREEE" \
  "$(sqlAdmin "select public.creer_mission_nettoyage_si_prete('eeeeeeee-0000-0000-0000-00000000ff44') ->> 'code';" | tail -1)"
check "V-D3-35 : il laisse simplement la colonne vide" "true" \
  "$(sql "select (nb_vehicules is null)::text
      from public.missions where client_id='eeeeeeee-0000-0000-0000-00000000ff44';")"

# Les trois convertisseurs, pris isolement : ils convertissent ce qui
# est convertible et rendent NULL — jamais une erreur — pour le reste.
check "V-D3-36 : hc_vers_heure convertit une heure valide" "08:30:00" \
  "$(sql "select public.hc_vers_heure('08:30')::text;")"
check "V-D3-37 : et rend NULL sans erreur sur une heure impossible" "true" \
  "$(sql "select (public.hc_vers_heure('25:30') is null)::text;")"
check "V-D3-38 : hc_vers_date convertit une date valide" "2026-12-01" \
  "$(sql "select public.hc_vers_date('2026-12-01')::text;")"
check "V-D3-39 : et rend NULL sans erreur sur un 30 fevrier" "true" \
  "$(sql "select (public.hc_vers_date('2026-02-30') is null)::text;")"
check "V-D3-40 : hc_vers_entier convertit un entier valide" "3" \
  "$(sql "select public.hc_vers_entier('3')::text;")"
check "V-D3-41 : et rend NULL sans erreur au-dela des bornes" "true" \
  "$(sql "select (public.hc_vers_entier('99999999999') is null)::text;")"
check "V-D3-42 : les trois sont strictes — NULL entre, NULL sort" "true" \
  "$(sql "select (public.hc_vers_heure(null) is null
              and public.hc_vers_date(null) is null
              and public.hc_vers_entier(null) is null)::text;")"
check "V-D3-43 : une seule signature pour chaque convertisseur" "3" \
  "$(sql "select count(*) from pg_proc
     where proname in ('hc_vers_heure','hc_vers_date','hc_vers_entier');")"
check "V-D3-44 : aucun n'est security definer" "0" \
  "$(sql "select count(*) from pg_proc
     where proname in ('hc_vers_heure','hc_vers_date','hc_vers_entier') and prosecdef;")"

echo "── V ter. LOT D2 : LE SCENARIO REELLEMENT CHOISI COMMANDE ──"
# Un stockage ou le client depose ET recupere lui-meme : HelixCar
# n'intervient sur aucun trajet. Rien de tel ne doit lui etre reclame.
sql "insert into public.clients
      (id, numero_client, email, type_service, statut,
       stockage_acheminement, stockage_sortie, stockage_ville, stockage_date_debut, trajet_commun)
     values ('eeeeeeee-0000-0000-0000-00000000ff50','TEST-QA-CLAUDE-PR4-S1',
             'stock-s1@helixcar.test','stockage','nouveau',
             'depot_client','recuperation_client','Lyon','2026-12-01', false)
     on conflict (id) do nothing;
     insert into public.vehicules (dossier_id, position, immatriculation, marque_modele)
     values ('eeeeeeee-0000-0000-0000-00000000ff50', 1, 'AA-111-AA', 'TEST-QA Clio')
     on conflict do nothing;" >/dev/null

check "V-D2-1 : aucune prise en charge HelixCar n'est reclamee" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff50')
      where cle like '%prise_en_charge%' or cle like '%adresse_depart%' or cle like '%contact_pc%';" | tail -1)"
check "V-D2-2 : aucune livraison HelixCar n'est reclamee" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff50')
      where cle like '%adresse_arrivee%' or cle like '%contact_liv%';" | tail -1)"
check "V-D2-3 : aucune restitution n'est reclamee" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff50')
      where cle like '%restit%';" | tail -1)"
check "V-D2-4 : le VIN, facultatif dans le formulaire, n'est jamais reclame" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff50')
      where cle like '%vin%';" | tail -1)"
check "V-D2-5 : une demande complete ne laisse rien d'attendu" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff50')
      where statut='attendue';" | tail -1)"
check "V-D2-6 : et la liste n'est pas vide pour autant" "1" \
  "$(sqlAdmin "select case when count(*) > 0 then 1 else 0 end
      from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff50');" | tail -1)"

# Le TECHNICIEN ne se voit jamais reclamer de vehicule (lot D4).
sql "insert into public.clients
      (id, numero_client, email, type_service, statut, professionnel_details)
     values ('eeeeeeee-0000-0000-0000-00000000ff60','TEST-QA-CLAUDE-PR4-P1',
             'pro-p1@helixcar.test','professionnel','nouveau',
             jsonb_build_object(
               'categorie','technicien','specialite','mecanique',
               'adresse_rue','5 rue Atelier','adresse_ville','Nantes',
               'date_debut','2026-12-05','date_fin','2026-12-06',
               'heure_debut','08:00','heure_fin','18:00',
               'description','TEST-QA remise en etat',
               'nombre_professionnels', 2,
               'contact_sur_place', jsonb_build_object('nom','TEST-QA Leo','telephone','+33600000044')))
     on conflict (id) do nothing;" >/dev/null
check "V-D4-1 : aucun vehicule n'est reclame a un technicien" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff60')
      where cle like '%vehicule%';" | tail -1)"
check "V-D4-2 : sa demande est complete sans aucun vehicule" "0" \
  "$(sqlAdmin "select count(*) from public.informations_demande('eeeeeeee-0000-0000-0000-00000000ff60')
      where statut='attendue';" | tail -1)"

errD3b=$(appliquer migrations/103_nettoyage_horaires_obligatoires.sql)
check "V-D3-22 : 103 se rejoue sans erreur" "" "$errD3b"
check "V-D3-23 : une seule signature pour chaque fonction remplacee" "2" \
  "$(sql "select count(*) from pg_proc
     where proname in ('informations_demande','creer_mission_nettoyage_si_prete');")"

echo "── W bis. LOT B1 : UNE IDENTITE, PLUSIEURS CASQUETTES ──"
# Une meme personne doit pouvoir etre cliente ET partenaire avec la
# MEME adresse, donc la meme identite Auth et le meme mot de passe.

# Une personne qui est deja cliente et qui a depose une candidature
# partenaire avec la meme adresse.
sql "insert into auth.users (id, email, email_confirmed_at) values
      ('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test', now()),
      ('77777777-0000-0000-0000-000000000002','autre-personne@helixcar.test', now()),
      ('77777777-0000-0000-0000-000000000003','non-confirmee@helixcar.test', null)
     on conflict (id) do nothing;
     insert into public.clients (id, numero_client, email, type_service, statut, auth_user_id)
     values ('77777777-1111-0000-0000-000000000001','TEST-QA-CLAUDE-PR4-B1',
             'deux-casquettes@helixcar.test','convoyage','nouveau',
             '77777777-0000-0000-0000-000000000001')
     on conflict (id) do nothing;
     insert into public.convoyeurs (id, prenom, nom, email, activites, statut)
     values ('77777777-2222-0000-0000-000000000001','TEST-QA','Deux Casquettes',
             'deux-casquettes@helixcar.test', array['convoyage'], 'actif')
     on conflict (id) do nothing;" >/dev/null

# REPRODUCTION : avant 104, la page ne peut pas connaitre les roles.
AVANT_FN=$(sql "select count(*) from pg_proc where proname='roles_utilisateur';")
check "W-B1-1 : REPRODUCTION — aucun moyen de connaitre ses roles avant 104" "0" "$AVANT_FN"
AVANT_IDX=$(sql "select count(*) from pg_indexes
   where indexname in ('admins_une_ligne_par_identite','convoyeurs_une_fiche_par_identite');")
check "W-B1-2 : REPRODUCTION — rien n'empeche deux fiches par identite" "0" "$AVANT_IDX"

errB1=$(appliquer migrations/104_identite_unique_roles_multiples.sql)
check "W-B1-3 : migrations/104 s'applique sans erreur" "" "$errB1"
check "W-B1-4 : les deux index d'unicite sont poses" "2" \
  "$(sql "select count(*) from pg_indexes
     where indexname in ('admins_une_ligne_par_identite','convoyeurs_une_fiche_par_identite');")"

# La candidature n'est PAS encore rattachee : un seul role.
check "W-B1-5 : avant rattachement, la personne n'est que cliente" "client" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select string_agg(role, ',' order by role) from public.roles_utilisateur();
     commit;" | tail -1)"

# QUELQU'UN D'AUTRE ne peut pas s'attribuer cette candidature.
check "W-B1-6 : une autre identite ne peut pas s'attribuer la fiche" "INTROUVABLE" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000002','autre-personne@helixcar.test');
     select public.ajouter_role_partenaire('77777777-2222-0000-0000-000000000001') ->> 'code';
     commit;" | tail -1)"
check "W-B1-7 : ... et la fiche reste bien non rattachee" "t" \
  "$(sql "select (auth_user_id is null) from public.convoyeurs
      where id='77777777-2222-0000-0000-000000000001';")"

# Une adresse NON CONFIRMEE ne suffit pas.
sql "insert into public.convoyeurs (id, prenom, nom, email, activites, statut)
     values ('77777777-2222-0000-0000-000000000009','TEST-QA','Non Confirmee',
             'non-confirmee@helixcar.test', array['convoyage'], 'actif')
     on conflict (id) do nothing;" >/dev/null
check "W-B1-8 : une adresse non confirmee ne rattache rien" "ADRESSE_NON_CONFIRMEE" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000003','non-confirmee@helixcar.test');
     select public.ajouter_role_partenaire('77777777-2222-0000-0000-000000000009') ->> 'code';
     commit;" | tail -1)"

# LE PARCOURS LEGITIME.
check "W-B1-9 : la personne rattache SA candidature a SON identite" "RATTACHEE" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select public.ajouter_role_partenaire('77777777-2222-0000-0000-000000000001') ->> 'code';
     commit;" | tail -1)"
check "W-B1-10 : elle porte desormais DEUX roles, sans second mot de passe" "client,partenaire" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select string_agg(role, ',' order by role) from public.roles_utilisateur();
     commit;" | tail -1)"
check "W-B1-11 : une seule identite Auth pour cette adresse" "1" \
  "$(sql "select count(*) from auth.users where email='deux-casquettes@helixcar.test';")"

# IDEMPOTENCE et DOUBLE CLIC.
check "W-B1-12 : rejouer l'appel ne duplique rien" "DEJA_RATTACHEE" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select public.ajouter_role_partenaire('77777777-2222-0000-0000-000000000001') ->> 'code';
     commit;" | tail -1)"
check "W-B1-13 : et toujours UNE seule fiche partenaire pour cette identite" "1" \
  "$(sql "select count(*) from public.convoyeurs
      where auth_user_id='77777777-0000-0000-0000-000000000001'
        and statut is distinct from 'refuse';")"

# Une SECONDE candidature de la meme personne ne cree pas un second role.
sql "insert into public.convoyeurs (id, prenom, nom, email, activites, statut)
     values ('77777777-2222-0000-0000-000000000002','TEST-QA','Deux Casquettes Bis',
             'deux-casquettes@helixcar.test', array['nettoyage'], 'actif')
     on conflict (id) do nothing;" >/dev/null
check "W-B1-14 : une deuxieme fiche partenaire est refusee pour la meme identite" "ROLE_DEJA_PRESENT" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select public.ajouter_role_partenaire('77777777-2222-0000-0000-000000000002') ->> 'code';
     commit;" | tail -1)"
# Ecriture DIRECTE, hors de toute fonction : c'est la base elle-meme
# qui doit refuser. L'erreur attendue est ignoree, seul le compte final
# fait foi.
FORCE_CONV=$(sql "update public.convoyeurs set auth_user_id='77777777-0000-0000-0000-000000000001'
      where id='77777777-2222-0000-0000-000000000002';" 2>&1 | head -1)
check "W-B1-15 : la base refuse elle-meme une deuxieme fiche rattachee" "1" \
  "$(sql "select count(*) from public.convoyeurs
      where auth_user_id='77777777-0000-0000-0000-000000000001'
        and statut is distinct from 'refuse';")"
check "W-B1-15 bis : et elle le dit par une violation d'unicite" "1" \
  "$(printf '%s' "$FORCE_CONV" | grep -ci 'duplicate key\|unique' || true)"
FORCE_ADMIN=$(sql "insert into public.admins (auth_user_id, email, actif)
      values ('11111111-1111-1111-1111-111111111111','admin@helixcar.test', true);" 2>&1 | head -1)
check "W-B1-16 : et deux lignes d'administrateur pour une identite aussi" "1" \
  "$(sql "select count(*) from public.admins
      where auth_user_id='11111111-1111-1111-1111-111111111111';")"
check "W-B1-16 bis : la aussi par une violation d'unicite" "1" \
  "$(printf '%s' "$FORCE_ADMIN" | grep -ci 'duplicate key\|unique' || true)"

# LE ROLE ADMINISTRATEUR N'EST JAMAIS AUTO-ATTRIBUABLE.
check "W-B1-17 : un client ne peut pas s'inscrire administrateur" "0" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select count(*) from (
       select 1 where (select count(*) from public.roles_utilisateur() where role='admin') > 0
     ) d;
     commit;" | tail -1)"
check "W-B1-18 : ajouter_role_partenaire n'ecrit jamais dans admins" "0" \
  "$(sql "select count(*) from pg_proc p
     where p.proname='ajouter_role_partenaire'
       and pg_get_functiondef(p.oid) ilike '%insert into public.admins%';")"

# AUCUNE ENUMERATION : la fonction ne prend aucune adresse en parametre.
check "W-B1-19 : roles_utilisateur ne prend aucun parametre" "0" \
  "$(sql "select pronargs from pg_proc where proname='roles_utilisateur';")"
check "W-B1-20 : elle n'est pas offerte a anon" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='roles_utilisateur' and grantee='anon';")"
check "W-B1-21 : ajouter_role_partenaire non plus" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='ajouter_role_partenaire' and grantee='anon';")"
# Sans session, le refus arrive AVANT meme d'entrer dans la fonction :
# `anon` n'a pas le droit de l'executer. C'est plus strict que le garde
# NON_AUTHENTIFIE prevu a l'interieur — lequel reste en place pour un
# appelant authenticated dont auth.uid() serait nul.
ANON_ROLE=$(sql "begin; select public.devenir_anon();
     select public.ajouter_role_partenaire('77777777-2222-0000-0000-000000000001') ->> 'code';
     commit;" 2>&1 | tail -1)
check "W-B1-22 : sans session, rien n'est possible" "1" \
  "$(printf '%s' "$ANON_ROLE" | grep -ci 'permission denied\|NON_AUTHENTIFIE' || true)"
check "W-B1-22 bis : et le garde interne existe quand meme" "1" \
  "$(sql "select count(*) from pg_proc p
     where p.proname='ajouter_role_partenaire'
       and pg_get_functiondef(p.oid) ilike '%NON_AUTHENTIFIE%';")"

# LES RLS NE SONT PAS ELARGIES : changer de Dashboard ne donne aucun droit.
check "W-B1-23 : un partenaire ne lit toujours pas les demandes des clients" "0" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select count(*) from public.clients where auth_user_id is distinct from auth.uid();
     commit;" | tail -1)"
check "W-B1-24 : il ne voit que SA fiche partenaire" "1" \
  "$(sql "begin;
     select public.devenir('77777777-0000-0000-0000-000000000001','deux-casquettes@helixcar.test');
     select count(*) from public.convoyeurs;
     commit;" | tail -1)"

errB1b=$(appliquer migrations/104_identite_unique_roles_multiples.sql)
check "W-B1-25 : 104 se rejoue sans erreur" "" "$errB1b"
check "W-B1-26 : une seule signature par fonction" "2" \
  "$(sql "select count(*) from pg_proc
     where proname in ('roles_utilisateur','ajouter_role_partenaire');")"


echo
echo "── VID. LOT V01 : LA VIDÉO DE CANDIDATURE EN DEUX PHASES ──"
# Le bucket et les colonnes vidéo viennent de la migration 03, jamais
# appliquée jusqu'ici par ce script ; 93 relève la limite du bucket.
errVid03=$(appliquer migrations/03_videos_candidature.sql)
check "VID-0 : 03 s'applique sans erreur sur le socle" "" "$errVid03"
errVid93=$(appliquer migrations/93_bucket_video_300mo.sql)
check "VID-0b : 93 s'applique sans erreur" "" "$errVid93"
check "VID-0c : le bucket est PRIVÉ et limité à 314 572 800 octets" "false|314572800" \
  "$(sql "select public::text || '|' || file_size_limit from storage.buckets where id='candidatures-videos';")"

sql "insert into public.convoyeurs (id, prenom, nom, email, activites, statut, video_upload_jeton_hash)
     values ('a0a0a0a0-0000-4000-8000-000000000101', 'TEST-QA-CLAUDE-HELIXCAR', 'Video',
             'video-v01@helixcar.test', '{convoyage,renfort}', 'video_attendue', repeat('a', 64))
     on conflict (id) do nothing;" >/dev/null
check "VID-1 : la candidature de recette existe, en attente de vidéo" "video_attendue" \
  "$(sql "select statut from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"

# ── REPRODUCTION DU DÉFAUT DE PRODUCTION (avant 105) ──
# L'ancienne action « autoriser » écrivait chemin + MIME + taille en
# laissant la date d'envoi nulle. Exactement ce que la contrainte de 03
# refuse : code 23514, convoyeurs_video_coherente.
ANCIENNE=$(sql "update public.convoyeurs
     set video_chemin='candidatures/a0a0a0a0-0000-4000-8000-000000000101/x.mov',
         video_mime='video/quicktime', video_taille_octets=225024410,
         video_duree_secondes=119, video_envoyee_le=null
   where id='a0a0a0a0-0000-4000-8000-000000000101';" 2>&1)
check "VID-2 : REPRODUCTION — l'ancienne écriture partielle est refusée par la base" "1" \
  "$(printf '%s' "$ANCIENNE" | grep -c 'convoyeurs_video_coherente' || true)"
check "VID-3 : ... et la ligne n'a pas bougé" "" \
  "$(sql "select coalesce(video_chemin,'') from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"

# SECOND DÉFAUT, LATENT : sans session, le garde-fou de 90 refuse le
# changement de statut que la confirmation doit faire. La fonction
# serveur (service_role, auth.uid() nul) aurait donc échoué juste après.
GARDE_AVANT=$(sql "update public.convoyeurs set statut='en_attente'
   where id='a0a0a0a0-0000-4000-8000-000000000101';" 2>&1)
check "VID-4 : REPRODUCTION — avant 105, la finalisation sans session est refusée par le garde-fou de 90" "1" \
  "$(printf '%s' "$GARDE_AVANT" | grep -ci 'réservée à un administrateur\|reservee a un administrateur' || true)"
sql "update public.convoyeurs set statut='video_attendue' where id='a0a0a0a0-0000-4000-8000-000000000101';" >/dev/null 2>&1

# ── CORRECTIF ──
errVid105=$(appliquer migrations/105_video_envoi_en_deux_phases.sql)
check "VID-5 : 105 s'applique sans erreur" "" "$errVid105"
check "VID-6 : les six colonnes d'envoi en cours existent" "6" \
  "$(sql "select count(*) from information_schema.columns where table_name='convoyeurs'
     and column_name in ('video_envoi_chemin','video_envoi_mime','video_envoi_taille_octets',
                         'video_envoi_duree_secondes','video_envoi_commence_le','video_upload_jeton_consomme_le');")"
check "VID-7 : la contrainte de 03 est TOUJOURS là, intacte" "1" \
  "$(sql "select count(*) from pg_constraint where conname='convoyeurs_video_coherente'
     and pg_get_constraintdef(oid) ilike '%video_envoyee_le IS NOT NULL%';")"
check "VID-8 : l'écriture partielle reste refusée APRÈS 105 (rien n'a été relâché)" "1" \
  "$(sql "update public.convoyeurs
     set video_chemin='candidatures/a0a0a0a0-0000-4000-8000-000000000101/x.mov',
         video_mime='video/quicktime', video_taille_octets=225024410, video_envoyee_le=null
   where id='a0a0a0a0-0000-4000-8000-000000000101';" 2>&1 | grep -c 'convoyeurs_video_coherente' || true)"

# PHASE 1 — ce que la fonction serveur écrit désormais : l'envoi en
# cours, dans ses colonnes. La contrainte de 03 n'est pas concernée.
PHASE1=$(su postgres -c "psql -U postgres -d $DB -c \"update public.convoyeurs
     set video_envoi_chemin='candidatures/a0a0a0a0-0000-4000-8000-000000000101/f1.mov',
         video_envoi_mime='video/quicktime', video_envoi_taille_octets=225024410,
         video_envoi_duree_secondes=119, video_envoi_commence_le=now()
   where id='a0a0a0a0-0000-4000-8000-000000000101';\"" 2>&1 | grep -E '^UPDATE|ERROR')
check "VID-9 : PHASE 1 — l'envoi en cours s'enregistre sans violer aucune contrainte" "UPDATE 1" "$PHASE1"
check "VID-10 : ... les colonnes FINALES sont restées nulles (vidéo pas déclarée reçue)" "|||" \
  "$(sql "select coalesce(video_chemin,'')||'|'||coalesce(video_mime,'')||'|'||coalesce(video_taille_octets::text,'')||'|'||coalesce(video_envoyee_le::text,'')
     from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-11 : un envoi en cours sans MIME est refusé lui aussi (cohérence de 105)" "1" \
  "$(sql "update public.convoyeurs set video_envoi_mime=null where id='a0a0a0a0-0000-4000-8000-000000000101';" 2>&1 | grep -c 'convoyeurs_video_envoi_coherent' || true)"
check "VID-11b : un envoi en cours de plus de 120 s est refusé" "1" \
  "$(sql "update public.convoyeurs set video_envoi_duree_secondes=121 where id='a0a0a0a0-0000-4000-8000-000000000101';" 2>&1 | grep -c 'convoyeurs_video_envoi_duree_plafond' || true)"

# PHASE 2 — finalisation par la fonction SQL, sans session (service).
check "VID-12 : une taille réelle différente de la taille annoncée ne finalise RIEN" "TAILLE_INCOHERENTE" \
  "$(sql "select public.finaliser_video_candidature('a0a0a0a0-0000-4000-8000-000000000101', 1000) ->> 'code';")"
check "VID-12b : ... la ligne est toujours un envoi en cours" "candidatures/a0a0a0a0-0000-4000-8000-000000000101/f1.mov|" \
  "$(sql "select coalesce(video_envoi_chemin,'')||'|'||coalesce(video_chemin,'') from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-13 : PHASE 2 — la finalisation avec la taille réelle réussit" "FINALISEE" \
  "$(sql "select public.finaliser_video_candidature('a0a0a0a0-0000-4000-8000-000000000101', 225024410) ->> 'code';")"
check "VID-14 : les QUATRE colonnes finales sont écrites ENSEMBLE, cohérentes" "candidatures/a0a0a0a0-0000-4000-8000-000000000101/f1.mov|video/quicktime|225024410|119.00|true" \
  "$(sql "select video_chemin||'|'||video_mime||'|'||video_taille_octets||'|'||video_duree_secondes||'|'||(video_envoyee_le is not null)::text
     from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-15 : l'envoi en cours est vidé" "0" \
  "$(sql "select count(*) from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101'
     and (video_envoi_chemin is not null or video_envoi_mime is not null or video_envoi_taille_octets is not null
          or video_envoi_duree_secondes is not null or video_envoi_commence_le is not null);")"
check "VID-16 : la candidature passe en attente d'étude (jamais validée automatiquement)" "en_attente" \
  "$(sql "select statut from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-17 : le jeton est consommé, son empreinte conservée pour l'idempotence" "true|true" \
  "$(sql "select (video_upload_jeton_consomme_le is not null)::text||'|'||(video_upload_jeton_hash is not null)::text
     from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-18 : la date d'envoi est celle de la finalisation (maintenant), pas une date fournie" "true" \
  "$(sql "select (now() - video_envoyee_le < interval '1 minute')::text from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-19 : rejouer la finalisation est IDEMPOTENT (DEJA_FINALISEE, rien réécrit)" "DEJA_FINALISEE|candidatures/a0a0a0a0-0000-4000-8000-000000000101/f1.mov" \
  "$(sql "select (public.finaliser_video_candidature('a0a0a0a0-0000-4000-8000-000000000101', 225024410)) ->> 'code'
     || '|' || video_chemin from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-20 : finaliser une candidature sans envoi en cours ni vidéo -> AUCUN_ENVOI" "AUCUN_ENVOI" \
  "$(sql "select public.finaliser_video_candidature('aaaaaaaa-0000-0000-0000-000000000001', null) ->> 'code';")"
check "VID-21 : finaliser une candidature inexistante -> INTROUVABLE" "INTROUVABLE" \
  "$(sql "select public.finaliser_video_candidature('a0a0a0a0-0000-4000-8000-0000000009ff', null) ->> 'code';")"

# REMPLACEMENT : un nouvel envoi en cours n'efface pas la vidéo reçue
# tant qu'il n'est pas finalisé ; à la finalisation, l'ancien chemin
# est renvoyé pour que le fichier devenu orphelin soit supprimé.
sql "update public.convoyeurs
     set video_envoi_chemin='candidatures/a0a0a0a0-0000-4000-8000-000000000101/f2.mp4',
         video_envoi_mime='video/mp4', video_envoi_taille_octets=7000,
         video_envoi_duree_secondes=25, video_envoi_commence_le=now()
   where id='a0a0a0a0-0000-4000-8000-000000000101';" >/dev/null
check "VID-22 : un remplacement en cours laisse la vidéo reçue INTACTE" "candidatures/a0a0a0a0-0000-4000-8000-000000000101/f1.mov" \
  "$(sql "select video_chemin from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
check "VID-23 : la finalisation du remplacement renvoie l'ancien chemin à nettoyer" "FINALISEE|candidatures/a0a0a0a0-0000-4000-8000-000000000101/f1.mov" \
  "$(sql "select r ->> 'code' || '|' || (r ->> 'ancien_chemin') from public.finaliser_video_candidature('a0a0a0a0-0000-4000-8000-000000000101', 7000) r;")"
check "VID-24 : la nouvelle vidéo est en place, le statut n'a pas été rétrogradé" "candidatures/a0a0a0a0-0000-4000-8000-000000000101/f2.mp4|video/mp4|7000|en_attente" \
  "$(sql "select video_chemin||'|'||video_mime||'|'||video_taille_octets||'|'||statut from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"

# ── AUTORISATIONS ──
check "VID-25 : anon ne peut pas exécuter la finalisation" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
     where routine_name='finaliser_video_candidature' and grantee in ('anon','authenticated','PUBLIC');")"
FIN_ANON=$(sql "begin; select public.devenir_anon();
  select public.finaliser_video_candidature('a0a0a0a0-0000-4000-8000-000000000101', null);
  commit;" 2>&1)
check "VID-26 : ... vérifié en situation : permission refusée" "1" \
  "$(printf '%s' "$FIN_ANON" | grep -ci 'permission denied' || true)"
# Le partenaire propriétaire authentifié ne peut pas écrire les colonnes
# vidéo lui-même (elles sont réservées à la fonction serveur).
sql "insert into auth.users (id, email) values ('a0a0a0a0-0000-4000-8000-0000000001aa','video-v01@helixcar.test') on conflict do nothing;
     update public.convoyeurs set auth_user_id='a0a0a0a0-0000-4000-8000-0000000001aa' where id='a0a0a0a0-0000-4000-8000-000000000101';" >/dev/null
PROPRIO=$(sql "begin; select public.devenir('a0a0a0a0-0000-4000-8000-0000000001aa','video-v01@helixcar.test');
  update public.convoyeurs set video_chemin='candidatures/aaaaaaaa-0000-0000-0000-000000000001/vol.mp4'
   where id='a0a0a0a0-0000-4000-8000-000000000101';
  commit;" 2>&1)
check "VID-27 : le propriétaire ne peut pas pointer sa fiche vers la vidéo d'un autre (garde-fou)" "1" \
  "$(printf '%s' "$PROPRIO" | grep -ci 'gérée par le serveur\|geree par le serveur' || true)"
check "VID-27b : ... la ligne n'a pas bougé" "candidatures/a0a0a0a0-0000-4000-8000-000000000101/f2.mp4" \
  "$(sql "select video_chemin from public.convoyeurs where id='a0a0a0a0-0000-4000-8000-000000000101';")"
PROPRIO2=$(sql "begin; select public.devenir('a0a0a0a0-0000-4000-8000-0000000001aa','video-v01@helixcar.test');
  update public.convoyeurs set video_envoyee_le=now() where id='a0a0a0a0-0000-4000-8000-000000000101';
  commit;" 2>&1)
check "VID-28 : ... ni se déclarer lui-même « vidéo reçue »" "1" \
  "$(printf '%s' "$PROPRIO2" | grep -ci 'gérée par le serveur\|geree par le serveur' || true)"
check "VID-29 : le propriétaire garde ses autres droits (ex. téléphone)" "UPDATE 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('a0a0a0a0-0000-4000-8000-0000000001aa','video-v01@helixcar.test');
  update public.convoyeurs set telephone='+33600000101' where id='a0a0a0a0-0000-4000-8000-000000000101'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "VID-30 : anon ne peut toujours rien modifier sur convoyeurs (RLS, indépendamment du garde-fou)" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir_anon();
  update public.convoyeurs set statut='actif' where id='a0a0a0a0-0000-4000-8000-000000000101'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "VID-31 : le garde-fou de 90 protège toujours le statut contre le propriétaire" "1" \
  "$(sql "begin; select public.devenir('a0a0a0a0-0000-4000-8000-0000000001aa','video-v01@helixcar.test');
  update public.convoyeurs set statut='actif' where id='a0a0a0a0-0000-4000-8000-000000000101'; commit;" 2>&1 \
  | grep -ci 'réservée à un administrateur\|reservee a un administrateur' || true)"
check "VID-32 : un administrateur peut toujours modifier le statut" "UPDATE 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
  update public.convoyeurs set statut='actif' where id='a0a0a0a0-0000-4000-8000-000000000101'; commit;\"" 2>&1 | grep -E '^UPDATE')"

errVid105b=$(appliquer migrations/105_video_envoi_en_deux_phases.sql)
check "VID-33 : 105 se rejoue sans erreur" "" "$errVid105b"
check "VID-34 : une seule signature pour finaliser_video_candidature" "1" \
  "$(sql "select count(*) from pg_proc where proname='finaliser_video_candidature';")"
check "VID-35 : un seul trigger de garde-fou sur convoyeurs" "1" \
  "$(sql "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
     where c.relname='convoyeurs' and tgname='trg_garde_colonnes_sensibles_convoyeur';")"
check "VID-36 : aucune politique Storage accordée à anon sur le bucket vidéo" "0" \
  "$(sql "select count(*) from pg_policies where tablename='objects' and schemaname='storage'
     and policyname ilike 'candidature video%' and 'anon' = any(roles);")"


echo
echo "── DEV. LOT Q01 : VERSIONS DE DEVIS ET JOURNAL DES ENVOIS ──"
errDev106=$(appliquer migrations/106_devis_versions_et_journal_envois.sql)
check "DEV-1 : 106 s'applique sans erreur" "" "$errDev106"
check "DEV-2 : les dix colonnes d'état existent sur devis" "10" \
  "$(sql "select count(*) from information_schema.columns where table_name='devis'
     and column_name in ('version','version_preparee','version_envoyee','version_acceptee','consulte_le',
                         'envoi_en_cours_depuis','paiement_statut','paiement_confirme_le','annule_le','expire_le');")"
sql "insert into public.devis (id, reference, client_id, prix, statut)
     values ('d0d0d0d0-0000-4000-8000-000000000101','TEST-QA-CLAUDE-HELIXCAR-DEV-1',
             'cccccccc-0000-0000-0000-00000000000A', 450, 'genere') on conflict (id) do nothing;" >/dev/null
check "DEV-3 : un devis existant ou nouveau démarre en version 1, paiement « aucun »" "1|aucun" \
  "$(sql "select version||'|'||paiement_statut from public.devis where id='d0d0d0d0-0000-4000-8000-000000000101';")"
sql "update public.devis set statut='envoye', version_envoyee=1, date_envoi=now() where id='d0d0d0d0-0000-4000-8000-000000000101';" >/dev/null
check "DEV-4 : changer le statut sans changer le prix ne change pas la version" "1" \
  "$(sql "select version from public.devis where id='d0d0d0d0-0000-4000-8000-000000000101';")"
sql "update public.devis set prix=500, statut='genere' where id='d0d0d0d0-0000-4000-8000-000000000101';" >/dev/null
check "DEV-5 : un prix modifié fait une NOUVELLE version (trigger)" "2|1" \
  "$(sql "select version||'|'||version_envoyee from public.devis where id='d0d0d0d0-0000-4000-8000-000000000101';")"
check "DEV-6 : un paiement_statut inconnu est refusé" "1" \
  "$(sql "update public.devis set paiement_statut='bidon' where id='d0d0d0d0-0000-4000-8000-000000000101';" 2>&1 | grep -c 'devis_paiement_statut_valide' || true)"
# Journal : écrit par le serveur (sans session), lu par l'administrateur seul.
JOURNAL=$(su postgres -c "psql -U postgres -d $DB -c \"insert into public.devis_envois (devis_id, version, etape, destinataire, envoi_cle, fournisseur)
  values ('d0d0d0d0-0000-4000-8000-000000000101', 1, 'tentative', 'test-qa-claude-helixcar@example.invalid', 'tentative-1', 'resend'),
         ('d0d0d0d0-0000-4000-8000-000000000101', 1, 'acceptee_prestataire', 'test-qa-claude-helixcar@example.invalid', 'tentative-1', 'resend');\"" 2>&1 | grep -E '^INSERT|ERROR')
check "DEV-7 : le serveur (sans session) journalise tentative et acceptation séparément" "INSERT 0 2" "$JOURNAL"
check "DEV-8 : une étape inconnue est refusée" "1" \
  "$(sql "insert into public.devis_envois (devis_id, version, etape) values ('d0d0d0d0-0000-4000-8000-000000000101', 1, 'envoye');" 2>&1 | grep -c 'devis_envois_etape_check' || true)"
check "DEV-9 : un administrateur lit le journal" "2" \
  "$(sql "begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
     select count(*) from public.devis_envois; commit;" | tail -1)"
check "DEV-10 : un client authentifié ne lit RIEN du journal" "0" \
  "$(sql "begin; select public.devenir('55555555-5555-5555-5555-555555555555','clientA@helixcar.test');
     select count(*) from public.devis_envois; commit;" | tail -1)"
check "DEV-11 : un partenaire non plus" "0" \
  "$(sql "begin; select public.devenir('22222222-2222-2222-2222-222222222222','partenaire@helixcar.test');
     select count(*) from public.devis_envois; commit;" | tail -1)"
ANON_J=$(sql "begin; select public.devenir_anon(); select count(*) from public.devis_envois; commit;" 2>&1 | tail -1)
check "DEV-12 : anon n'a aucun droit sur le journal" "1" \
  "$(printf '%s' "$ANON_J" | grep -ci 'permission denied' || true)"
check "DEV-13 : personne n'écrit dans le journal depuis le navigateur (admin compris : aucune politique d'insertion)" "INSERT 0 0|refus" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');
     insert into public.devis_envois (devis_id, version, etape) values ('d0d0d0d0-0000-4000-8000-000000000101', 1, 'echec'); commit;\"" 2>&1 \
     | grep -qiE 'row-level security|permission denied' && echo 'INSERT 0 0|refus' || echo 'passe')"
check "DEV-14 : le journal ne contient aucun jeton ni secret (colonnes)" "0" \
  "$(sql "select count(*) from information_schema.columns where table_name='devis_envois' and column_name ilike '%token%' or table_name='devis_envois' and column_name ilike '%jeton%';")"
errDev106b=$(appliquer migrations/106_devis_versions_et_journal_envois.sql)
check "DEV-15 : 106 se rejoue sans erreur" "" "$errDev106b"
check "DEV-16 : un seul trigger de version, une seule politique de lecture" "1|1" \
  "$(sql "select (select count(*) from pg_trigger where tgname='trg_devis_nouvelle_version')||'|'||(select count(*) from pg_policies where tablename='devis_envois');")"
check "DEV-17 : aucun objet Stripe créé par ce lot" "0" \
  "$(sql "select count(*) from information_schema.columns where column_name ilike '%stripe%';")"

# ── Sections par lot, dans tests/rls/*.sh ──
# Chaque lot ajoute SON fichier plutôt que d'allonger celui-ci : deux
# chantiers menés en parallèle ne se disputent plus la même fin de
# script. Les fichiers sont exécutés dans l'ordre alphabétique et
# disposent de check(), sql(), sqlAdmin(), appliquer() et su/psql.
for f in "$REPO"/tests/rls/*.sh; do
  [ -f "$f" ] || continue
  # F01 (112) impose de nouvelles règles de saisie : les anciennes
  # fixtures des migrations antérieures doivent être créées avant.
  [[ "$(basename "$f")" = 'f01.sh' || "$(basename "$f")" = 'reprise_finalisation.sh' ]] && continue
  echo
  echo "── $(basename "$f") ──"
  # shellcheck disable=SC1090
  . "$f"
done

if [ -f "$REPO/tests/rls/f01.sh" ]; then
  . "$REPO/tests/rls/f01.sh"
fi

. "$REPO/tests/rls/reprise_finalisation.sh"

echo
echo "=== $PASS PASS / $FAIL FAIL ==="
for e in "${ECHECS[@]:-}"; do [ -n "$e" ] && echo "  - $e"; done
[ "$FAIL" -eq 0 ] || exit 1
