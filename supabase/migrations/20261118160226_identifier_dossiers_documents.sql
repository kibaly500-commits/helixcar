-- Des libellés distincts pour rattacher les pièces à la bonne demande.
create or replace function private.contextes_documents() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from (
 select m.id mission_id,m.client_id,coalesce(m.reference_courte,m.reference) reference,m.type_mission
 from public.missions m where auth.uid() is not null and (public.est_admin() or exists(select 1 from public.clients c where c.id=m.client_id and c.auth_user_id=auth.uid()) or (m.convoyeur_id=public.convoyeur_de_session() and public.partenaire_actif()))
 union all select null,c.id,coalesce(nullif(c.numero_client,''),'Dossier '||left(c.id::text,8))||' · '||coalesce(c.type_service,'Demande')||' · '||coalesce(c.prenom,'')||' '||coalesce(c.nom,'')||' · '||to_char(c.created_at,'DD/MM/YYYY'),'demande' from public.clients c where auth.uid() is not null and (public.est_admin() or c.auth_user_id=auth.uid())
 ) x
$$;

