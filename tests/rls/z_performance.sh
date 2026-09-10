echo "── PERFORMANCE RLS ET CLÉS ÉTRANGÈRES ──"
errPerf=$(appliquer migrations/118_performance_rls_et_cles_etrangeres.sql)
check "PERF-1 : migration 118 sans erreur" "" "$errPerf"
errPerf2=$(appliquer migrations/118_performance_rls_et_cles_etrangeres.sql)
check "PERF-2 : migration 118 idempotente" "" "$errPerf2"
check "PERF-3 : aucune clé étrangère publique sans index couvrant" "0" "$(sql "select count(*) from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace where c.contype='f' and n.nspname='public' and not exists(select 1 from pg_index i where i.indrelid=t.oid and i.indisvalid and (i.indkey::smallint[])[0:cardinality(c.conkey)-1] @> c.conkey);")"
check "PERF-4 : aucune politique ne réévalue auth.uid() par ligne" "0" "$(sql "select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'') ~ '(^|[^s]elect )auth.uid\\(\\)' or coalesce(with_check,'') ~ '(^|[^s]elect )auth.uid\\(\\)');")"
check "PERF-5 : le client A conserve ses trois devis de fixture et aucun journal interne" "3|0" "$(q02_client "select count(*) from public.v_mes_devis; select count(*) from public.devis_envois;" | tail -2 | paste -sd'|')"

errAnalyseur=$(appliquer migrations/119_nettoyage_alertes_analyseur.sql)
check "PERF-6 : migration 119 sans erreur" "" "$errAnalyseur"
errAnalyseur2=$(appliquer migrations/119_nettoyage_alertes_analyseur.sql)
check "PERF-7 : migration 119 idempotente" "" "$errAnalyseur2"
check "SEC-119-1 : le garde vidéo de trigger n'est exécutable par aucun rôle API" "0" "$(sql "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='garde_video_finale_serveur' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'));" )"
check "PERF-119-1 : un seul index type_service subsiste" "1" "$(sql "select count(*) from pg_indexes where schemaname='public' and tablename='clients' and indexdef like '%(type_service)%';")"
check "PERF-119-2 : l'ancienne politique de dépôt dupliquée est retirée" "0" "$(sql "select count(*) from pg_policies where schemaname='public' and tablename='convoyeurs' and policyname='insert_convoyeurs';")"
