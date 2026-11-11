-- Vérification transactionnelle, aucune donnée de test conservée.
begin;
do $$
declare cid uuid; vid uuid; did uuid; admin_uid uuid; client_uid uuid; t timestamptz; t2 timestamptz; lu timestamptz; n integer;
begin
 select auth_user_id into admin_uid from public.admins where actif limit 1;
 select u.id into client_uid from auth.users u where not exists(select 1 from public.admins a where a.auth_user_id=u.id) limit 1;
 if admin_uid is null or client_uid is null then raise exception 'Fixtures admin/client nécessaires';end if;
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'role','authenticated')::text,true);
 insert into public.clients(code_parrainage,numero_client,prenom,nom,email,type_client,type_service,auth_user_id)
 values(gen_random_uuid()::text,'QA-'||gen_random_uuid()::text,'QA','Activite','qa-activite@example.invalid','particulier','convoyage',client_uid)
 returning id,activite_demande_le into cid,t;
 update public.clients set vue_admin_at=clock_timestamp() where id=cid;
 -- Générer un devis et modifier un véhicule côté admin ne doit pas réouvrir le dossier.
 insert into public.devis(reference,client_id,prix,statut) values('QA-'||gen_random_uuid()::text,cid,100,'genere') returning id into did;
 insert into public.vehicules(dossier_id,position,marque_modele) values(cid,1,'QA') returning id into vid;
 update public.clients set notes='Note admin' where id=cid;
 select activite_demande_le,vue_admin_at into t2,lu from public.clients where id=cid;
 if t2<>t or lu is null then raise exception 'Action admin signalée';end if;
 -- L'envoi par le serveur utilise service_role sans JWT admin.
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 update public.devis set statut='envoye',date_envoi=clock_timestamp(),pdf_path='test.pdf' where id=did;
 select activite_demande_le,vue_admin_at into t2,lu from public.clients where id=cid;
 if t2<>t or lu is null then raise exception 'Envoi serveur signalé';end if;
 -- La consultation client via ce même serveur est bien une nouveauté.
 update public.devis set consulte_le=clock_timestamp() where id=did;
 select activite_demande_le,vue_admin_at into t2,lu from public.clients where id=cid;
 if t2<=t or lu is not null then raise exception 'Consultation client ignorée';end if;
 t:=t2;
 perform set_config('request.jwt.claim.sub',client_uid::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',client_uid,'role','authenticated')::text,true);
 update public.clients set vue_admin_at=clock_timestamp() where id=cid;
 update public.vehicules set marque_modele='QA' where id=vid;
 select activite_demande_le,vue_admin_at into t2,lu from public.clients where id=cid;
 if t2<>t or lu is null then raise exception 'Rejeu identique signalé';end if;
 update public.vehicules set marque_modele='QA Client' where id=vid;
 select activite_demande_le,vue_admin_at into t2,lu from public.clients where id=cid;
 if t2<=t or lu is not null then raise exception 'Modification client ignorée';end if;
 update public.clients set vue_admin_at=clock_timestamp() where id=cid and activite_demande_le=t;
 get diagnostics n=row_count;if n<>0 then raise exception 'Lecture obsolète acceptée';end if;
 t:=t2;
 update public.clients set vue_admin_at=clock_timestamp() where id=cid;
 insert into public.demande_informations_manquantes(client_id,cle,libelle,statut,valeur,transmise_le)
 values(cid,'contact_pc_nom','Contact','transmise','Contact QA',clock_timestamp());
 select activite_demande_le,vue_admin_at into t2,lu from public.clients where id=cid;
 if t2<=t or lu is not null then raise exception 'Réponse client ignorée';end if;
end $$;
rollback;
select 'PASS : admin et envoi serveur sans non-lu ; consultation, modification et réponse client signalées ; concurrence protégée' as resultat;
