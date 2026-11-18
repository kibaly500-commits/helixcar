create or replace function public.contexte_completion_demande(p_client_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not (public.est_admin() or public.est_proprietaire_demande(p_client_id)) then raise exception 'Accès refusé' using errcode='42501';end if;
 if not public.est_admin() and (select d.statut from public.devis d where d.client_id=p_client_id order by d.date_generation desc,d.id desc limit 1)='refuse' then
 raise exception 'Ce devis a été refusé. Les informations ne sont plus modifiables.' using errcode='42501';end if;
 return jsonb_build_object('verrouillee',(select informations_confirmees_le is not null from public.clients where id=p_client_id) or exists(select 1 from public.preparations_missions where client_id=p_client_id and mission_id is not null));
end $$;
