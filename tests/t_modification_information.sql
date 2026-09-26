begin;
do $$
declare cid uuid; uid uuid; n integer; refuse boolean:=false;
begin
 select u.id into uid from auth.users u where not exists(select 1 from public.admins a where a.auth_user_id=u.id) limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated')::text,true);
 insert into public.clients(numero_client,code_parrainage,prenom,nom,email,type_service,type_client,auth_user_id,nb_vehicules)
 values('QA-'||gen_random_uuid()::text,gen_random_uuid()::text,'QA','Modification','qa-modif@example.invalid','convoyage','particulier',uid,1) returning id into cid;
 insert into public.vehicules(dossier_id,position,immatriculation) values(cid,1,'AB-123-CD');
 select public.modifier_information_demande(cid,'vehicule_1_immatriculation','EF-456-GH') into n;
 if n<>1 then raise exception 'Modification non enregistrée';end if;
 if not exists(select 1 from public.informations_demande(cid) where cle='vehicule_1_immatriculation' and statut='transmise' and valeur='EF-456-GH') then raise exception 'Modification non transmise';end if;
 if not exists(select 1 from public.informations_demande(cid) where statut='attendue') then raise exception 'Les champs manquants ont disparu';end if;
 if exists(select 1 from public.clients where id=cid and informations_confirmees_le is not null) then raise exception 'Confirmation globale indue';end if;
 select public.modifier_information_demande(cid,'vehicule_1_immatriculation','EF-456-GH') into n;
 if n<>1 then raise exception 'Rejeu non idempotent';end if;
 begin perform public.repondre_informations_demande(cid,'{}'::jsonb);exception when sqlstate '22023' then refuse:=true;end;
 if not refuse then raise exception 'Validation globale incomplète acceptée';end if;
 refuse:=false;
 begin perform public.modifier_information_demande(cid,'prix','200');exception when sqlstate '22023' then refuse:=true;end;
 if not refuse then raise exception 'Champ interdit accepté';end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 refuse:=false;
 begin perform public.modifier_information_demande(cid,'vehicule_1_immatriculation','IJ-789-KL');exception when sqlstate '42501' then refuse:=true;end;
 if not refuse then raise exception 'Autre utilisateur accepté';end if;
end $$;
rollback;
select 'PASS modification seule, champs manquants conservés, confirmation séparée, rejeu et accès refusés' as resultat;
