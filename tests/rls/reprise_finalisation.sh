# Exécuté après 112 par t_rls.sh : vrais privilèges et transitions SQL.
for n in 107_reconciliation_partenaires_historiques 113_devis_identite_et_archives 114_video_verification_serveur 115_durcissement_analyseur_supabase; do
  err=$(appliquer "migrations/$n.sql");check "$n : migration appliquée" "" "$err"
  err=$(appliquer "migrations/$n.sql");check "$n : seconde application idempotente" "" "$err"
done
for t in devis_preparations devis_envoi_operations video_verifications; do
  check "$t : aucun accès navigateur y compris admin" "0" "$(sql "select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='$t' and grantee in ('anon','authenticated','PUBLIC');")"
  check "$t : RLS active" "t" "$(sql "select relrowsecurity from pg_class where oid='public.$t'::regclass;")"
done
sqlAdmin "update public.devis set paiement_statut='paye',paiement_confirme_le=now() where id='d0d0d0d0-0000-4000-8000-000000000101';" >/dev/null 2>&1 || true
check "Q01 : même un admin ne peut inventer un paiement confirmé" "t" \
 "$(sql "select paiement_statut<>'paye' and paiement_confirme_le is null from public.devis where id='d0d0d0d0-0000-4000-8000-000000000101';")"
check "V01 : ancien RPC ne contourne pas le worker" "f" \
 "$(sql "select has_function_privilege('service_role','public.finaliser_video_candidature(uuid,bigint)','execute');")"
check "V01 : aucun droit direct de remplacement/suppression vidéo" "0" \
 "$(sql "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('candidature video : depot par le proprietaire authentifie','candidature video : remplacement par le proprietaire','candidature video : suppression par le proprietaire');")"
VID_ID='eeeeeeee-0000-4000-8000-000000000114'
sql "insert into public.convoyeurs(id,prenom,nom,email,activites,statut) values('$VID_ID','TEST-QA-CLAUDE-HELIXCAR','Mesures','test-qa-claude-helixcar-114@example.invalid',array['renfort'],'video_attendue');" >/dev/null
v1=$(sql "select public.preparer_video_candidature('$VID_ID','video/quicktime',225000000,119)->>'chemin';")
v2=$(sql "select public.preparer_video_candidature('$VID_ID','video/quicktime',225000000,119)->>'chemin';")
check "V01 : démarrage répété = même chemin" "$v1" "$v2"
check "V01 : aucune fausse date avant vérification" "t" "$(sql "select video_envoyee_le is null and video_chemin is null from public.convoyeurs where id='$VID_ID';")"
check "V01 : finalisation sans mesures refusée" "VERIFICATION_REQUISE" "$(sql "select public.finaliser_video_verifiee('$VID_ID','$v1')->>'code';")"
vfinal="candidatures/$VID_ID/verifie/test-qa-claude-helixcar.mov"
sql "insert into public.video_verifications(chemin_source,convoyeur_id,chemin_final,etat,taille_octets,duree_secondes,mime,codec,sha256,verifie_le) values('$v1','$VID_ID','$vfinal','verifie',225000000,119,'video/quicktime','rawvideo',repeat('a',64),now());" >/dev/null
check "V01 : ancien upload concurrent refusé" "ENVOI_REMPLACE" "$(sql "select public.finaliser_video_verifiee('$VID_ID','autre-chemin')->>'code';")"
check "V01 : mesures vérifiées finalisées ensemble" "FINALISEE" "$(sql "select public.finaliser_video_verifiee('$VID_ID','$v1')->>'code';")"
check "V01 : répétition sans deuxième finalisation" "DEJA_FINALISEE" "$(sql "select public.finaliser_video_verifiee('$VID_ID','$v1')->>'code';")"
check "V01 : fichier immuable et vraie durée persistés" "t" "$(sql "select video_chemin='$vfinal' and video_mime='video/quicktime' and video_taille_octets=225000000 and video_duree_secondes=119 and video_envoyee_le is not null and video_envoi_chemin is null from public.convoyeurs where id='$VID_ID';")"
check "V01 : admin ne falsifie pas la mesure" "1" "$(sqlAdmin "update public.convoyeurs set video_duree_secondes=1 where id='$VID_ID';" | grep -c 'finalisée par le serveur' || true)"

check "SEC : anon n'exécute qu'un point SECURITY DEFINER explicitement public" "creer_demande_avec_vehicules(jsonb,jsonb,text,text)" \
 "$(sql "select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'execute') order by 1;")"
check "SEC : aucune table publique sans RLS" "0" \
 "$(sql "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")"
check "SEC : aucun search_path mutable dans public" "0" \
 "$(sql "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and not exists(select 1 from unnest(coalesce(p.proconfig,'{}')) x where x like 'search_path=%');")"
check "SEC : création directe de mission anonyme retirée" "0" \
 "$(sql "select count(*) from pg_policies where schemaname='public' and tablename='missions' and 'anon'=any(roles) and cmd='INSERT';")"
