# ============================================================
# LOT D01 — ÉVALUATIONS RÉELLES ET MISSIONS DU CLIENT (migration 111)
# ============================================================
# Exécuté par tests/t_rls.sh après toutes ses sections (avant l01, o01,
# q02 par ordre alphabétique) : la base porte les migrations 00 à 106.
# Ce fichier applique migrations/111 et observe le comportement RÉEL.
#
# Jeux d'essai préfixés TEST-QA-CLAUDE-HELIXCAR, identités en .test.
#
# Identités propres au lot (UUID v4 syntaxiquement valides) :
#   a0030000-0000-4000-8000-0000000000c1 / c2 : deux comptes CLIENT
#   a0030000-0000-4000-8000-0000000000p1      : le compte du partenaire
#   c0030000-0000-4000-8000-000000000001      : sa fiche convoyeur
#   d0030000-0000-4000-8000-0000000000NN      : demandes
#   e0030000-0000-4000-8000-0000000000NN      : missions

d01_c1() { sql "begin; select public.devenir('a0030000-0000-4000-8000-0000000000c1','d01c1@helixcar.test');
$1
commit;" | tail -n +2; }
d01_c2() { sql "begin; select public.devenir('a0030000-0000-4000-8000-0000000000c2','d01c2@helixcar.test');
$1
commit;" | tail -n +2; }
d01_p1() { sql "begin; select public.devenir('a0030000-0000-4000-8000-0000000000e1','d01p1@helixcar.test');
$1
commit;" | tail -n +2; }

sql "insert into auth.users (id, email, email_confirmed_at) values
       ('a0030000-0000-4000-8000-0000000000c1', 'd01c1@helixcar.test', now()),
       ('a0030000-0000-4000-8000-0000000000c2', 'd01c2@helixcar.test', now()),
       ('a0030000-0000-4000-8000-0000000000e1', 'd01p1@helixcar.test', now())
     on conflict (id) do nothing;
     insert into public.convoyeurs (id, auth_user_id, prenom, nom, email, activites, statut, bloque)
     values ('c0030000-0000-4000-8000-000000000001', 'a0030000-0000-4000-8000-0000000000e1',
             'TEST-QA-CLAUDE-HELIXCAR', 'D01-P1', 'd01p1@helixcar.test', '{convoyage}', 'actif', false)
     on conflict (id) do nothing;
     insert into public.clients (id, auth_user_id, numero_client, email, prenom, nom, type_service, statut)
     values ('d0030000-0000-4000-8000-000000000001', 'a0030000-0000-4000-8000-0000000000c1',
             'TEST-QA-CLAUDE-HELIXCAR-D01-1', 'd01c1@helixcar.test', 'TEST-QA', 'D01-C1', 'convoyage', 'nouveau'),
            ('d0030000-0000-4000-8000-000000000002', 'a0030000-0000-4000-8000-0000000000c2',
             'TEST-QA-CLAUDE-HELIXCAR-D01-2', 'd01c2@helixcar.test', 'TEST-QA', 'D01-C2', 'convoyage', 'nouveau')
     on conflict (id) do nothing;
     insert into public.missions (id, reference, client_id, convoyeur_id, statut, ville_depart, ville_arrivee, prix_ttc, remuneration_convoyeur)
     values ('e0030000-0000-4000-8000-000000000001', 'TEST-QA-CLAUDE-HELIXCAR-D01-M1',
             'd0030000-0000-4000-8000-000000000001', 'c0030000-0000-4000-8000-000000000001', 'terminee', 'Lyon', 'Paris', 400, 200),
            ('e0030000-0000-4000-8000-000000000002', 'TEST-QA-CLAUDE-HELIXCAR-D01-M2',
             'd0030000-0000-4000-8000-000000000001', 'c0030000-0000-4000-8000-000000000001', 'en_cours', 'Lyon', 'Nice', 500, 250),
            ('e0030000-0000-4000-8000-000000000003', 'TEST-QA-CLAUDE-HELIXCAR-D01-M3',
             'd0030000-0000-4000-8000-000000000002', 'c0030000-0000-4000-8000-000000000001', 'terminee', 'Paris', 'Lille', 300, 150)
     on conflict (id) do nothing;" >/dev/null

# ── 1. APPLICATION ──
errD=$(appliquer migrations/111_evaluations_et_missions_client.sql)
check "D01-1 : migrations/111 s'applique sans erreur" "" "$errD"
check "D01-2 : rejouer la migration ne change rien (idempotente)" "" "$(appliquer migrations/111_evaluations_et_missions_client.sql)"
check "D01-3 : la table des evaluations est sous RLS, avec trois politiques de lecture et AUCUNE d'ecriture" "true|3|0" \
  "$(sql "select (select rowsecurity from pg_tables where tablename='evaluations')||'|'||
          (select count(*) from pg_policies where tablename='evaluations' and cmd='SELECT')||'|'||
          (select count(*) from pg_policies where tablename='evaluations' and cmd<>'SELECT');")"
check "D01-4 : authenticated ne peut que lire ; anon rien" "SELECT|0" \
  "$(sql "select string_agg(privilege_type, ',') from information_schema.role_table_grants where table_name='evaluations' and grantee='authenticated';
          select count(*) from information_schema.role_table_grants where table_name='evaluations' and grantee='anon';" | paste -sd'|')"
check "D01-5 : evaluer_mission n'est pas offerte a anon" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants where routine_name='evaluer_mission' and grantee='anon';")"

# ── 2. LA VUE DU CLIENT ──
check "D01-6 : le client voit SES deux missions, aucune evaluee, sans remuneration du partenaire" "2|0|0" \
  "$(d01_c1 "select count(*)||'|'||count(*) filter (where evaluee)||'|'||
             (select count(*) from information_schema.columns where table_name='v_mes_missions' and column_name in ('remuneration_convoyeur','validee_paiement'))
             from public.v_mes_missions;" | tail -1)"
check "D01-7 : l'autre client ne voit que la sienne" "1|TEST-QA-CLAUDE-HELIXCAR-D01-M3" \
  "$(d01_c2 "select count(*)||'|'||min(reference) from public.v_mes_missions;" | tail -1)"
check "D01-8 : la vue porte le prenom du partenaire, pas son identite complete" "TEST-QA-CLAUDE-HELIXCAR|0" \
  "$(d01_c1 "select min(convoyeur_prenom)||'|'||(select count(*) from information_schema.columns where table_name='v_mes_missions' and column_name in ('convoyeur_nom','convoyeur_email','convoyeur_telephone')) from public.v_mes_missions;" | tail -1)"
check "D01-9 : anon n'y a pas acces" "refuse" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.v_mes_missions; commit;" 2>&1 | grep -q 'permission denied' && echo refuse)"

# ── 3. L'ÉVALUATION : PROPRIÉTÉ, ÉTAT, BARÈME, UNICITÉ ──
NOTES='{"ponctualite":4,"retard":3,"etat":4,"communication":2,"professionnalisme":3,"tenue":1}'
check "D01-10 : une mission en cours ne s'evalue pas" "MISSION_NON_TERMINEE" \
  "$(d01_c1 "select public.evaluer_mission('e0030000-0000-4000-8000-000000000002', '$NOTES'::jsonb, null) ->> 'code';" | tail -1)"
check "D01-11 : la mission d'un AUTRE client est refusee" "NON_AUTORISE" \
  "$(d01_c1 "select public.evaluer_mission('e0030000-0000-4000-8000-000000000003', '$NOTES'::jsonb, null) ->> 'code';" | tail -1)"
check "D01-12 : une note hors bareme est refusee" "NOTES_INVALIDES" \
  "$(d01_c1 "select public.evaluer_mission('e0030000-0000-4000-8000-000000000001', '{\"ponctualite\":5,\"retard\":3,\"etat\":4,\"communication\":2,\"professionnalisme\":3,\"tenue\":1}'::jsonb, null) ->> 'code';" | tail -1)"
check "D01-13 : un critere manquant est refuse" "NOTES_INVALIDES" \
  "$(d01_c1 "select public.evaluer_mission('e0030000-0000-4000-8000-000000000001', '{\"ponctualite\":4}'::jsonb, null) ->> 'code';" | tail -1)"
check "D01-14 : un commentaire hostile ne casse rien et n'est pas interprete (stocke tel quel)" "ENREGISTREE|17" \
  "$(d01_c1 "with r as (select public.evaluer_mission('e0030000-0000-4000-8000-000000000001', '$NOTES'::jsonb, '<script>alert(1)</script> TEST-QA-CLAUDE-HELIXCAR') j) select (j->>'code')||'|'||(j->>'note_totale') from r;" | tail -1)"
check "D01-15 : le total est calcule par le serveur, jamais recu" "17|<script>alert(1)</script> TEST-QA-CLAUDE-HELIXCAR" \
  "$(sql "select note_totale||'|'||commentaire from public.evaluations where mission_id='e0030000-0000-4000-8000-000000000001';")"
check "D01-16 : une seconde evaluation de la meme mission est refusee (DEJA_EVALUEE), une seule ligne" "DEJA_EVALUEE|1" \
  "$(d01_c1 "select public.evaluer_mission('e0030000-0000-4000-8000-000000000001', '{\"ponctualite\":0,\"retard\":0,\"etat\":0,\"communication\":0,\"professionnalisme\":0,\"tenue\":0}'::jsonb, null) ->> 'code';
             select count(*) from public.evaluations where mission_id='e0030000-0000-4000-8000-000000000001';" | tail -2 | paste -sd'|')"
check "D01-17 : la vue du client dit desormais « evaluee » avec la note" "true|17" \
  "$(d01_c1 "select evaluee::text||'|'||evaluation_note from public.v_mes_missions where id='e0030000-0000-4000-8000-000000000001';" | tail -1)"
check "D01-18 : le client lit sa propre evaluation, pas celles des autres" "1" \
  "$(d01_c1 "select count(*) from public.evaluations;" | tail -1)"
check "D01-19 : le partenaire evalue lit l'evaluation qui le concerne" "1|17" \
  "$(d01_p1 "select count(*)||'|'||min(note_totale) from public.evaluations;" | tail -1)"
check "D01-20 : le client ne peut ni modifier ni supprimer son evaluation" "refuse|refuse" \
  "$(d01_c1 "update public.evaluations set note_totale = 20 where mission_id='e0030000-0000-4000-8000-000000000001';" 2>&1 | grep -q 'permission denied' && echo refuse)|$(d01_c1 "delete from public.evaluations where mission_id='e0030000-0000-4000-8000-000000000001';" 2>&1 | grep -q 'permission denied' && echo refuse)"
check "D01-21 : l'administrateur lit toutes les evaluations" "1" \
  "$(sqlAdmin "select count(*) from public.evaluations;" | tail -1)"
check "D01-22 : sans session, evaluer_mission repond NON_AUTHENTIFIE ou est refusee" "refuse" \
  "$(sql "begin; select public.devenir_anon(); select public.evaluer_mission('e0030000-0000-4000-8000-000000000001', '$NOTES'::jsonb, null) ->> 'code'; commit;" 2>&1 | grep -qE 'permission denied|NON_AUTHENTIFIE' && echo refuse)"
