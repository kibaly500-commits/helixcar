-- Nettoyage : aucun trajet. Même représentation vide que la publication admin.
DO $migration$
DECLARE source text; cible text;
BEGIN
 SELECT pg_get_functiondef('public.creer_mission_nettoyage_si_prete(uuid)'::regprocedure) INTO source;
 IF position('reference, type_mission, statut, client_id, ville_depart, ville_arrivee,' in source) > 0
    AND position('v_ref, ''nettoyage'', ''en_attente'', p_client_id, '''', '''',' in source) > 0 THEN
   RETURN;
 END IF;
 cible := replace(source,
   'reference, type_mission, statut, client_id,',
   'reference, type_mission, statut, client_id, ville_depart, ville_arrivee,');
 cible := replace(cible,
   'v_ref, ''nettoyage'', ''en_attente'', p_client_id,',
   'v_ref, ''nettoyage'', ''en_attente'', p_client_id, '''', '''',');
 IF cible = source THEN
   RAISE EXCEPTION 'Fonction nettoyage inattendue : correction non appliquée';
 END IF;
 EXECUTE cible;
END
$migration$;