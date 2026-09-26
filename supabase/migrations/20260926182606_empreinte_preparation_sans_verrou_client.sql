-- La confirmation client est une métadonnée, sans effet sur le trajet préparé.
do $migration$
declare
 definition text;
 ancien text := 'to_jsonb(x)-''vue_admin_at'' into c';
 nouveau text := 'to_jsonb(x)-''vue_admin_at''-''informations_confirmees_le'' into c';
begin
 select pg_get_functiondef('public.source_preparation_missions(uuid)'::regprocedure) into definition;
 if position(ancien in definition)=0 then
  raise exception 'Source préparation inattendue : empreinte non modifiée';
 end if;
 execute replace(definition,ancien,nouveau);
end;
$migration$;
