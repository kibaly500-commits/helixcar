#!/usr/bin/env bash
# ============================================================
# LOT L01 — PROGRAMME DE FIDÉLITÉ EN POINTS (migration 109)
# ============================================================
# Sourcé par tests/t_rls.sh une fois les migrations 00 → 106 appliquées.
# Dispose de check(), sql(), sqlAdmin(), appliquer() et de $DB.
#
# Ce que ce fichier PROUVE, sur un PostgreSQL 16 réel :
#   * 109 s'applique, et se rejoue, sans erreur ;
#   * aucun point tant que la prestation n'est pas terminée ET payée,
#     quel que soit l'ordre des deux événements ;
#   * floor(prix) crédité UNE fois, un rejeu ne duplique rien ;
#   * remboursement total → une seule contrepassation ; partiel → aucun
#     point retiré, intention journalisée ;
#   * le navigateur (client, partenaire, anon) ne peut ni écrire le
#     registre, ni poser « payé », ni appeler la fonction de crédit ;
#   * un client ne lit que ses mouvements, l'administrateur tout, anon rien ;
#   * seuils 0 / 1 999 / 2 000 / 9 999 / 10 000 / 12 000 / 25 000.
#
# Jeux d'essai préfixés TEST-QA-CLAUDE-HELIXCAR. Jamais Supabase.

L01_A_UID=55555555-5555-5555-5555-555555555555 ; L01_A_MAIL=clientA@helixcar.test
L01_A_DEM=cccccccc-0000-0000-0000-00000000000a
L01_B_UID=66666666-6666-6666-6666-666666666666 ; L01_B_MAIL=clientB@helixcar.test
L01_B_DEM=cccccccc-0000-0000-0000-00000000000b
L01_ADM_UID=11111111-1111-1111-1111-111111111111 ; L01_ADM_MAIL=admin@helixcar.test
L01_PART_UID=22222222-2222-2222-2222-222222222222 ; L01_PART_MAIL=partenaire@helixcar.test
L01_DV_A1=f1de11e0-0000-4000-8000-00000000a001   # 1 234,56 € — le cas nominal
L01_DV_B1=f1de11e0-0000-4000-8000-00000000a002   # 300 € — terminé, jamais payé
L01_DV_A2=f1de11e0-0000-4000-8000-00000000a003   # 0,99 € — sous le premier euro
L01_DV_A3=f1de11e0-0000-4000-8000-00000000a004   # 500 € — remboursement partiel
L01_MI_A1=f1de11e0-0000-4000-8000-00000000b001
L01_MI_B1=f1de11e0-0000-4000-8000-00000000b002

# Dernière ligne d'une requête exécutée avec la session donnée.
l01_en_tant_que() { sql "begin; select public.devenir('$1','$2'); $3 commit;" | tail -1; }
l01_solde() { l01_en_tant_que "$1" "$2" "select public.fidelite_solde();"; }
# Une requête refusée ? On cherche le refus RÉEL dans la sortie de psql.
l01_refus() { printf '%s' "$1" | grep -qiE 'permission denied|row-level security|insufficient_privilege|réservé' && echo refus || echo passe; }

# ── 109 ──
errL01=$(appliquer migrations/109_fidelite_points.sql)
check "L01-001 : 109 s'applique sans erreur" "" "$errL01"
check "L01-001b : registre, vue, fonctions et déclencheurs créés" "1|1|1|1|1|1|1" \
  "$(sql "select (select count(*) from pg_tables where tablename='fidelite_mouvements')
 ||'|'||(select count(*) from pg_views where viewname='v_ma_fidelite')
 ||'|'||(select count(*) from pg_proc where proname='crediter_points_prestation')
 ||'|'||(select count(*) from pg_proc where proname='fidelite_prochain_palier')
 ||'|'||(select count(*) from pg_trigger where tgname='trg_fidelite_apres_maj_devis')
 ||'|'||(select count(*) from pg_trigger where tgname='trg_fidelite_apres_maj_mission')
 ||'|'||(select count(*) from pg_trigger where tgname='trg_garde_paiement_devis');")"

# Jeu d'essai : deux devis acceptés, deux missions à créer — rien de payé,
# rien de terminé. Écrit par le serveur (sans session), comme une migration.
sql "insert into public.devis (id, reference, client_id, prix, statut) values
  ('$L01_DV_A1','TEST-QA-CLAUDE-HELIXCAR-L01-DA1','$L01_A_DEM',1234.56,'accepte'),
  ('$L01_DV_B1','TEST-QA-CLAUDE-HELIXCAR-L01-DB1','$L01_B_DEM',300,'accepte')
  on conflict (id) do nothing;
insert into public.missions (id, client_id, reference, statut, type_mission) values
  ('$L01_MI_A1','$L01_A_DEM','TEST-QA-CLAUDE-HELIXCAR-L01-MA1','en_attente','convoyage'),
  ('$L01_MI_B1','$L01_B_DEM','TEST-QA-CLAUDE-HELIXCAR-L01-MB1','en_attente','convoyage')
  on conflict (id) do nothing;" >/dev/null

# ── AUCUN POINT SANS PRESTATION TERMINÉE ET PAYÉE ──
check "L01-002 : un compte sans prestation payée a 0 point (rien pour l'inscription ni la demande)" "0" \
  "$(l01_solde $L01_A_UID $L01_A_MAIL)"
check "L01-002b : sa vue dit 0 point, palier courant 0, prochain seuil 2 000, 2 000 restants" "0|0|2000|2000|Palier 1|false" \
  "$(l01_en_tant_que $L01_A_UID $L01_A_MAIL "select solde||'|'||palier_courant||'|'||prochain_seuil||'|'||points_restants||'|'||prochain_nom||'|'||box_mystere from public.v_ma_fidelite;")"
check "L01-003 : devis accepté mais NON payé → la fonction refuse (NON_PAYE) et 0 point" "NON_PAYE|0" \
  "$(sql "select (public.crediter_points_prestation('$L01_DV_A1')->>'code')||'|'||coalesce((select sum(points) from public.fidelite_mouvements where auth_user_id='$L01_A_UID'),0);")"

# Premier événement : le paiement (posé par le serveur, sans session).
sql "update public.devis set paiement_statut='paye', paiement_confirme_le=now() where id='$L01_DV_A1';" >/dev/null
check "L01-004 : payé mais mission NON terminée → 0 point (premier événement seul)" "0" \
  "$(l01_solde $L01_A_UID $L01_A_MAIL)"
check "L01-004b : la fonction le dit : NON_TERMINEE, 1 mission, 1 restante" "NON_TERMINEE|1|1" \
  "$(sql "select j->>'code'||'|'||(j->>'missions')||'|'||(j->>'restantes') from public.crediter_points_prestation('$L01_DV_A1') j;")"

# Client B : la mission se termine, le devis n'est jamais payé.
sql "update public.missions set statut='terminee' where id='$L01_MI_B1';" >/dev/null
check "L01-005 : mission terminée mais devis NON payé → 0 point" "0" \
  "$(l01_solde $L01_B_UID $L01_B_MAIL)"
check "L01-005b : aucun mouvement n'a été écrit pour le client B" "0" \
  "$(sql "select count(*) from public.fidelite_mouvements where auth_user_id='$L01_B_UID';")"

# Second événement pour A : la mission se termine (administrateur, comme
# dans le Dashboard — « terminee » est fermé aux partenaires par 97).
sql "begin; select public.devenir('$L01_ADM_UID','$L01_ADM_MAIL');
 update public.missions set statut='terminee' where id='$L01_MI_A1'; commit;" >/dev/null
check "L01-006 : payé ET terminé → floor(1 234,56) = 1 234 points, crédités au second événement" "1234" \
  "$(l01_solde $L01_A_UID $L01_A_MAIL)"
check "L01-006b : UN mouvement, motif prestation_payee, référence devis, tracé par l'administrateur" "1|prestation_payee|devis|$L01_DV_A1|$L01_ADM_UID" \
  "$(sql "select count(*)||'|'||min(motif)||'|'||min(reference_type)||'|'||min(reference_id::text)||'|'||min(cree_par::text)
     from public.fidelite_mouvements where auth_user_id='$L01_A_UID';")"
check "L01-006c : la clé de dédoublonnage est celle du devis" "devis:$L01_DV_A1:prestation_payee" \
  "$(sql "select cle_dedoublonnage from public.fidelite_mouvements where auth_user_id='$L01_A_UID';")"

# ── REJEU : AUCUN DOUBLON ──
sql "update public.devis set paiement_statut='en_attente' where id='$L01_DV_A1';
     update public.devis set paiement_statut='paye' where id='$L01_DV_A1';
     update public.missions set statut='terminee' where id='$L01_MI_A1';
     select public.crediter_points_prestation('$L01_DV_A1');" >/dev/null
check "L01-007 : rejouer le paiement, la fin de mission et la fonction ne crée AUCUN doublon" "1|1234" \
  "$(sql "select count(*)||'|'||sum(points) from public.fidelite_mouvements where auth_user_id='$L01_A_UID';")"
check "L01-007b : la fonction répond DEJA_CREDITE, 0 point" "DEJA_CREDITE|0" \
  "$(sql "select (j->>'code')||'|'||(j->>'points') from public.crediter_points_prestation('$L01_DV_A1') j;")"

# ── CENTIMES : floor(), et rien sous le premier euro ──
sql "insert into public.devis (id, reference, client_id, prix, statut) values
  ('$L01_DV_A2','TEST-QA-CLAUDE-HELIXCAR-L01-DA2','$L01_A_DEM',0.99,'accepte') on conflict (id) do nothing;
  update public.devis set paiement_statut='paye' where id='$L01_DV_A2';" >/dev/null
check "L01-008 : 0,99 € payé ne crédite rien (PRIX_ABSENT) ; le solde reste 1 234 (règle floor, documentée)" "PRIX_ABSENT|1234" \
  "$(sql "select (public.crediter_points_prestation('$L01_DV_A2')->>'code')||'|'||(select sum(points) from public.fidelite_mouvements where auth_user_id='$L01_A_UID');")"

# ── REMBOURSEMENT TOTAL : UNE contrepassation ──
sql "update public.devis set paiement_statut='rembourse' where id='$L01_DV_A1';" >/dev/null
check "L01-009 : remboursement total → un mouvement négatif de -1 234, solde 0" "-1234|remboursement|0" \
  "$(sql "select (select points||'|'||motif from public.fidelite_mouvements where cle_dedoublonnage='devis:$L01_DV_A1:contrepassation')
     ||'|'||(select sum(points) from public.fidelite_mouvements where auth_user_id='$L01_A_UID');")"
sql "update public.devis set paiement_statut='paye' where id='$L01_DV_A1';
     update public.devis set paiement_statut='rembourse' where id='$L01_DV_A1';
     update public.devis set annule_le=now() where id='$L01_DV_A1';" >/dev/null
check "L01-009b : rejeu du remboursement, puis annulation → toujours 2 mouvements, solde 0 (une seule fois)" "2|0" \
  "$(sql "select count(*)||'|'||sum(points) from public.fidelite_mouvements where reference_id='$L01_DV_A1';")"

# ── REMBOURSEMENT PARTIEL : BLOQUÉ, INTENTION JOURNALISÉE ──
sql "insert into public.devis (id, reference, client_id, prix, statut) values
  ('$L01_DV_A3','TEST-QA-CLAUDE-HELIXCAR-L01-DA3','$L01_A_DEM',500,'accepte') on conflict (id) do nothing;
  update public.devis set paiement_statut='paye' where id='$L01_DV_A3';" >/dev/null
check "L01-010 : un second devis payé sur la même prestation terminée crédite 500" "500" \
  "$(l01_solde $L01_A_UID $L01_A_MAIL)"
sql "update public.devis set paiement_statut='rembourse_partiel' where id='$L01_DV_A3';
     update public.devis set paiement_statut='paye' where id='$L01_DV_A3';
     update public.devis set paiement_statut='rembourse_partiel' where id='$L01_DV_A3';" >/dev/null
check "L01-010b : remboursement partiel → AUCUN point retiré (montant non défini), solde toujours 500" "500" \
  "$(l01_solde $L01_A_UID $L01_A_MAIL)"
check "L01-010c : l'intention d'ajustement est journalisée UNE fois, à 0 point, avec un détail explicite" "1|0|ajustement_admin|montant non défini" \
  "$(sql "select count(*)||'|'||min(points)||'|'||min(motif)||'|'||(case when min(detail) like '%montant non défini%' then 'montant non défini' else 'sans détail' end)
     from public.fidelite_mouvements where cle_dedoublonnage='devis:$L01_DV_A3:rembourse_partiel';")"

# ── LE NAVIGATEUR NE PEUT PAS ÉCRIRE ──
check "L01-011 : le client ne peut PAS insérer dans le registre" "refus|4" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     insert into public.fidelite_mouvements (auth_user_id, points, motif, cle_dedoublonnage)
     values ('$L01_A_UID', 99999, 'ajustement_admin', 'triche:1'); commit;")")|$(sql "select count(*) from public.fidelite_mouvements where auth_user_id='$L01_A_UID';")"
check "L01-012 : le client ne peut NI modifier NI supprimer ses mouvements" "refus|refus|4|500" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     update public.fidelite_mouvements set points=99999 where auth_user_id=auth.uid(); commit;")")|$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     delete from public.fidelite_mouvements where points < 0; commit;")")|$(sql "select count(*)||'|'||sum(points) from public.fidelite_mouvements where auth_user_id='$L01_A_UID';")"
check "L01-012b : l'administrateur non plus : aucune politique d'écriture, pour personne" "refus|refus" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_ADM_UID','$L01_ADM_MAIL');
     insert into public.fidelite_mouvements (auth_user_id, points, motif, cle_dedoublonnage)
     values ('$L01_A_UID', 1, 'ajustement_admin', 'admin-direct:1'); commit;")")|$(l01_refus "$(sql "begin; select public.devenir('$L01_ADM_UID','$L01_ADM_MAIL');
     update public.fidelite_mouvements set points=1 where auth_user_id='$L01_A_UID'; commit;")")"
check "L01-013 : le client ne peut PAS appeler la fonction de crédit ni la contrepassation" "refus|refus" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     select public.crediter_points_prestation('$L01_DV_A3'); commit;")")|$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     select public.fidelite_contrepasser_credit('$L01_DV_A3','remboursement'); commit;")")"
check "L01-013b : le client ne peut PAS poser « payé » sur son devis (garde-fou), l'état ne bouge pas" "refus|rembourse_partiel" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     update public.devis set paiement_statut='paye' where id='$L01_DV_A3'; commit;")")|$(sql "select paiement_statut from public.devis where id='$L01_DV_A3';")"
check "L01-013c : un partenaire ne peut PAS non plus poser « payé »" "refus" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_PART_UID','$L01_PART_MAIL');
     update public.devis set paiement_statut='paye' where id='$L01_DV_A3'; commit;")")"
check "L01-013d : le client ne peut PAS terminer sa mission lui-même (aucune ligne touchée)" "UPDATE 0" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; select public.devenir('$L01_B_UID','$L01_B_MAIL'); update public.missions set statut='terminee' where id='$L01_MI_B1'; commit;\"" 2>&1 | grep -E '^UPDATE')"
check "L01-013e : le client ne peut PAS s'ajuster des points (ajuster_points_admin exige est_admin)" "refus" \
  "$(l01_refus "$(sql "begin; select public.devenir('$L01_A_UID','$L01_A_MAIL');
     select public.ajuster_points_admin('$L01_A_UID', 5000, 'TEST-QA-CLAUDE-HELIXCAR triche'); commit;")")"

# ── CLOISONNEMENT DE LECTURE ──
check "L01-014 : le client A lit SES 4 mouvements, et seulement les siens" "4|4" \
  "$(l01_en_tant_que $L01_A_UID $L01_A_MAIL "select count(*)||'|'||count(*) filter (where auth_user_id='$L01_A_UID') from public.fidelite_mouvements;")"
check "L01-014b : le client B ne lit RIEN du client A" "0" \
  "$(l01_en_tant_que $L01_B_UID $L01_B_MAIL "select count(*) from public.fidelite_mouvements;")"
check "L01-014c : le client B voit sa propre vue à 0 point" "0|2000" \
  "$(l01_en_tant_que $L01_B_UID $L01_B_MAIL "select solde||'|'||prochain_seuil from public.v_ma_fidelite;")"
check "L01-014d : l'administrateur lit tout" "4" \
  "$(l01_en_tant_que $L01_ADM_UID $L01_ADM_MAIL "select count(*) from public.fidelite_mouvements;")"
check "L01-014e : un partenaire ne lit rien" "0" \
  "$(l01_en_tant_que $L01_PART_UID $L01_PART_MAIL "select count(*) from public.fidelite_mouvements;")"
L01_ANON_T=$(sql "begin; select public.devenir_anon(); select count(*) from public.fidelite_mouvements; commit;")
L01_ANON_V=$(sql "begin; select public.devenir_anon(); select count(*) from public.v_ma_fidelite; commit;")
L01_ANON_F=$(sql "begin; select public.devenir_anon(); select public.fidelite_solde(); commit;")
L01_ANON_P=$(sql "begin; select public.devenir_anon(); select public.fidelite_prochain_palier(2000); commit;")
check "L01-015 : anon n'a AUCUN droit — registre, vue, solde, seuils" "refus|refus|refus|refus" \
  "$(l01_refus "$L01_ANON_T")|$(l01_refus "$L01_ANON_V")|$(l01_refus "$L01_ANON_F")|$(l01_refus "$L01_ANON_P")"
check "L01-015b : aucun privilège de table accordé à anon, seul SELECT à authenticated" "authenticated:SELECT" \
  "$(sql "select string_agg(grantee||':'||privilege_type, ',' order by grantee, privilege_type)
     from information_schema.role_table_grants
     where table_schema='public' and table_name='fidelite_mouvements' and grantee in ('anon','authenticated');")"
check "L01-015c : deux politiques de lecture, aucune d'écriture" "2|0" \
  "$(sql "select count(*) filter (where cmd='SELECT')||'|'||count(*) filter (where cmd<>'SELECT') from pg_policies where tablename='fidelite_mouvements';")"

# ── SEUILS ──
check "L01-016 : seuils 0 / 1 999 / 2 000 / 9 999 / 10 000 / 12 000 / 25 000" \
  "0|0|2000|2000|false|0;1999|0|2000|1|false|0;2000|2000|4000|2000|false|0;9999|8000|10000|1|false|0;10000|10000|12000|2000|true|0;12000|12000|14000|2000|true|1;25000|24000|26000|1000|true|7" \
  "$(sql "select string_agg((j->>'solde')||'|'||(j->>'palier_courant')||'|'||(j->>'prochain_seuil')||'|'||(j->>'points_restants')||'|'||(j->>'box_mystere')||'|'||(j->>'boxes_mystere_acquises'), ';' order by s)
     from unnest(array[0,1999,2000,9999,10000,12000,25000]) s, lateral public.fidelite_prochain_palier(s) j;")"
check "L01-016b : les noms — Palier 1 à 5 jusqu'à 10 000, Box mystère au-delà, jamais « Entreprise »" \
  "-|Palier 1;Palier 4|Palier 5;Palier 5|Box mystère;Box mystère|Box mystère;Box mystère|Box mystère" \
  "$(sql "select string_agg(coalesce(j->>'palier_courant_nom','-')||'|'||(j->>'prochain_nom'), ';' order by s)
     from unnest(array[0,9999,10000,12000,25000]) s, lateral public.fidelite_prochain_palier(s) j;")"
check "L01-016c : la fonction est immuable (utilisable dans une vue, un index)" "i" \
  "$(sql "select provolatile from pg_proc where proname='fidelite_prochain_palier';")"

# ── LA VUE DU CLIENT SUIT LE REGISTRE ──
check "L01-017 : v_ma_fidelite du client A = somme réelle (500), Palier 1 à 1 500 points, 4 mouvements" "500|0|2000|1500|Palier 1|false|4" \
  "$(l01_en_tant_que $L01_A_UID $L01_A_MAIL "select solde||'|'||palier_courant||'|'||prochain_seuil||'|'||points_restants||'|'||prochain_nom||'|'||box_mystere||'|'||nb_mouvements from public.v_ma_fidelite;")"
check "L01-017b : un ajustement administrateur (motif obligatoire) est enregistré et idempotent" "AJUSTE|2000|DEJA_AJUSTE|2000" \
  "$(sql "begin; select public.devenir('$L01_ADM_UID','$L01_ADM_MAIL');
     select (j->>'code')||'|'||(j->>'solde') from public.ajuster_points_admin('$L01_A_UID', 1500, 'TEST-QA-CLAUDE-HELIXCAR geste commercial', null, 'geste-1') j;
     select (j->>'code')||'|'||(j->>'solde') from public.ajuster_points_admin('$L01_A_UID', 1500, 'TEST-QA-CLAUDE-HELIXCAR geste commercial', null, 'geste-1') j;
     commit;" | grep -v '^$' | paste -sd'|')"
check "L01-017c : un ajustement sans motif est refusé" "1" \
  "$(sql "begin; select public.devenir('$L01_ADM_UID','$L01_ADM_MAIL');
     select public.ajuster_points_admin('$L01_A_UID', 10, '   '); commit;" | grep -c 'motif de l' || true)"
check "L01-017d : la vue reflète l'ajustement : 2 000 points = Palier 1 atteint, prochain Palier 2" "2000|2000|Palier 1|4000|Palier 2|2000" \
  "$(l01_en_tant_que $L01_A_UID $L01_A_MAIL "select solde||'|'||palier_courant||'|'||palier_courant_nom||'|'||prochain_seuil||'|'||prochain_nom||'|'||points_restants from public.v_ma_fidelite;")"

# ── IDEMPOTENCE DE 109 ──
errL01b=$(appliquer migrations/109_fidelite_points.sql)
check "L01-018 : 109 se rejoue sans erreur" "" "$errL01b"
check "L01-018b : toujours un seul déclencheur de chaque, deux politiques, et le registre intact" "1|1|1|2|5" \
  "$(sql "select (select count(*) from pg_trigger where tgname='trg_fidelite_apres_maj_devis')
 ||'|'||(select count(*) from pg_trigger where tgname='trg_fidelite_apres_maj_mission')
 ||'|'||(select count(*) from pg_trigger where tgname='trg_garde_paiement_devis')
 ||'|'||(select count(*) from pg_policies where tablename='fidelite_mouvements')
 ||'|'||(select count(*) from public.fidelite_mouvements where auth_user_id='$L01_A_UID');")"
check "L01-018c : aucun objet de paiement (Stripe) ni kilomètre introduit par 109" "0" \
  "$(sql "select count(*) from information_schema.columns where table_name='fidelite_mouvements' and (column_name ilike '%stripe%' or column_name ilike '%km%');")"
