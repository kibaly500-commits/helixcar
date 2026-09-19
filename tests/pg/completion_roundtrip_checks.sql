begin;
do $$
declare d uuid:=gen_random_uuid(); autre uuid:=gen_random_uuid(); u uuid; a uuid; orig uuid; n integer; reponses jsonb; v1 uuid; v2 uuid; bad boolean; etat text;
begin
 select c.id,c.auth_user_id into orig,u from public.clients c join public.devis dv on dv.client_id=c.id where dv.reference='DEV-2026-0081';
 select auth_user_id into a from public.admins where actif limit 1;
 if u is null or a is null then raise exception 'Identites QA absentes'; end if;
 insert into public.clients(id,numero_client,code_parrainage,auth_user_id,prenom,nom,email,type_service,type_client,nb_vehicules,trajet_commun)
 values(d,'TEST-QA-'||d::text,d::text,u,'TEST-QA','COMPLETION-NOUVELLE','helixcarpro+qa-final01@gmail.com','convoyage','part',2,false),
 (autre,'TEST-QA-'||autre::text,autre::text,u,'TEST-QA','ISOLATION','helixcarpro+qa-final01@gmail.com','convoyage','part',1,false);
 insert into public.vehicules select (jsonb_populate_record(null::public.vehicules,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'dossier_id',d,'immatriculation',null,'vin',null,'pc_contact_nom',null,'pc_contact_tel',null,'liv_contact_nom',null,'liv_contact_tel',null))).* from public.vehicules v where v.dossier_id=orig;
 select id into v1 from public.vehicules where dossier_id=d and position=1;
 select id into v2 from public.vehicules where dossier_id=d and position=2;
 perform set_config('request.jwt.claim.sub',u::text,true);set local role authenticated;
 select count(*) into n from public.informations_demande(d) where cle in ('vehicule_1_immatriculation','vehicule_1_contact_liv_nom','vehicule_1_contact_liv_tel','vehicule_2_immatriculation','vehicule_2_contact_liv_nom','vehicule_2_contact_liv_tel') and statut='attendue';
 if n<>6 then raise exception 'Tous les champs ne sont pas demandes des la premiere lecture'; end if;
 bad:=false;begin perform public.repondre_informations_demande(d,'{"vehicule_1_contact_pc_nom":"Ne doit pas rester","vehicule_1_contact_pc_tel":"06"}');exception when invalid_parameter_value then bad:=true;end;
 if not bad then raise exception 'Telephone court accepte'; end if;
 if exists(select 1 from public.informations_demande(d) where cle='vehicule_1_contact_pc_nom' and statut='transmise') then raise exception 'Envoi invalide partiellement persiste'; end if;
 n:=public.repondre_informations_demande(d,'{"vehicule_1_contact_pc_tel":"+44 20 7946 0958","vehicule_1_contact_pc_nom":"Mauvais contact fictif","vehicule_1_immatriculation":"AB-123-CD","cle_inconnue":"ignoree"}');
 if n<>3 then raise exception 'Envoi international / partiel incorrect'; end if;
 n:=public.repondre_informations_demande(d,'{"vehicule_1_contact_pc_tel":"+44 20 7946 0958"}');if n<>0 then raise exception 'Rejeu non idempotent'; end if;
 select statut into etat from public.informations_demande(d) where cle='vehicule_2_immatriculation';if etat<>'attendue' then raise exception 'Autre vehicule modifie'; end if;
 -- Le client ne peut pas valider lui-même ses réponses.
 bad:=false;begin update public.demande_informations_manquantes set statut='validee' where client_id=d and cle='vehicule_1_contact_pc_nom';exception when insufficient_privilege then bad:=true;end;
 if exists(select 1 from public.informations_demande(d) where cle='vehicule_1_contact_pc_nom' and statut='validee') then raise exception 'Auto-validation client';end if;
 reset role;perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 select statut into etat from public.informations_demande(d) where cle='vehicule_1_contact_pc_nom';if etat<>'transmise' then raise exception 'Admin non synchronise';end if;
 bad:=false;begin update public.demande_informations_manquantes set statut='a_corriger',commentaire=' ' where client_id=d and cle='vehicule_1_contact_pc_nom';exception when invalid_parameter_value then bad:=true;end;
 if not bad then raise exception 'Motif vide accepte';end if;
 update public.demande_informations_manquantes set statut='a_corriger',commentaire='Indiquez la personne présente lors du départ.' where client_id=d and cle='vehicule_1_contact_pc_nom';
 reset role;perform set_config('request.jwt.claim.sub',u::text,true);set local role authenticated;
 if not exists(select 1 from public.informations_demande(d) where cle='vehicule_1_contact_pc_nom' and statut='a_corriger' and commentaire like 'Indiquez%') then raise exception 'Motif invisible cote client';end if;
 perform public.repondre_informations_demande(d,'{"vehicule_1_contact_pc_nom":"Contact TEST corrigé"}');
 if not exists(select 1 from public.informations_demande(d) where cle='vehicule_1_contact_pc_nom' and statut='transmise' and commentaire is null) then raise exception 'Correction non retransmise';end if;
 reset role;perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 update public.demande_informations_manquantes set statut='validee' where client_id=d and cle in ('vehicule_1_contact_pc_nom','vehicule_1_contact_pc_tel','vehicule_1_immatriculation');
 reset role;
 if (select pc_contact_nom from public.vehicules where id=v1) is distinct from 'Contact TEST corrigé' then raise exception 'Valeur non synchronisee sur vehicule';end if;
 if (select pc_contact_nom from public.vehicules where id=v2) is not null then raise exception 'Synchronisation mauvais vehicule';end if;
 if exists(select 1 from public.demande_informations_manquantes where client_id=autre) then raise exception 'Autre demande modifiee';end if;
 perform set_config('request.jwt.claim.sub',u::text,true);set local role authenticated;
 n:=public.repondre_informations_demande(d,'{"vehicule_1_contact_pc_nom":"Ecrasement interdit"}');if n<>0 then raise exception 'Valeur validee ecrasee';end if;
 -- Terminer toutes les rubriques en un seul envoi, puis valider côté admin.
 select jsonb_object_agg(cle,case when cle ~ '(_tel|telephone)$' then '+33 6 12 34 56 78' when cle ~ 'vin$' then 'VF3ABCDEF12345678' when cle ~ 'immatriculation$' then 'CD-456-EF' when cle ~ 'date' then '2026-10-01' else 'TEST QA information complete' end) into reponses from public.informations_demande(d) where statut in ('attendue','a_corriger');
 perform public.repondre_informations_demande(d,reponses);
 if exists(select 1 from public.informations_demande(d) where statut in ('attendue','a_corriger')) then raise exception 'Envoi global incomplet';end if;
 if not exists(select 1 from public.informations_demande(d) where statut='transmise') then raise exception 'Dossier annonce complet avant controle';end if;
 reset role;perform set_config('request.jwt.claim.sub',a::text,true);set local role authenticated;
 update public.demande_informations_manquantes set statut='validee' where client_id=d and statut='transmise';
 if exists(select 1 from public.informations_demande(d) where statut not in ('validee','fournie')) then raise exception 'Dossier final non complet';end if;
 reset role;perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);set local role authenticated;
 bad:=false;begin perform public.repondre_informations_demande(d,'{"vehicule_2_immatriculation":"ZZ-000-ZZ"}');exception when insufficient_privilege then bad:=true;end;
 if not bad then raise exception 'Ecriture autre compte autorisee';end if;
 reset role;
 if exists(select 1 from public.missions where client_id=d) then raise exception 'Mission creee sur dossier incomplet';end if;
end $$;
select 'PASS : nouveau dossier, champs complets, telephone invalide, international, atomicite, rejeu, correction, validation, synchronisation vehicule, isolation et autorisations' as resultat;
rollback;
