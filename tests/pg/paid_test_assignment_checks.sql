-- Recette SQL transactionnelle : aucune identité, décision ou mission conservée.
-- Aucun appel réseau. Les notifications créées ici sont annulées au ROLLBACK.
begin;
do $$
declare admin_uid uuid; u1 uuid:=gen_random_uuid(); u2 uuid:=gen_random_uuid();
 c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); d uuid; client uuid; o uuid; m uuid; r jsonb; n integer;
begin
 select auth_user_id into admin_uid from public.admins where actif limit 1;
 if admin_uid is null then raise exception 'Admin de recette absent'; end if;
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 select id,client_id into d,client from public.devis where reference='DEV-2026-0081' and paiement_statut='paye';
 select id into m from public.missions where devis_source_id=d order by reference limit 1;
 select id into o from public.opportunites where mission_id=m;
 if o is null then raise exception 'Brouillon absent'; end if;
 -- Une identité éphémère ; le second compte existant est seulement lu.
 select id,auth_user_id into c2,u2 from public.convoyeurs where lower(email)='kibaly500@gmail.com' and auth_user_id is not null limit 1;
 if u2 is null then raise exception 'Second compte de recette absent'; end if;
 insert into auth.users(id,email) values(u1,'qa-ephemere-1@example.test');
 insert into public.convoyeurs(id,auth_user_id,prenom,nom,email,statut,activites)
 values(c1,u1,'TEST-QA','EPHEMERE','kibaly500+qa-final01@gmail.com','actif',array['convoyage']);
 -- Décisions simulées dans cette transaction non visible des autres sessions.
 insert into public.convoyeur_decisions(convoyeur_id,activite,decision) values(c1,'convoyage','oui'),(c2,'convoyage','oui')
 on conflict(convoyeur_id,activite) do update set decision='oui';
 -- Le client ne peut pas prendre la mission.
 perform set_config('request.jwt.claim.sub',(select auth_user_id::text from public.clients where id=client),true);
 r:=public.accepter_opportunite_payee_test(o);
 if r->>'code'<>'NON_AUTORISE' then raise exception 'Client autorise a prendre une mission'; end if;
 -- Un partenaire valide ne voit pas et ne prend pas un brouillon.
 perform set_config('request.jwt.claim.sub',u1::text,true);
 r:=public.accepter_opportunite_payee_test(o);
 if r->>'code'<>'INTROUVABLE' then raise exception 'Brouillon accessible'; end if;
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 insert into public.demande_informations_manquantes(client_id,cle,libelle,statut,valeur)
 select client,i.cle,i.libelle,'validee','TEST-QA TRANSACTION ANNULEE' from public.informations_demande(client) i
 on conflict(client_id,cle) do update set statut='validee',valeur=excluded.valeur;
 update public.missions set remuneration_prevue=300 where id=m;
 perform set_config('hc.decision_opportunite','1',true);
 update public.opportunites set badges_requis=array['convoyage'],nb_professionnels=1,description_publique='TEST-QA transaction annulee',intitule='TEST-QA attribution' where id=o;
 perform set_config('hc.decision_opportunite','',true);
 r:=public.publier_opportunite(o);
 if r->>'ok'<>'true' then raise exception 'Publication refusee: %',r; end if;
 perform set_config('request.jwt.claim.sub',u1::text,true);
 select count(*) into n from public.v_opportunites_partenaire where id=o;
 if n<>1 then raise exception 'Mission eligible invisible'; end if;
 r:=public.accepter_opportunite_payee_test(o);
 if r->>'code'<>'ATTRIBUEE' then raise exception 'Attribution refusee: %',r; end if;
 r:=public.accepter_opportunite_payee_test(o);
 if r->>'code'<>'DEJA_ATTRIBUEE' then raise exception 'Rejeu non idempotent: %',r; end if;
 -- Les états des lieux ne peuvent être sautés ni validés sans leurs preuves.
 r:=public.enregistrer_edl_test(m,'depart',gen_random_uuid(),jsonb_build_object('km',0,'carburant','Plein','etat_general','bon','photos','{}'::jsonb));
 if r->>'code'<>'PHOTOS_MANQUANTES' then raise exception 'EDL sans photos autorise: %',r; end if;
 begin
  update public.missions set statut='en_cours' where id=m;
  raise exception 'TEST_ECHEC_EDL';
 exception when raise_exception then
  if sqlerrm not like 'Etat des lieux signe manquant%' then raise; end if;
 end;
 begin
  insert into public.etats_des_lieux(mission_id,phase,km) values(m,'depart',0);
  raise exception 'TEST_ECHEC_INSERT_EDL';
 exception when raise_exception then
  if sqlerrm not like 'EDL signe%' then raise; end if;
 end;
 perform set_config('request.jwt.claim.sub',u2::text,true);
 r:=public.accepter_opportunite_payee_test(o);
 if r->>'code'<>'DEJA_PRISE' then raise exception 'Double attribution possible: %',r; end if;
 select count(*) into n from public.v_opportunites_partenaire where id=o;
 if n<>0 then raise exception 'Mission encore visible pour second partenaire'; end if;
 select count(*) into n from public.notifications_mission_test where mission_id=m;
 if n<>3 then raise exception 'Nombre incorrect de notifications: %',n; end if;
 perform set_config('request.jwt.claim.sub',admin_uid::text,true);
 begin
  update public.missions set validee_paiement=true where id=m;
  raise exception 'TEST_ECHEC_FINANCE';
 exception when raise_exception then
  if sqlerrm not like 'Validation financiere%' then raise; end if;
 end;
end $$;
select 'PASS : brouillon prive, client refuse, publication controlee, attribution unique, rejeu, disparition et finance protegee' as resultat;
rollback;
