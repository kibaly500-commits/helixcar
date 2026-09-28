begin;
create or replace function public.modifier_information_demande(p_client_id uuid,p_cle text,p_valeur text) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; verrou boolean; v text:=btrim(p_valeur);
begin
 if auth.uid() is null or not public.est_proprietaire_demande(p_client_id) then raise exception 'Demande introuvable ou non autorisée.' using errcode='42501';end if;
 select informations_confirmees_le is not null into verrou from public.clients where id=p_client_id for update;
 if verrou or exists(select 1 from public.preparations_missions where client_id=p_client_id and mission_id is not null) then raise exception 'Informations confirmées ou mission publiée : contactez HelixCar.' using errcode='22023';end if;
 select * into r from public.informations_demande(p_client_id) where cle=p_cle;
 if not found then raise exception 'Information introuvable.' using errcode='22023';end if;
 -- Rejouer une requête réussie ne crée pas une deuxième modification.
 if r.statut='transmise' and v is not distinct from r.valeur then return 1;end if;
 if not public.information_modifiable_client(p_cle) then raise exception 'Information non modifiable.' using errcode='22023';end if;
 if r.statut not in ('fournie','validee','a_corriger') then raise exception 'Cette information ne peut pas être modifiée séparément.' using errcode='22023';end if;
 if v is null or v='' then raise exception 'Renseignez la modification avant de valider.' using errcode='22023';end if;
 perform public.verifier_valeur_information(p_cle,v);
 if r.statut<>'a_corriger' and v is not distinct from coalesce(r.valeur,'') then return 0;end if;
 insert into public.demande_informations_manquantes(client_id,cle,libelle,statut,valeur,ancienne_valeur,correction_recue,transmise_le)
 values(p_client_id,p_cle,r.libelle,'transmise',v,case when r.statut='a_corriger' then coalesce((select ancienne_valeur from public.demande_informations_manquantes where client_id=p_client_id and cle=p_cle),r.valeur) else r.valeur end,r.statut='a_corriger',now())
 on conflict(client_id,cle) do update set statut='transmise',valeur=excluded.valeur,ancienne_valeur=excluded.ancienne_valeur,correction_recue=excluded.correction_recue,transmise_le=now(),validee_le=null,validee_par=null;
 -- La confirmation globale reste indépendante et n'est pas renseignée ici.
 return 1;
end $$;
revoke all on function public.modifier_information_demande(uuid,text,text) from public,anon;
grant execute on function public.modifier_information_demande(uuid,text,text) to authenticated;
commit;
