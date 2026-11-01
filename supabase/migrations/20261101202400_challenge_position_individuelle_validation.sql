-- Challenge : seule la position individuelle est exposée aux partenaires.
DO $migration$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('private.challenge_partenaire(date)'::regprocedure) INTO definition;
 IF position('where rang<=3 or id=propre or public.est_admin()' in definition)=0 THEN
  RAISE EXCEPTION 'Definition du challenge inattendue';
 END IF;
 definition:=replace(definition,'where rang<=3 or id=propre or public.est_admin()','where id=propre or public.est_admin()');
 definition:=replace(definition,'where m.statut=''terminee'' and','where m.statut=''terminee'' and m.validee_paiement is true and');
 EXECUTE definition;
END
$migration$;