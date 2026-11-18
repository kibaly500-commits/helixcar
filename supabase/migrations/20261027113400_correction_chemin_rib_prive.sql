begin;
-- Corrige seulement le séparateur d'extension, sans affaiblir les contrôles.
do $$ declare def text; begin
 select pg_get_functiondef('public.garde_colonnes_sensibles_convoyeur()'::regprocedure) into def;
 if position('/rib/[0-9a-f-]{16,}' in def)=0 then raise exception 'Garde RIB inattendue'; end if;
 def:=regexp_replace(def, '/rib/\[0-9a-f-\]\{16,\}[^\n]*\(pdf\|jpg\|jpeg\|png\)\$', '/rib/[0-9a-f-]{16,}[.](pdf|jpg|jpeg|png)$');
 execute def;
end $$;

notify pgrst,'reload schema';
commit;
