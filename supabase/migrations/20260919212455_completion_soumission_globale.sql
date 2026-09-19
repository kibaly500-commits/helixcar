-- La soumission est atomique à l'échelle de la demande, tous véhicules confondus.
-- Les brouillons restent dans l'interface ; aucune information partielle n'est transmise.
create or replace function public.repondre_informations_demande(p_client_id uuid,p_reponses jsonb) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer:=0; affectees integer; k text; v text; j jsonb; lib text; etat text; requise record;
begin
 if not public.est_proprietaire_demande(p_client_id) then raise exception 'Demande introuvable ou non autorisée.' using errcode='42501'; end if;
 if jsonb_typeof(p_reponses) is distinct from 'object' then raise exception 'Informations invalides.' using errcode='22023'; end if;
 perform 1 from public.clients where id=p_client_id for update;
 -- Vérifier l'ensemble AVANT toute écriture, y compris après une demande de correction.
 for requise in select * from public.informations_demande(p_client_id) where statut in ('attendue','a_corriger') loop
  j:=p_reponses -> requise.cle;
  if jsonb_typeof(j) is distinct from 'string' or nullif(btrim(j #>> '{}'),'') is null then
   raise exception 'Complétez toutes les informations obligatoires avant de soumettre la demande.' using errcode='22023';
  end if;
  perform public.verifier_valeur_information(requise.cle,btrim(j #>> '{}'));
 end loop;
 delete from public.demande_informations_manquantes i where i.client_id=p_client_id and i.cle not in(select r.cle from public.informations_demande(p_client_id) r);
 for k,j in select key,value from jsonb_each(p_reponses) loop
  select r.libelle,r.statut into lib,etat from public.informations_demande(p_client_id) r where r.cle=k;
  if not found or etat in ('validee','fournie') then continue; end if;
  if jsonb_typeof(j) is distinct from 'string' then raise exception 'Valeur invalide : %',k using errcode='22023'; end if;
  v:=btrim(j #>> '{}'); if v='' then continue; end if;
  perform public.verifier_valeur_information(k,v);
  if exists(select 1 from public.demande_informations_manquantes where client_id=p_client_id and cle=k and statut='transmise' and valeur=v) then continue; end if;
  insert into public.demande_informations_manquantes(client_id,cle,libelle,statut,valeur,commentaire)
  values(p_client_id,k,lib,'transmise',v,null)
  on conflict(client_id,cle) do update set statut='transmise',valeur=excluded.valeur,commentaire=null
  where demande_informations_manquantes.statut <> 'validee'
    and not(demande_informations_manquantes.statut='transmise' and demande_informations_manquantes.valeur=excluded.valeur);
  get diagnostics affectees = row_count;
  n:=n+affectees;
 end loop;
 return n;
end $$;
revoke all on function public.repondre_informations_demande(uuid,jsonb) from public,anon;
grant execute on function public.repondre_informations_demande(uuid,jsonb) to authenticated;
