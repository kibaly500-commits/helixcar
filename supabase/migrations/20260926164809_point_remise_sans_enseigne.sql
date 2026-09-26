-- L'adresse de remise est une donnée privée de mission, sans nom d'enseigne.
-- Les annonces publiques ne contiennent ni l'une ni l'autre.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.source_preparation_missions(uuid)'::regprocedure) into definition;
 if position('Point de remise HelixCar — ALDI, 12 rue de l’Université, 93160 Noisy-le-Grand' in definition)=0 then
   raise exception 'Définition inattendue de source_preparation_missions';
 end if;
 execute replace(definition,
   'Point de remise HelixCar — ALDI, 12 rue de l’Université, 93160 Noisy-le-Grand',
   '12 rue de l’Université, 93160 Noisy-le-Grand');
end $$;
