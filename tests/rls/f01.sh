#!/usr/bin/env bash
# ============================================================
# LOT F01 — PLAFONDS MISSION / TYPE DE MISSION (C01) ET NETTOYAGE
#           RÉSERVÉ AUX ENTREPRISES (F01-010) — migration 112
# ============================================================
# Sourcé en dernier par tests/t_rls.sh : les fixtures historiques des
# migrations antérieures sont créées avant l'activation de la 112.
# Dispose de check(), sql(), sqlAdmin(), appliquer() et de $DB.
#
# Ce que ce fichier doit vérifier lorsqu'il est exécuté sur PostgreSQL 16
# (NON EXÉCUTÉ dans l'environnement de reprise Codex) :
#   * 112 s'applique, et se rejoue, sans erreur ;
#   * un dépôt public (RPC creer_demande_avec_vehicules, comme le
#     formulaire) ET un INSERT direct sont refusés pour un nettoyage
#     de particulier ; le professionnel passe ;
#   * Mission : 165 et 166 caractères acceptés, 167 refusé ; Type de
#     mission (renfort) : 155 et 156 acceptés, 157 refusé ; les deux
#     chaînes de référence (accents, apostrophe typographique, espaces)
#     font exactement 166 et 156 caractères pour char_length ;
#   * un ancien dossier trop long (inséré AVANT 112) reste lisible et
#     modifiable tant que son texte ne change pas, et un nouveau texte
#     au-delà du plafond y est refusé ;
#   * aucune politique RLS ni contrainte existante n'est affaiblie ;
#   * le message porte un code métier stable, jamais un texte technique.
#
# Jeux d'essai préfixés TEST-QA-CLAUDE-HELIXCAR. Jamais Supabase.

F01_REF_MISSION='Diagnostic électronique complet de plusieurs véhicules présentant des défauts intermittents, contrôle des calculateurs, vérification des systèmes d’aide à la conduite'
F01_REF_TYPE='Gestion administrative temporaire de dossiers clients, contrôle des documents, mise à jour des statuts de préparation et coordination des entrées et sorties'

# Dépôt d'une demande PROFESSIONNELLE par la RPC publique (anon), avec
# un texte de mission donné : $1 = suffixe d'identifiant, $2 = catégorie,
# $3 = texte. Renvoie la sortie brute de psql (refus inclus).
f01_deposer_pro() {
  sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','f0100000-0000-4000-8000-0000000000$1','numero_client','TEST-QA-CLAUDE-HELIXCAR-F01-$1',
                        'prenom','TEST-QA-CLAUDE-HELIXCAR','email','f01-$1@helixcar.test',
                        'type_client','pro','type_service','professionnel',
                        'professionnel_details', jsonb_build_object('schema_version',1,'categorie','$2','description',\$hc\$$3\$hc\$)),
     '[]'::jsonb); commit;"
}
f01_existe() { sql "select count(*) from public.clients where id = 'f0100000-0000-4000-8000-0000000000$1';" | tail -1; }
f01_refus() { printf '%s' "$1" | grep -qE "$2" && echo refus || echo passe; }

# ── Un ANCIEN dossier trop long, inséré AVANT la migration ──
sql "insert into public.clients (id, numero_client, email, type_client, type_service, statut, professionnel_details)
     values ('f0100000-0000-4000-8000-0000000000a0', 'TEST-QA-CLAUDE-HELIXCAR-F01-ANCIEN', 'f01-ancien@helixcar.test',
             'pro', 'professionnel', 'nouveau',
             jsonb_build_object('schema_version',1,'categorie','technicien','description', repeat('a', 200)))
     on conflict (id) do nothing;" >/dev/null

# ── 1. APPLICATION ──
# Photographie AVANT 112 : privilèges et politiques de public.clients.
# 112 ne doit en changer aucun (G01-007).
f01_grants_avant=$(sql "select count(*) from information_schema.role_table_grants where table_name='clients';" | tail -1)
f01_policies_avant=$(sql "select count(*) from pg_policies where tablename='clients';" | tail -1)
errF01=$(appliquer migrations/112_plafonds_mission_et_nettoyage_reserve.sql)
check "F01-1 : migrations/112 s'applique sans erreur" "" "$errF01"
errF01b=$(appliquer migrations/112_plafonds_mission_et_nettoyage_reserve.sql)
check "F01-1b : 112 est idempotente (rejeu sans erreur)" "" "$errF01b"
check "F01-1c : le déclencheur existe, actif, sur public.clients" "1" \
  "$(sql "select count(*) from pg_trigger where tgrelid='public.clients'::regclass and tgname='trg_verrou_demande_formulaire' and tgenabled='O';")"
check "F01-1d : l'ancien dossier trop long n'a été ni tronqué ni réécrit (200 caractères conservés)" "200" \
  "$(sql "select char_length(professionnel_details->>'description') from public.clients where id='f0100000-0000-4000-8000-0000000000a0';")"

# ── 2. NETTOYAGE RÉSERVÉ AUX ENTREPRISES ──
sortie=$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','f0100000-0000-4000-8000-0000000000b1','numero_client','TEST-QA-CLAUDE-HELIXCAR-F01-B1',
                        'email','f01-b1@helixcar.test','type_client','particulier','type_service','nettoyage',
                        'nettoyage_details', jsonb_build_object('schema_version',2)),
     '[]'::jsonb); commit;")
check "F01-2 : requête forcée d'un PARTICULIER (RPC publique) pour un nettoyage — refusée, code HC_RESERVE_ENTREPRISES" "refus|0" \
  "$(f01_refus "$sortie" 'HC_RESERVE_ENTREPRISES')|$(f01_existe b1)"
check "F01-2b : le refus contient l'explication métier en français" "refus" \
  "$(f01_refus "$sortie" 'réservé aux entreprises')"
sortie=$(sql "insert into public.clients (id, numero_client, email, type_client, type_service, statut)
   values ('f0100000-0000-4000-8000-0000000000b2','TEST-QA-CLAUDE-HELIXCAR-F01-B2','f01-b2@helixcar.test','particulier','nettoyage','nouveau');")
check "F01-3 : INSERT direct (hors RPC) d'un nettoyage pour un particulier — refusé aussi" "refus|0" \
  "$(f01_refus "$sortie" 'HC_RESERVE_ENTREPRISES')|$(f01_existe b2)"
sortie=$(sql "insert into public.clients (id, numero_client, email, type_service, statut)
   values ('f0100000-0000-4000-8000-0000000000b3','TEST-QA-CLAUDE-HELIXCAR-F01-B3','f01-b3@helixcar.test','nettoyage','nouveau');")
check "F01-3b : sans type de client du tout, un nettoyage est refusé (jamais présumé professionnel)" "refus|0" \
  "$(f01_refus "$sortie" 'HC_RESERVE_ENTREPRISES')|$(f01_existe b3)"
sortie=$(sql "begin; select public.devenir_anon();
   select public.creer_demande_avec_vehicules(
     jsonb_build_object('id','f0100000-0000-4000-8000-0000000000b4','numero_client','TEST-QA-CLAUDE-HELIXCAR-F01-B4',
                        'email','f01-b4@helixcar.test','type_client','pro','societe','TEST-QA-CLAUDE-HELIXCAR SAS',
                        'type_service','nettoyage','nettoyage_details', jsonb_build_object('schema_version',2)),
     '[]'::jsonb); commit;")
check "F01-4 : le PROFESSIONNEL dépose un nettoyage normalement" "passe|1" \
  "$(f01_refus "$sortie" 'HC_RESERVE_ENTREPRISES')|$(f01_existe b4)"
sortie=$(sql "update public.clients set type_client='particulier' where id='f0100000-0000-4000-8000-0000000000b4';")
check "F01-5 : repasser ce dossier nettoyage en particulier est refusé ; un autre changement (statut) passe" "refus|pro|1" \
  "$(f01_refus "$sortie" 'HC_RESERVE_ENTREPRISES')|$(sql "select type_client from public.clients where id='f0100000-0000-4000-8000-0000000000b4';")|$(sql "update public.clients set statut='compte_cree' where id='f0100000-0000-4000-8000-0000000000b4' returning 1;" | tail -1)"

# ── 3. PLAFONDS — MISSION (technicien) 165 / 166 / 167 ──
check "F01-6 : Mission — 165 caractères acceptés" "passe|1" \
  "$(f01_refus "$(f01_deposer_pro c1 technicien "$(printf 'x%.0s' $(seq 1 165))")" 'HC_PLAFOND')|$(f01_existe c1)"
check "F01-6b : Mission — 166 caractères acceptés" "passe|1" \
  "$(f01_refus "$(f01_deposer_pro c2 technicien "$(printf 'x%.0s' $(seq 1 166))")" 'HC_PLAFOND')|$(f01_existe c2)"
sortie=$(f01_deposer_pro c3 technicien "$(printf 'x%.0s' $(seq 1 167))")
check "F01-6c : Mission — 167 caractères refusés, code HC_PLAFOND_MISSION, rien n'est écrit" "refus|0" \
  "$(f01_refus "$sortie" 'HC_PLAFOND_MISSION')|$(f01_existe c3)"
check "F01-6d : le refus dit la limite (166) et la longueur saisie (167), en français" "refus" \
  "$(f01_refus "$sortie" 'limité à 166 caractères.*167 saisis')"

# ── 4. PLAFONDS — TYPE DE MISSION (renfort) 155 / 156 / 157 ──
check "F01-7 : Type de mission — 155 caractères acceptés" "passe|1" \
  "$(f01_refus "$(f01_deposer_pro d1 renfort "$(printf 'y%.0s' $(seq 1 155))")" 'HC_PLAFOND')|$(f01_existe d1)"
check "F01-7b : Type de mission — 156 caractères acceptés" "passe|1" \
  "$(f01_refus "$(f01_deposer_pro d2 renfort "$(printf 'y%.0s' $(seq 1 156))")" 'HC_PLAFOND')|$(f01_existe d2)"
sortie=$(f01_deposer_pro d3 renfort "$(printf 'y%.0s' $(seq 1 157))")
check "F01-7c : Type de mission — 157 caractères refusés, code HC_PLAFOND_TYPE_MISSION" "refus|0" \
  "$(f01_refus "$sortie" 'HC_PLAFOND_TYPE_MISSION')|$(f01_existe d3)"
check "F01-7d : 166 caractères, acceptés pour une Mission, sont refusés pour un Type de mission (plafond propre : 156)" "refus|0" \
  "$(f01_refus "$(f01_deposer_pro d4 renfort "$(printf 'y%.0s' $(seq 1 166))")" 'HC_PLAFOND_TYPE_MISSION')|$(f01_existe d4)"

# ── 5. LES CHAÎNES DE RÉFÉRENCE : ACCENTS, APOSTROPHE, ESPACES ──
encodage=$(sql "show server_encoding;" | tail -1)
if [ "$encodage" = "UTF8" ]; then
  check "F01-8 : la chaîne de référence « Diagnostic électronique… conduite » fait exactement 166 caractères (char_length)" "166" \
    "$(sql "select char_length(\$hc\$$F01_REF_MISSION\$hc\$);" | tail -1)"
  check "F01-8b : elle est acceptée telle quelle ; avec son point final (167) elle est refusée" "passe|1|refus|0" \
    "$(f01_refus "$(f01_deposer_pro e1 technicien "$F01_REF_MISSION")" 'HC_PLAFOND')|$(f01_existe e1)|$(f01_refus "$(f01_deposer_pro e2 technicien "$F01_REF_MISSION.")" 'HC_PLAFOND_MISSION')|$(f01_existe e2)"
  check "F01-9 : la chaîne de référence « Gestion administrative… sorties » fait exactement 156 caractères" "156" \
    "$(sql "select char_length(\$hc\$$F01_REF_TYPE\$hc\$);" | tail -1)"
  check "F01-9b : elle est acceptée telle quelle pour un renfort ; avec un point final (157) elle est refusée" "passe|1|refus|0" \
    "$(f01_refus "$(f01_deposer_pro e3 renfort "$F01_REF_TYPE")" 'HC_PLAFOND')|$(f01_existe e3)|$(f01_refus "$(f01_deposer_pro e4 renfort "$F01_REF_TYPE.")" 'HC_PLAFOND_TYPE_MISSION')|$(f01_existe e4)"
  check "F01-9c : le texte accepté est conservé à l'identique (accents et apostrophe typographique compris)" "1" \
    "$(sql "select count(*) from public.clients where id='f0100000-0000-4000-8000-0000000000e1' and professionnel_details->>'description' = \$hc\$$F01_REF_MISSION\$hc\$;" | tail -1)"
else
  echo "NOTE - F01-8/9 : base locale en $encodage (production Supabase : UTF8) — les chaînes accentuées ne sont pas comparables ici, contrôle reporté sur l'environnement de recette"
fi

# ── 6. LES ANCIENS DOSSIERS RESTENT VIVANTS ──
check "F01-10 : un ancien dossier de 200 caractères reste modifiable tant que son texte ne change pas (statut, rattachement)" "1|compte_cree" \
  "$(sql "update public.clients set statut='compte_cree' where id='f0100000-0000-4000-8000-0000000000a0' returning 1;" | tail -1)|$(sql "select statut from public.clients where id='f0100000-0000-4000-8000-0000000000a0';" | tail -1)"
check "F01-10b : une autre clé de professionnel_details peut changer sans que le vieux texte ne soit rejugé" "1|200" \
  "$(sql "update public.clients set professionnel_details = professionnel_details || jsonb_build_object('heure_debut','09:00') where id='f0100000-0000-4000-8000-0000000000a0' returning 1;" | tail -1)|$(sql "select char_length(professionnel_details->>'description') from public.clients where id='f0100000-0000-4000-8000-0000000000a0';" | tail -1)"
sortie=$(sql "update public.clients set professionnel_details = professionnel_details || jsonb_build_object('description', repeat('b', 170)) where id='f0100000-0000-4000-8000-0000000000a0';")
check "F01-11 : y écrire un NOUVEAU texte de 170 caractères est refusé (le plafond s'applique à toute nouvelle saisie)" "refus|200" \
  "$(f01_refus "$sortie" 'HC_PLAFOND_MISSION')|$(sql "select char_length(professionnel_details->>'description') from public.clients where id='f0100000-0000-4000-8000-0000000000a0';" | tail -1)"
check "F01-11b : y écrire un texte de 160 caractères est accepté (correction explicite d'une nouvelle saisie)" "1|160" \
  "$(sql "update public.clients set professionnel_details = professionnel_details || jsonb_build_object('description', repeat('c', 160)) where id='f0100000-0000-4000-8000-0000000000a0' returning 1;" | tail -1)|$(sql "select char_length(professionnel_details->>'description') from public.clients where id='f0100000-0000-4000-8000-0000000000a0';" | tail -1)"

# ── 7. RIEN N'EST AFFAIBLI ──
check "F01-12 : 112 ne touche aucune politique de clients (même compte avant et après)" "$f01_policies_avant" \
  "$(sql "select count(*) from pg_policies where tablename='clients';" | tail -1)"
check "F01-12b : 112 n'accorde ni ne retire aucun privilège sur clients (même compte avant et après)" "$f01_grants_avant" \
  "$(sql "select count(*) from information_schema.role_table_grants where table_name='clients';" | tail -1)"
check "F01-12c : la fonction de verrou n'est pas exposée comme RPC utile (déclencheur uniquement, type trigger)" "trigger" \
  "$(sql "select pg_catalog.format_type(p.prorettype, null) from pg_proc p where p.proname='verrou_demande_formulaire';" | tail -1)"

# Changer de catégorie constitue une nouvelle application de la règle,
# même si le texte est inchangé : 166 ne doit pas entrer dans Renfort.
sortie=$(sql "update public.clients set professionnel_details = professionnel_details || jsonb_build_object('categorie','renfort') where id='f0100000-0000-4000-8000-0000000000c2';")
check "F01-13 : changement de catégorie seul ne contourne pas le plafond 156" "refus|technicien" \
  "$(f01_refus "$sortie" 'HC_PLAFOND_TYPE_MISSION')|$(sql "select professionnel_details->>'categorie' from public.clients where id='f0100000-0000-4000-8000-0000000000c2';" | tail -1)"
if [ "$encodage" = "UTF8" ]; then
  check "F01-14 : caractère hors BMP compté comme un point de code, comme le navigateur" "156" \
    "$(sql "select char_length(repeat('é',155)||'🚗');" | tail -1)"
  check "F01-14b : 156 points de code avec emoji passent le plafond renfort" "passe|1" \
    "$(f01_refus "$(f01_deposer_pro e5 renfort "$(printf 'é%.0s' $(seq 1 155))🚗")" 'HC_PLAFOND')|$(f01_existe e5)"
fi
