-- Corrige aussi le point de remise privé des missions, anciennes et préparées.
-- Remplacement du seul libellé : contrôles d’accès, paiement et droits conservés.
do $$
declare definition text;
begin
 select pg_get_functiondef('public.point_remise_mission(uuid)'::regprocedure) into definition;
 if position('ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand' in definition)=0 then
   raise exception 'Définition inattendue de point_remise_mission';
 end if;
 execute replace(definition,
   'ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand',
   '12 rue de l’Université, 93160 Noisy-le-Grand');
end $$;
