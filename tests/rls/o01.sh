# ============================================================
# LOT O01 — OPPORTUNITÉS DE MISSIONS, CANDIDATURES, ATTRIBUTION N/N
# ============================================================
# Exécuté par tests/t_rls.sh après toutes ses sections : la base porte
# déjà les migrations 00 à 106. Ce fichier applique migrations/108 et
# observe le comportement RÉEL des politiques et des fonctions.
#
# Jeux d'essai préfixés TEST-QA-CLAUDE-HELIXCAR, identités en .test.
# Aucune connexion à Supabase, aucun e-mail.
#
# Identités propres au lot (UUID v4 syntaxiquement valides) :
#   a0010000-0000-4000-8000-0000000000NN  : auth.users des partenaires
#   c0010000-0000-4000-8000-0000000000NN  : leurs fiches convoyeurs
#   a0010000-0000-4000-8000-0000000000c1  : un compte CLIENT seul
#   d0010000-0000-4000-8000-0000000000NN  : demandes (clients)
#   e0010000-0000-4000-8000-0000000000NN  : missions

ADM="select public.devenir('11111111-1111-1111-1111-111111111111','admin@helixcar.test');"
o01_uid() { printf 'a0010000-0000-4000-8000-0000000000%02d' "$1"; }
o01_conv() { printf 'c0010000-0000-4000-8000-0000000000%02d' "$1"; }
# Session d'un partenaire du lot : $1 = numéro, $2 = SQL.
o01_part() {
  sql "begin; select public.devenir('$(o01_uid "$1")','o01p$1@helixcar.test');
$2
commit;" | tail -n +2
}
o01_client() {
  sql "begin; select public.devenir('a0010000-0000-4000-8000-0000000000c1','o01client@helixcar.test');
$1
commit;" | tail -n +2
}

# ── Jeu d'essai : 14 partenaires, un client seul, deux demandes ──
#  P1  convoyage validé                 P2  nettoyage validé seulement
#  P3  convoyage ET nettoyage validés   P4  convoyage validé mais BLOQUÉ
#  P5  actif, connecté, NON validé (C06)
#  P6..P14  convoyage validé (pour le 9 sur 9)
#  P15 convoyage validé, ne postule JAMAIS (témoin après clôture)
sql "insert into auth.users (id, email, email_confirmed_at)
     select ('a0010000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
            'o01p' || g || '@helixcar.test', now()
       from generate_series(1, 15) g
     on conflict (id) do nothing;
     insert into auth.users (id, email, email_confirmed_at) values
       ('a0010000-0000-4000-8000-0000000000c1', 'o01client@helixcar.test', now())
     on conflict (id) do nothing;
     insert into public.convoyeurs (id, auth_user_id, prenom, nom, email, activites, statut, bloque)
     select ('c0010000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
            ('a0010000-0000-4000-8000-0000000000' || lpad(g::text, 2, '0'))::uuid,
            'TEST-QA-CLAUDE-HELIXCAR', 'O01-P' || g, 'o01p' || g || '@helixcar.test',
            case when g = 2 then '{nettoyage}'::text[]
                 when g = 3 then '{convoyage,nettoyage}'::text[]
                 else '{convoyage}'::text[] end,
            'actif', (g = 4)
       from generate_series(1, 15) g
     on conflict (id) do nothing;
     -- Décisions : la migration 04 amorce en_attente ; on décide ici
     -- comme un administrateur l'aurait fait. P5 reste en attente.
     insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
     select c.id, a, case when c.nom = 'O01-P5' then 'en_attente' else 'oui' end
       from public.convoyeurs c cross join lateral unnest(c.activites) a
      where c.nom like 'O01-P%'
     on conflict (convoyeur_id, activite) do update set decision = excluded.decision;
     -- Un compte client SEUL : une demande rattachée, aucune fiche partenaire.
     insert into public.clients (id, auth_user_id, numero_client, email, prenom, nom, type_service, statut, professionnel_details)
     values ('d0010000-0000-4000-8000-0000000000c1', 'a0010000-0000-4000-8000-0000000000c1',
             'TEST-QA-CLAUDE-HELIXCAR-O01-C', 'o01client@helixcar.test', 'TEST-QA', 'ClientSeul',
             'professionnel', 'nouveau', '{\"nombre_professionnels\": 9}'::jsonb)
     on conflict (id) do nothing;
     insert into public.clients (id, numero_client, email, prenom, nom, type_service, statut, professionnel_details)
     values ('d0010000-0000-4000-8000-000000000002', 'TEST-QA-CLAUDE-HELIXCAR-O01-D2',
             'o01d2@helixcar.test', 'TEST-QA', 'DemandeDeux', 'professionnel', 'nouveau',
             '{\"nombre_professionnels\": 2}'::jsonb)
     on conflict (id) do nothing;" >/dev/null

# ── 1. APPLICATION ──
errO=$(appliquer migrations/108_opportunites_missions.sql)
check "O01-1 : migrations/108 s'applique sans erreur" "" "$errO"
check "O01-2 : les trois tables existent et sont sous RLS" "3|3" \
  "$(sql "select (select count(*) from pg_tables where schemaname='public' and tablename in ('opportunites','opportunite_candidatures','opportunite_notifications'))
          ||'|'||(select count(*) from pg_tables where schemaname='public' and tablename like 'opportunite%' and rowsecurity);")"
check "O01-3 : deux états publics seulement — jamais « partiellement pourvue » (C03)" "brouillon,a_pourvoir,pourvue" \
  "$(sql "select string_agg(m[1], ',') from pg_constraint con,
            regexp_matches(pg_get_constraintdef(con.oid), '''([a-z_]+)''', 'g') m
           where con.conrelid='public.opportunites'::regclass and con.contype='c'
             and pg_get_constraintdef(con.oid) like '%statut%';")"
check "O01-4 : aucun privilège de table pour anon" "0" \
  "$(sql "select count(*) from information_schema.role_table_grants
           where grantee='anon' and (table_name like 'opportunite%' or table_name like 'v_opportunites%');")"
check "O01-5 : aucun privilège de fonction pour anon" "0" \
  "$(sql "select count(*) from information_schema.role_routine_grants
           where grantee='anon' and routine_name in ('publier_opportunite','decider_candidature','postuler_opportunite',
                 'modifier_opportunite','creer_brouillon_opportunite','activites_validees_partenaire','convoyeur_de_session');")"
check "O01-6 : une seule signature par fonction (aucune ambiguïté PostgREST)" "5" \
  "$(sql "select count(*) from pg_proc where proname in ('publier_opportunite','decider_candidature','postuler_opportunite','modifier_opportunite','creer_brouillon_opportunite');")"

# ── 2. LE BROUILLON AUTOMATIQUE ──
# Les missions sont créées sans session (uid nul : SQL Editor / seed),
# exactement comme le verrou de 97 l'accepte.
sql "insert into public.missions (id, reference, type_mission, statut, client_id, ville_depart, ville_arrivee, distance_km)
     values ('e0010000-0000-4000-8000-000000000001', 'TEST-QA-CLAUDE-HELIXCAR-O01-M1', 'convoyage', 'en_attente',
             'd0010000-0000-4000-8000-0000000000c1', 'Paris', 'Lyon', 465);
     insert into public.missions (id, reference, type_mission, statut, prestation, nb_vehicules,
                                  adresse_intervention, code_postal_intervention, ville_intervention,
                                  contact_nom, contact_tel, date_intervention, date_fin_intervention,
                                  heure_intervention, consignes)
     values ('e0010000-0000-4000-8000-000000000002', 'TEST-QA-CLAUDE-HELIXCAR-O01-M2', 'nettoyage', 'en_attente',
             'Nettoyage intérieur et extérieur', 12, '3 rue des Lilas', '69003', 'Lyon',
             'TEST-QA Martin', '+33600000020', '2026-11-02', '2026-11-04', '09:00 – 17:00',
             'Appeler Jean au 06 12 34 56 78 ou jean.martin@exemple.fr. Accès par le 12 rue des Lilas, 69003 Lyon. Badges au gardien.');
     insert into public.missions (id, reference, type_mission, statut, client_id, ville_depart, ville_arrivee)
     values ('e0010000-0000-4000-8000-000000000003', 'TEST-QA-CLAUDE-HELIXCAR-O01-M3', 'convoyage', 'en_attente',
             'd0010000-0000-4000-8000-000000000002', 'Lille', 'Nantes');" >/dev/null
check "O01-7 : chaque mission créée reçoit UN brouillon, jamais publié" "3|3|0" \
  "$(sql "select (select count(*) from public.opportunites where mission_id in ('e0010000-0000-4000-8000-000000000001','e0010000-0000-4000-8000-000000000002','e0010000-0000-4000-8000-000000000003'))
          ||'|'||(select count(*) from public.opportunites where statut='brouillon' and mission_id::text like 'e0010000-%')
          ||'|'||(select count(*) from public.opportunites where statut<>'brouillon' and mission_id::text like 'e0010000-%');")"
check "O01-8 : le brouillon convoyage est prérempli (catégorie, zone générale, badge, N depuis la demande)" "convoyage|Paris → Lyon|{convoyage}|9|465 km" \
  "$(sql "select categorie||'|'||zone_generale||'|'||badges_requis::text||'|'||nb_professionnels||'|'||duree_texte
            from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000001';")"
check "O01-9 : le brouillon nettoyage porte la période et la zone (ville + département), jamais l'adresse" "nettoyage|Lyon (69)|2026-11-02|2026-11-04|1" \
  "$(sql "select categorie||'|'||zone_generale||'|'||date_debut||'|'||date_fin||'|'||nb_professionnels
            from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000002';")"
DESC2=$(sql "select description_publique from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000002';")
check "O01-10 : la description ne contient ni e-mail, ni téléphone, ni adresse exacte" "propre" \
  "$(printf '%s' "$DESC2" | grep -qiE '@|06 12|0612|rue des Lilas|Lilas|\+33' && echo "fuite: $DESC2" || echo propre)"
check "O01-11 : mais garde le résumé utile (prestation, parc, consignes expurgées)" "oui" \
  "$(printf '%s' "$DESC2" | grep -q 'Nettoyage intérieur et extérieur' && printf '%s' "$DESC2" | grep -q '12 véhicule' \
     && printf '%s' "$DESC2" | grep -q 'Badges au gardien' && printf '%s' "$DESC2" | grep -q 'retiré' && echo oui || echo "non: $DESC2")"
check "O01-12 : le filtre de coordonnées, seul, sur des cas variés" "[e-mail retiré] / [téléphone retiré] / [téléphone retiré] / [adresse retirée], 75001 Paris / le 12/10/2026 à 9h" \
  "$(sql "select public.hc_sans_coordonnees('a.b-c@exemple.fr / +33 6 12 34 56 78 / 06.12.34.56.78 / 12 bis avenue de la Gare, 75001 Paris / le 12/10/2026 à 9h');")"
check "O01-13 : creer_brouillon_opportunite est idempotente (DEJA_CREE, toujours 1 ligne)" "DEJA_CREE|1" \
  "$(sqlAdmin "select (public.creer_brouillon_opportunite('e0010000-0000-4000-8000-000000000001') ->> 'code')
               ||'|'||(select count(*) from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000001');" | tail -1)"
check "O01-14 : un partenaire ne crée pas de brouillon" "NON_AUTORISE" \
  "$(o01_part 1 "select public.creer_brouillon_opportunite('e0010000-0000-4000-8000-000000000003') ->> 'code';" | tail -1)"

OPP1=$(sql "select id from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000001';")
OPP2=$(sql "select id from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000002';")
OPP3=$(sql "select id from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000003';")

# ── 3. PUBLICATION ──
check "O01-15 : un partenaire ne publie pas" "NON_AUTORISE" \
  "$(o01_part 1 "select public.publier_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-16 : un compte client seul ne publie pas" "NON_AUTORISE" \
  "$(o01_client "select public.publier_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-17 : anon ne peut même pas appeler la fonction" "refuse" \
  "$(sql "begin; select public.devenir_anon(); select public.publier_opportunite('$OPP1'); commit;" | grep -qiE 'permission denied' && echo refuse || echo passe)"
check "O01-18 : publication refusée sans description" "MODIFIEE|DESCRIPTION_VIDE" \
  "$(sqlAdmin "select (public.modifier_opportunite('$OPP1', '{\"description_publique\": \"\"}'::jsonb) ->> 'code')
               ||'|'||(public.publier_opportunite('$OPP1') ->> 'code');" | tail -1)"
check "O01-19 : un nombre de professionnels < 1 est refusé à la modification" "NB_PROFESSIONNELS_INVALIDE|9" \
  "$(sqlAdmin "select (public.modifier_opportunite('$OPP1', '{\"nb_professionnels\": 0}'::jsonb) ->> 'code')
               ||'|'||(select nb_professionnels from public.opportunites where id='$OPP1');" | tail -1)"
check "O01-20 : la description modifiée est elle aussi expurgée" "Convoyage groupé, contact [téléphone retiré]" \
  "$(sqlAdmin "select public.modifier_opportunite('$OPP1', '{\"description_publique\": \"Convoyage groupé, contact 06 11 22 33 44\"}'::jsonb) ->> 'code';
               select description_publique from public.opportunites where id='$OPP1';" | tail -1)"
check "O01-21 : aucune opportunité publiée avant l'action de l'administrateur" "0" \
  "$(sql "select count(*) from public.opportunites where statut='a_pourvoir';")"
# Un même ordre SQL lit un seul instantané : l'effet de la fonction se
# constate dans l'ordre SUIVANT, comme le ferait le Dashboard.
check "O01-22 : l'administrateur publie (brouillon → À pourvoir, publiee_le posé)" "PUBLIEE|a_pourvoir|1" \
  "$(sqlAdmin "select public.publier_opportunite('$OPP1') ->> 'code';" | tail -1)|$(sql "select statut||'|'||(select count(*) from public.opportunites where id='$OPP1' and publiee_le is not null) from public.opportunites where id='$OPP1';")"
check "O01-23 : publier est idempotente" "DEJA_PUBLIEE" \
  "$(sqlAdmin "select public.publier_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-24 : E-MAIL MANQUANT « publiée » — une intention par partenaire éligible (12 du lot), jamais un envoi" "12|true|0" \
  "$(sql "select (select count(*) from public.opportunite_notifications where opportunite_id='$OPP1' and evenement='publiee' and etat='a_envoyer' and destinataire_role='partenaire' and convoyeur_id::text like 'c0010000-%')
          ||'|'||((select count(*) from public.opportunite_notifications where opportunite_id='$OPP1' and evenement='publiee')
                  = (select count(*) from public.convoyeurs c where c.statut is distinct from 'refuse' and coalesce(c.bloque,false)=false
                       and exists (select 1 from public.convoyeur_decisions d where d.convoyeur_id=c.id and d.decision='oui' and d.activite='convoyage')))
          ||'|'||(select count(*) from public.opportunite_notifications where etat<>'a_envoyer');")"
check "O01-25 : ni le partenaire bloqué, ni le non validé, ni le mauvais badge ne sont notifiés" "0" \
  "$(sql "select count(*) from public.opportunite_notifications
           where opportunite_id='$OPP1' and convoyeur_id in ('$(o01_conv 2)','$(o01_conv 4)','$(o01_conv 5)');")"
check "O01-26 : une opportunité publiée ne se modifie plus (fonction ET écriture directe)" "DEJA_PUBLIEE|refuse" \
  "$(sqlAdmin "select public.modifier_opportunite('$OPP1', '{\"intitule\": \"x\"}'::jsonb) ->> 'code';" | tail -1)|$(sql "begin; $ADM update public.opportunites set intitule='pirate' where id='$OPP1'; commit;" | grep -qiE 'ne se modifie plus|insufficient' && echo refuse || echo passe)"
check "O01-27 : l'état ne se change jamais à la main, même par un administrateur" "refuse|a_pourvoir" \
  "$(sql "begin; $ADM update public.opportunites set statut='pourvue' where id='$OPP1'; commit;" | grep -qiE 'ne change que par|insufficient' && echo refuse || echo passe)|$(sql "select statut from public.opportunites where id='$OPP1';")"
check "O01-28 : un brouillon, lui, se corrige directement par l'administrateur" "UPDATE 1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; $ADM update public.opportunites set intitule='Convoyage — Lille → Nantes (relu)' where id='$OPP3'; commit;\"" 2>&1 | grep -E '^UPDATE')"

# ── 4. ÉLIGIBILITÉ ET CONFIDENTIALITÉ (vue partenaire) ──
check "O01-29 : bon badge → l'opportunité est visible" "1" "$(o01_part 1 "select count(*) from public.v_opportunites_partenaire;" | tail -1)"
check "O01-30 : mauvais badge (nettoyage seul) → rien" "0" "$(o01_part 2 "select count(*) from public.v_opportunites_partenaire;" | tail -1)"
check "O01-31 : multibadge → visible" "1" "$(o01_part 3 "select count(*) from public.v_opportunites_partenaire;" | tail -1)"
check "O01-32 : partenaire bloqué → rien, même avec le bon badge" "0" "$(o01_part 4 "select count(*) from public.v_opportunites_partenaire;" | tail -1)"
check "O01-33 : connecté mais NON validé → rien (C06 : la connexion ne vaut pas validation)" "0" "$(o01_part 5 "select count(*) from public.v_opportunites_partenaire;" | tail -1)"
check "O01-34 : compte client seul → vue vide, table invisible" "0|0" \
  "$(o01_client "select (select count(*) from public.v_opportunites_partenaire)||'|'||(select count(*) from public.opportunites);" | tail -1)"
check "O01-35 : anon → refus pur et simple" "refuse" \
  "$(sql "begin; select public.devenir_anon(); select count(*) from public.v_opportunites_partenaire; commit;" | grep -qiE 'permission denied' && echo refuse || echo passe)"
check "O01-36 : le brouillon n'apparaît à AUCUN partenaire" "0" \
  "$(o01_part 2 "select count(*) from public.v_opportunites_partenaire where id='$OPP2';" | tail -1)"
check "O01-37 : la vue n'expose ni mission, ni client, ni nom, ni e-mail, ni téléphone, ni adresse" "0" \
  "$(sql "select count(*) from information_schema.columns where table_name='v_opportunites_partenaire'
           and (column_name in ('mission_id','client_id','created_by') or column_name ~ '(nom|email|telephone|adresse|contact|prix|remuneration)');")"
check "O01-38 : un partenaire ne lit RIEN directement dans les tables" "0|0|0" \
  "$(o01_part 1 "select (select count(*) from public.opportunites)||'|'||(select count(*) from public.opportunite_candidatures)||'|'||(select count(*) from public.opportunite_notifications);" | tail -1)"
check "O01-39 : l'administrateur voit les compteurs serveur du pipeline" "0|0|0|0|9" \
  "$(sqlAdmin "select nb_a_etudier||'|'||nb_preselectionnes||'|'||nb_retenus||'|'||nb_non_retenus||'|'||nb_professionnels from public.v_opportunites_admin where id='$OPP1';" | tail -1)"
check "O01-40 : la vue administrateur est vide pour un partenaire et pour un client" "0|0" \
  "$(o01_part 1 "select count(*) from public.v_opportunites_admin;" | tail -1)|$(o01_client "select count(*) from public.v_opportunites_admin;" | tail -1)"

# ── 5. CANDIDATURES ──
check "O01-41 : un partenaire éligible postule" "CANDIDATURE_ENREGISTREE|a_etudier" \
  "$(o01_part 1 "select (f.j ->> 'code')||'|'||(f.j ->> 'etat') from public.postuler_opportunite('$OPP1') as f(j);" | tail -1)"
check "O01-42 : candidature unique — le second appel répond DEJA_CANDIDAT et n'écrit rien" "DEJA_CANDIDAT|1" \
  "$(o01_part 1 "select (public.postuler_opportunite('$OPP1') ->> 'code')||'|'||(select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1' and convoyeur_id='$(o01_conv 1)');" | tail -1)"
check "O01-43 : il voit l'état de SA candidature dans la vue" "a_etudier" \
  "$(o01_part 1 "select ma_candidature_etat from public.v_opportunites_partenaire where id='$OPP1';" | tail -1)"
check "O01-44 : mauvais badge → NON_ELIGIBLE" "NON_ELIGIBLE" "$(o01_part 2 "select public.postuler_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-45 : bloqué → NON_AUTORISE" "NON_AUTORISE" "$(o01_part 4 "select public.postuler_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-46 : non validé → NON_VALIDE (C06)" "NON_VALIDE" "$(o01_part 5 "select public.postuler_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-47 : compte client seul → NON_AUTORISE" "NON_AUTORISE" "$(o01_client "select public.postuler_opportunite('$OPP1') ->> 'code';" | tail -1)"
check "O01-48 : un brouillon n'existe pas pour un partenaire (INTROUVABLE)" "INTROUVABLE" "$(o01_part 2 "select public.postuler_opportunite('$OPP2') ->> 'code';" | tail -1)"
check "O01-49 : anon ne peut pas postuler" "refuse" \
  "$(sql "begin; select public.devenir_anon(); select public.postuler_opportunite('$OPP1'); commit;" | grep -qiE 'permission denied' && echo refuse || echo passe)"
check "O01-50 : aucune écriture directe d'un partenaire dans les candidatures" "refuse|1" \
  "$(o01_part 3 "insert into public.opportunite_candidatures (opportunite_id, convoyeur_id) values ('$OPP1','$(o01_conv 3)');" | grep -qiE 'permission denied|row-level security|postuler_opportunite' && echo refuse || echo passe)|$(sql "select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1';")"
check "O01-51 : l'administrateur non plus ne change pas un état à la main (session, puis SQL Editor)" "refuse|refuse|a_etudier" \
  "$(sql "begin; $ADM update public.opportunite_candidatures set etat='retenu' where opportunite_id='$OPP1'; commit;" | grep -qiE 'decider_candidature|insufficient|permission denied' && echo refuse || echo passe)|$(sql "update public.opportunite_candidatures set etat='retenu' where opportunite_id='$OPP1';" | grep -qiE 'decider_candidature' && echo refuse || echo passe)|$(sql "select etat from public.opportunite_candidatures where opportunite_id='$OPP1' and convoyeur_id='$(o01_conv 1)';")"
# Les autres partenaires éligibles postulent : P3, P6..P14 (10 de plus, 11 au total).
for g in 3 6 7 8 9 10 11 12 13 14; do o01_part $g "select public.postuler_opportunite('$OPP1');" >/dev/null; done
check "O01-52 : onze candidatures, et un partenaire ne voit que la sienne" "11|1|1" \
  "$(sql "select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1';")|$(o01_part 1 "select count(*) from public.opportunite_candidatures;" | tail -1)|$(o01_part 3 "select count(*) from public.opportunite_candidatures where convoyeur_id='$(o01_conv 3)';" | tail -1)"

# ── 6. DÉCISIONS, 6 SUR 9, 9 SUR 9 — CLÔTURE ATOMIQUE (C03) ──
CAND() { sql "select id from public.opportunite_candidatures where opportunite_id='$1' and convoyeur_id='$(o01_conv $2)';"; }
check "O01-53 : un partenaire ne décide pas" "NON_AUTORISE" \
  "$(o01_part 1 "select public.decider_candidature('$(CAND $OPP1 1)', 'retenu') ->> 'code';" | tail -1)"
check "O01-54 : un état inconnu est refusé" "ETAT_INVALIDE" \
  "$(sqlAdmin "select public.decider_candidature('$(CAND $OPP1 1)', 'partiellement_pourvue') ->> 'code';" | tail -1)"
check "O01-55 : présélection puis sélection du premier : 1 sur 9, toujours À pourvoir" "DECIDEE|DECIDEE|1|9|a_pourvoir" \
  "$(sqlAdmin "select (public.decider_candidature('$(CAND $OPP1 1)', 'preselectionne') ->> 'code');
               select f.j->>'code'||'|'||(f.j->>'retenus')||'|'||(f.j->>'requis')||'|'||(f.j->>'statut')
                 from public.decider_candidature('$(CAND $OPP1 1)', 'retenu') as f(j);" | tail -2 | paste -sd'|')"
check "O01-56 : une candidature déjà retenue ne l'est pas deux fois" "DEJA_RETENU|1" \
  "$(sqlAdmin "select f.j->>'code'||'|'||(f.j->>'retenus') from public.decider_candidature('$(CAND $OPP1 1)', 'retenu') as f(j);" | tail -1)"
check "O01-57 : le partenaire voit « retenu » sur sa candidature, et rien des autres" "retenu|1" \
  "$(o01_part 1 "select ma_candidature_etat||'|'||(select count(*) from public.opportunite_candidatures) from public.v_opportunites_partenaire where id='$OPP1';" | tail -1)"
for g in 3 6 7 8 9; do sqlAdmin "select public.decider_candidature('$(CAND $OPP1 $g)', 'retenu');" >/dev/null; done
check "O01-58 : 6 retenus sur 9 → l'opportunité reste « À pourvoir » (jamais « partiellement pourvue »)" "6|9|a_pourvoir|" \
  "$(sql "select (select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1' and etat='retenu')||'|'||nb_professionnels||'|'||statut||'|'||coalesce(cloturee_le::text,'') from public.opportunites where id='$OPP1';")"
check "O01-59 : un non-retenu explicite est journalisé comme E-MAIL MANQUANT « non retenu »" "DECIDEE|1" \
  "$(sqlAdmin "select public.decider_candidature('$(CAND $OPP1 14)', 'non_retenu') ->> 'code';" | tail -1)|$(sql "select count(*) from public.opportunite_notifications where opportunite_id='$OPP1' and evenement='non_retenu' and convoyeur_id='$(o01_conv 14)' and etat='a_envoyer';")"
sqlAdmin "select public.decider_candidature('$(CAND $OPP1 10)', 'retenu'); select public.decider_candidature('$(CAND $OPP1 11)', 'retenu');" >/dev/null
check "O01-60 : 8 sur 9 : encore À pourvoir, le client n'est PAS encore prévenu" "8|a_pourvoir|0" \
  "$(sql "select (select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1' and etat='retenu')||'|'||statut||'|'||(select count(*) from public.opportunite_notifications where opportunite_id='$OPP1' and evenement='pourvue_client') from public.opportunites where id='$OPP1';")"
check "O01-61 : la 9e sélection CLÔTURE dans la même transaction (POURVUE, cloturee_le, 9 sur 9)" "POURVUE|9|9|pourvue|1" \
  "$(sqlAdmin "select f.j->>'code'||'|'||(f.j->>'retenus')||'|'||(f.j->>'requis')||'|'||(f.j->>'statut')
                 from public.decider_candidature('$(CAND $OPP1 12)', 'retenu') as f(j);" | tail -1)|$(sql "select count(*) from public.opportunites where id='$OPP1' and statut='pourvue' and cloturee_le is not null;")"
check "O01-62 : E-MAILS MANQUANTS — 9 « retenu » et UN SEUL « besoin entièrement pourvu » (client), tous a_envoyer" "9|1|0" \
  "$(sql "select (select count(*) from public.opportunite_notifications where opportunite_id='$OPP1' and evenement='retenu')
          ||'|'||(select count(*) from public.opportunite_notifications where opportunite_id='$OPP1' and evenement='pourvue_client' and destinataire_role='client')
          ||'|'||(select count(*) from public.opportunite_notifications where etat<>'a_envoyer');")"
check "O01-63 : N+1 refusé — PLACES_EPUISEES, toujours 9 retenus" "PLACES_EPUISEES|9|9|pourvue|9" \
  "$(sqlAdmin "select f.j->>'code'||'|'||(f.j->>'retenus')||'|'||(f.j->>'requis')||'|'||(f.j->>'statut')||'|'||(select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1' and etat='retenu')
                 from public.decider_candidature('$(CAND $OPP1 13)', 'retenu') as f(j);" | tail -1)"
check "O01-64 : une opportunité pourvue ne bouge plus pour les autres candidatures" "CLOTUREE" \
  "$(sqlAdmin "select public.decider_candidature('$(CAND $OPP1 13)', 'preselectionne') ->> 'code';" | tail -1)"
check "O01-65 : plus personne ne postule après la clôture (CLOTUREE), rien n'est écrit" "CLOTUREE|11" \
  "$(o01_part 15 "select public.postuler_opportunite('$OPP1') ->> 'code';" | tail -1)|$(sql "select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1';")"
check "O01-66 : la candidature retenue reste visible du partenaire après clôture" "retenu|pourvue" \
  "$(o01_part 1 "select ma_candidature_etat||'|'||statut from public.v_opportunites_partenaire where id='$OPP1';" | tail -1)"
check "O01-67 : un éligible sans candidature ne voit plus l'opportunité pourvue" "0" \
  "$(o01_part 15 "select count(*) from public.v_opportunites_partenaire where id='$OPP1';" | tail -1)"
check "O01-68 : l'annonce et ses candidatures sont CONSERVÉES : suppression impossible" "DELETE 0|11" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; $ADM delete from public.opportunites where id='$OPP1'; commit;\"" 2>&1 | grep -E '^DELETE')|$(sql "select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1';")"

# ── 7. RÉOUVERTURE (choix documenté) ──
check "O01-69 : annuler un retenu sur une opportunité pourvue la ROUVRE (8 sur 9, À pourvoir)" "ROUVERTE|8|9|a_pourvoir|" \
  "$(sqlAdmin "select f.j->>'code'||'|'||(f.j->>'retenus')||'|'||(f.j->>'requis')||'|'||(f.j->>'statut')
                 from public.decider_candidature('$(CAND $OPP1 1)', 'non_retenu') as f(j);" | tail -1)|$(sql "select coalesce(cloturee_le::text,'') from public.opportunites where id='$OPP1';")"
check "O01-70 : publiee_le est conservé à la réouverture" "1" \
  "$(sql "select count(*) from public.opportunites where id='$OPP1' and publiee_le is not null and statut='a_pourvoir';")"
check "O01-71 : la place libérée se pourvoit, et l'opportunité se referme à 9 sur 9" "POURVUE|9|pourvue" \
  "$(sqlAdmin "select f.j->>'code'||'|'||(f.j->>'retenus')||'|'||(f.j->>'statut') from public.decider_candidature('$(CAND $OPP1 13)', 'retenu') as f(j);" | tail -1)"

# ── 8. 1 SUR 1 (nettoyage) ──
sqlAdmin "select public.publier_opportunite('$OPP2');" >/dev/null
check "O01-72 : 1 sur 1 — publication, seul le nettoyeur est éligible" "a_pourvoir|1|0" \
  "$(sql "select statut from public.opportunites where id='$OPP2';")|$(o01_part 2 "select count(*) from public.v_opportunites_partenaire where id='$OPP2';" | tail -1)|$(o01_part 1 "select count(*) from public.v_opportunites_partenaire where id='$OPP2';" | tail -1)"
check "O01-73 : 1 sur 1 — la première sélection clôture immédiatement" "CANDIDATURE_ENREGISTREE|POURVUE|1|1|pourvue" \
  "$(o01_part 2 "select public.postuler_opportunite('$OPP2') ->> 'code';" | tail -1)|$(sqlAdmin "select f.j->>'code'||'|'||(f.j->>'retenus')||'|'||(f.j->>'requis')||'|'||(f.j->>'statut') from public.decider_candidature('$(CAND $OPP2 2)', 'retenu') as f(j);" | tail -1)"

# ── 9. SÉLECTIONS CONCURRENTES : 2 places, 3 candidats, 2 administrateurs ──
# Même patron que la section U bis de t_rls.sh : deux sessions psql
# synchronisées à la milliseconde, chacune retenant un candidat
# différent pour la DERNIÈRE place. Le verrou FOR UPDATE sérialise :
# une seule sélection passe, l'autre lit le compte réel et est refusée.
check "O01-74a : l'opportunité à deux places se relit, se complète, puis se publie" "MODIFIEE|PUBLIEE|2" \
  "$(sqlAdmin "select (public.modifier_opportunite('$OPP3', '{\"description_publique\": \"Convoyage groupé de deux véhicules, départ le matin.\"}'::jsonb) ->> 'code')
               ||'|'||(public.publier_opportunite('$OPP3') ->> 'code')
               ||'|'||(select nb_professionnels from public.opportunites where id='$OPP3');" | tail -1)"
for g in 6 7 8; do o01_part $g "select public.postuler_opportunite('$OPP3');" >/dev/null; done
sqlAdmin "select public.decider_candidature('$(CAND $OPP3 6)', 'retenu');" >/dev/null
INSTANT=$(sql "select (now() + interval '2 seconds')::text;" | tail -1)
for g in 7 8; do
  printf '%s\n' "begin;
$ADM
select pg_sleep(greatest(0, extract(epoch from (timestamptz '$INSTANT' - clock_timestamp()))));
select public.decider_candidature('$(CAND $OPP3 $g)', 'retenu') ->> 'code';
commit;" > "$BASE/o01course$g.sql"
  chown postgres:postgres "$BASE/o01course$g.sql"
done
su postgres -c "psql -U postgres -d $DB -qAt -f $BASE/o01course7.sql" > "$BASE/o01course7.out" 2>&1 &
su postgres -c "psql -U postgres -d $DB -qAt -f $BASE/o01course8.sql" > "$BASE/o01course8.out" 2>&1 &
wait
COURSE=$(cat "$BASE/o01course7.out" "$BASE/o01course8.out" | grep -E 'POURVUE|PLACES_EPUISEES|CLOTUREE' | sort | paste -sd'|')
check "O01-74 : deux sélections simultanées pour la dernière place : UNE passe, l'autre est refusée" "PLACES_EPUISEES|POURVUE" "$COURSE"
check "O01-75 : jamais de dépassement : exactement 2 retenus sur 2, opportunité pourvue" "2|2|pourvue" \
  "$(sql "select (select count(*) from public.opportunite_candidatures where opportunite_id='$OPP3' and etat='retenu')||'|'||nb_professionnels||'|'||statut from public.opportunites where id='$OPP3';")"
check "O01-76 : un seul « besoin entièrement pourvu » pour le client, malgré la course" "1" \
  "$(sql "select count(*) from public.opportunite_notifications where opportunite_id='$OPP3' and evenement='pourvue_client';")"

# ── 10. JOURNAL : DES INTENTIONS, JAMAIS UN ENVOI (C11) ──
check "O01-77 : aucune ligne du journal ne prétend à un envoi ; aucune colonne d'adresse ni de secret" "0|0" \
  "$(sql "select (select count(*) from public.opportunite_notifications where etat<>'a_envoyer')
          ||'|'||(select count(*) from information_schema.columns where table_name='opportunite_notifications' and column_name ~ '(email|envoye|token|jeton|secret)');")"
check "O01-78 : le journal est réservé à l'administrateur, en lecture seule" "0|refuse" \
  "$(o01_part 1 "select count(*) from public.opportunite_notifications;" | tail -1)|$(sql "begin; $ADM insert into public.opportunite_notifications (opportunite_id, destinataire_role, evenement) values ('$OPP1','client','pourvue_client'); commit;" | grep -qiE 'permission denied|row-level security' && echo refuse || echo passe)"

# ── 11. LA DÉCISION PAR ACTIVITÉ N'A JAMAIS ÉTÉ TOUCHÉE (C06) ──
check "O01-79 : P5 est toujours en attente ; aucune décision n'a été écrite par ce lot" "en_attente|0" \
  "$(sql "select decision from public.convoyeur_decisions where convoyeur_id='$(o01_conv 5)' and activite='convoyage';")|$(sql "select count(*) from public.convoyeur_decisions_historique h join public.convoyeurs c on c.id=h.convoyeur_id where c.nom like 'O01-P%' and h.modifie_le > now() - interval '1 hour' and h.nouvelle_decision='oui' and h.modifie_par is not null;")"

# ── 12. IDEMPOTENCE DE 108 ──
POL_AVANT=$(sql "select count(*) from pg_policies where tablename like 'opportunite%';")
TRG_AVANT=$(sql "select count(*) from pg_trigger where tgname in ('trg_brouillon_opportunite_apres_mission','trg_verrou_candidature_opportunite','trg_verrou_opportunite');")
errO2=$(appliquer migrations/108_opportunites_missions.sql)
check "O01-80 : 108 se rejoue sans erreur" "" "$errO2"
check "O01-81 : ni politique ni trigger en double, données intactes" "$POL_AVANT|$TRG_AVANT|9|2|1" \
  "$(sql "select (select count(*) from pg_policies where tablename like 'opportunite%')
          ||'|'||(select count(*) from pg_trigger where tgname in ('trg_brouillon_opportunite_apres_mission','trg_verrou_candidature_opportunite','trg_verrou_opportunite'))
          ||'|'||(select count(*) from public.opportunite_candidatures where opportunite_id='$OPP1' and etat='retenu')
          ||'|'||(select count(*) from public.opportunite_candidatures where opportunite_id='$OPP3' and etat='retenu')
          ||'|'||(select count(*) from public.opportunite_candidatures where opportunite_id='$OPP2' and etat='retenu');")"
check "O01-82 : toujours aucun privilège pour anon après rejeu" "0" \
  "$(sql "select (select count(*) from information_schema.role_table_grants where grantee='anon' and (table_name like 'opportunite%' or table_name like 'v_opportunites%'))
          + (select count(*) from information_schema.role_routine_grants where grantee='anon' and routine_name in ('publier_opportunite','decider_candidature','postuler_opportunite','modifier_opportunite','creer_brouillon_opportunite'));")"
check "O01-83 : la création de mission reste possible pour l'administrateur, et son brouillon suit" "INSERT 0 1|1" \
  "$(su postgres -c "psql -U postgres -d $DB -c \"begin; $ADM insert into public.missions (id, reference, statut, ville_depart, ville_arrivee) values ('e0010000-0000-4000-8000-000000000004','TEST-QA-CLAUDE-HELIXCAR-O01-M4','en_attente','Bordeaux','Toulouse'); commit;\"" 2>&1 | grep -E '^INSERT')|$(sql "select count(*) from public.opportunites where mission_id='e0010000-0000-4000-8000-000000000004' and statut='brouillon' and created_by='11111111-1111-1111-1111-111111111111';")"
