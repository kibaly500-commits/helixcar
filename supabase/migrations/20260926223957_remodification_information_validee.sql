begin;
create or replace function public.modifier_information_demande(p_client_id uuid,p_cle text,p_valeur text) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; verrou boolean; v text:=btrim(p_valeur);
begin
 if auth.uid() is null or not public.est_proprietaire_demande(p_client_id) then raise exception 'Demande introuvable ou non autorisée.' using errcode='42501';end if;
 select informations_confirmees_le is not null into verrou from public.clients where id=p_client_id for update;
 if verrou or exists(select 1 from public.preparations_missions where client_id=p_client_id and mission_id is not null) then raise exception 'Informations confirmées ou mission publiée : contactez HelixCar.' using errcode='22023';end if;
 if not public.information_modifiable_client(p_cle) then raise exception 'Information non modifiable.' using errcode='22023';end if;
 select * into r from public.informations_demande(p_client_id) where cle=p_cle;
 if not found then raise exception 'Information introuvable.' using errcode='22023';end if;
 -- Rejouer une requête réussie ne crée pas une deuxième modification.
 if r.statut='transmise' and v is not distinct from r.valeur then return 1;end if;
 if r.statut not in ('fournie','validee') then raise exception 'Cette information ne peut pas être modifiée séparément.' using errcode='22023';end if;
 if v is null or v='' then raise exception 'Renseignez la modification avant de valider.' using errcode='22023';end if;
 perform public.verifier_valeur_information(p_cle,v);
 if v is not distinct from coalesce(r.valeur,'') then return 0;end if;
 insert into public.demande_informations_manquantes(client_id,cle,libelle,statut,valeur,ancienne_valeur,correction_recue,transmise_le)
 values(p_client_id,p_cle,r.libelle,'transmise',v,r.valeur,false,now())
 on conflict(client_id,cle) do update set statut='transmise',valeur=excluded.valeur,ancienne_valeur=excluded.ancienne_valeur,correction_recue=false,transmise_le=now(),validee_le=null,validee_par=null;
 -- La confirmation globale reste indépendante et n'est pas renseignée ici.
 return 1;
end $$;
revoke all on function public.modifier_information_demande(uuid,text,text) from public,anon;
grant execute on function public.modifier_information_demande(uuid,text,text) to authenticated;
create or replace function public.repondre_informations_demande(p_client_id uuid,p_reponses jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n int:=0; k text; j jsonb; v text; r record; verrou boolean; avant text;
begin
 if not public.est_proprietaire_demande(p_client_id) then raise exception 'Demande introuvable ou non autorisée.' using errcode='42501';end if;
 if jsonb_typeof(p_reponses) is distinct from 'object' then raise exception 'Informations invalides.' using errcode='22023';end if;
 select informations_confirmees_le is not null into verrou from clients where id=p_client_id for update;
 if exists(select 1 from preparations_missions where client_id=p_client_id and mission_id is not null) then raise exception 'Mission publiée : contactez HelixCar pour toute correction.' using errcode='22023';end if;
 for r in select * from informations_demande(p_client_id) where statut in ('attendue','a_corriger') loop
  j:=p_reponses->r.cle;
  if jsonb_typeof(j) is distinct from 'string' or nullif(btrim(j#>>'{}'),'') is null then raise exception 'Complétez toutes les informations obligatoires avant validation.' using errcode='22023';end if;
 end loop;
 for k,j in select key,value from jsonb_each(p_reponses) loop
  select * into r from informations_demande(p_client_id) where cle=k;
  if not found then raise exception 'Information non modifiable : %',k using errcode='22023';end if;
  if jsonb_typeof(j) is distinct from 'string' then raise exception 'Valeur invalide' using errcode='22023';end if;
  v:=btrim(j#>>'{}');
  -- Rejeu identique sans modification ni nouvelle notification.
  if v is not distinct from coalesce(r.valeur,'') and r.statut not in ('attendue','a_corriger') then continue;end if;
  if r.statut not in ('attendue','a_corriger') and not(not verrou and r.statut in ('fournie','validee') and information_modifiable_client(k)) then
   raise exception 'Cette information est verrouillée : %',r.libelle using errcode='22023';
  end if;
  if verrou and r.statut not in ('attendue','a_corriger') then raise exception 'Informations déjà confirmées. Contactez HelixCar.' using errcode='22023';end if;
  if v='' then raise exception 'Une valeur est obligatoire : %',r.libelle using errcode='22023';end if;
  perform verifier_valeur_information(k,v);
  avant:=coalesce(r.valeur,valeur_source_information(p_client_id,k));
  insert into demande_informations_manquantes(client_id,cle,libelle,statut,valeur,commentaire,ancienne_valeur,correction_recue,transmise_le)
   values(p_client_id,k,r.libelle,'transmise',v,r.commentaire,avant,r.statut='a_corriger',now())
   on conflict(client_id,cle) do update set statut='transmise',valeur=excluded.valeur,ancienne_valeur=excluded.ancienne_valeur,correction_recue=excluded.correction_recue,transmise_le=now(),validee_le=null,validee_par=null;
  n:=n+1;
 end loop;
 if n>0 or not verrou then update clients set informations_confirmees_le=coalesce(informations_confirmees_le,now()) where id=p_client_id;end if;
 return greatest(n,1);
end $$;
revoke all on function public.repondre_informations_demande(uuid,jsonb) from public,anon;
grant execute on function public.repondre_informations_demande(uuid,jsonb) to authenticated;

commit;
