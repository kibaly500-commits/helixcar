-- Le rendez-vous interne de retrait la veille ne remplace pas la date
-- convenue avec le client dans son suivi. Aucun changement des devis.
do $migration$
declare definition text; marker text := 'm.date_prise_en_charge,';
begin
 select pg_get_viewdef('public.v_mes_missions'::regclass,true) into definition;
 if position('retrait_veille' in definition)>0 then return; end if;
 if position(marker in definition)=0 then raise exception 'Projection client inattendue'; end if;
 definition:=replace(definition,marker,$projection$
    case when exists (
      select 1 from public.preparations_missions p
      where p.id=m.preparation_id and p.plan->>'kind'='apres_stockage'
        and p.plan->>'retrait_veille'='true'
    ) then m.date_livraison else m.date_prise_en_charge end as date_prise_en_charge,
$projection$);
 execute 'create or replace view public.v_mes_missions as '||definition;
end $migration$;
