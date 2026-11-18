-- mission_reference est un libellé d’affichage. Le lien reste fondé sur mission_id.
-- Ne changer ni les jointures ni security_invoker ni les permissions existantes.
do $$ declare def text; begin
 select pg_get_viewdef('public.v_opportunites_admin'::regclass,true) into def;
 if position('m_1.reference AS mission_reference' in def)=0 then
   raise exception 'Vue des opportunités inattendue';
 end if;
 execute 'create or replace view public.v_opportunites_admin with (security_invoker=true) as '||replace(def,
   'm_1.reference AS mission_reference','coalesce(m_1.reference_courte,m_1.reference) AS mission_reference');
end $$;
