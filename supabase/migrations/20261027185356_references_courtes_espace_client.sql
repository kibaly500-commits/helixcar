-- Ajouter uniquement le numéro lisible. Garder les colonnes, permissions,
-- filtres de propriété et masquages financiers de la vue existante.
do $$ declare definition text; begin
 select pg_get_viewdef('public.v_mes_missions'::regclass,true) into definition;
 if position('e.created_at AS evaluee_le' in definition)=0
    or position('c.auth_user_id = auth.uid()' in definition)=0
    or position('NULL::numeric AS prix_ttc' in definition)=0 then
   raise exception 'Définition de suivi client inattendue';
 end if;
 definition:=replace(definition,'e.created_at AS evaluee_le','e.created_at AS evaluee_le, m.reference_courte');
 execute 'create or replace view public.v_mes_missions as '||definition;
end $$;
