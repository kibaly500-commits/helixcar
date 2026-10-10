alter table public.notifications_mission_test add column evenement text not null default 'attribution';
alter table public.notifications_mission_test drop constraint notifications_mission_test_mission_id_role_destinataire_key;
alter table public.notifications_mission_test add constraint notification_mission_test_evenement_unique unique(mission_id,evenement,role_destinataire);
-- L'ancienne insertion par RPC d'attribution utilise ON CONFLICT sans cible.
create function public.journaliser_etape_mission_test() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare evenement text; cl public.clients%rowtype; cv public.convoyeurs%rowtype;
begin
 if new.devis_source_id is null then return null; end if;
 if new.statut is distinct from old.statut then
   evenement:=case new.statut when 'en_cours' then 'depart' when 'restitution_requise' then 'arrivee' when 'restitution_en_cours' then 'restitution_depart'
    when 'edl_termine' then case when new.restitution then 'restitution_arrivee' else 'arrivee' end when 'terminee' then 'terminee' end;
 end if;
 if new.validee_paiement and not coalesce(old.validee_paiement,false) then evenement:='validee'; end if;
 if evenement is null then return null; end if;
 select * into cl from public.clients where id=new.client_id;
 select * into cv from public.convoyeurs where id=new.convoyeur_id;
 insert into public.notifications_mission_test(mission_id,evenement,role_destinataire,destinataire,snapshot)
 select new.id,evenement,x.role,x.email,jsonb_build_object('mission',to_jsonb(new),'convoyeur_nom',concat_ws(' ',cv.prenom,cv.nom),'client_nom',concat_ws(' ',cl.prenom,cl.nom),'constate_le',now())
 from (values('client',cl.email),('admin','helixcarpro@gmail.com')) x(role,email)
 on conflict do nothing;
 return null;
end $$;
revoke all on function public.journaliser_etape_mission_test() from public;
create trigger journaliser_etape_mission_test after update on public.missions for each row execute function public.journaliser_etape_mission_test();

create or replace function public.accepter_opportunite_payee_test(p_opportunite_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.opportunites%rowtype; m public.missions%rowtype; c public.convoyeurs%rowtype;
 cl public.clients%rowtype; ancien text; instant timestamptz:=now();
begin
 if auth.uid() is null or not public.partenaire_actif() then return jsonb_build_object('ok',false,'code','NON_AUTORISE'); end if;
 select * into c from public.convoyeurs where id=public.convoyeur_de_session();
 if c.id is null or lower(c.email) not in ('kibaly500@gmail.com','kibaly500+qa-final01@gmail.com') then return jsonb_build_object('ok',false,'code','NON_AUTORISE'); end if;
 select * into o from public.opportunites where id=p_opportunite_id for update;
 if not found or o.statut='brouillon' or not(o.badges_requis && public.activites_validees_partenaire()) then return jsonb_build_object('ok',false,'code','INTROUVABLE'); end if;
 select * into m from public.missions where id=o.mission_id for update;
 if m.devis_source_id is null then return jsonb_build_object('ok',false,'code','HORS_RECETTE'); end if;
 if m.convoyeur_id=c.id then return jsonb_build_object('ok',true,'code','DEJA_ATTRIBUEE','mission_id',m.id); end if;
 if m.convoyeur_id is not null or o.statut<>'a_pourvoir' or m.statut<>'en_attente' then return jsonb_build_object('ok',false,'code','DEJA_PRISE'); end if;
 if o.nb_professionnels<>1 then return jsonb_build_object('ok',false,'code','UN_CONVOYEUR_PAR_VEHICULE'); end if;
 -- Les triggers recontrôlent le paiement, le dossier et le tarif.
 update public.missions set convoyeur_id=c.id,statut='acceptee' where id=m.id;
 ancien:=current_setting('hc.decision_opportunite',true);
 perform set_config('hc.decision_opportunite','1',true);
 insert into public.opportunite_candidatures(opportunite_id,convoyeur_id,etat,decidee_le)
 values(o.id,c.id,'retenu',instant)
 on conflict(opportunite_id,convoyeur_id) do update set etat='retenu',decidee_le=excluded.decidee_le;
 update public.opportunites set statut='pourvue',cloturee_le=instant where id=o.id;
 perform set_config('hc.decision_opportunite',coalesce(ancien,''),true);
 select * into cl from public.clients where id=m.client_id;
 insert into public.notifications_mission_test(mission_id,role_destinataire,destinataire,snapshot)
 select m.id,x.role,x.email,jsonb_build_object('mission',to_jsonb(m),'convoyeur_nom',concat_ws(' ',c.prenom,c.nom),'client_nom',concat_ws(' ',cl.prenom,cl.nom),'attribuee_le',instant)
 from (values('client',cl.email),('admin','helixcarpro@gmail.com'),('convoyeur',c.email)) x(role,email)
 on conflict do nothing;
 return jsonb_build_object('ok',true,'code','ATTRIBUEE','mission_id',m.id);
end $$;
revoke all on function public.accepter_opportunite_payee_test(uuid) from public,anon;
grant execute on function public.accepter_opportunite_payee_test(uuid) to authenticated;

