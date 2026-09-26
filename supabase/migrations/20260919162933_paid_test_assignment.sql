-- Attribution atomique des missions de recette, après publication administrative.
create table public.notifications_mission_test(
 id uuid primary key default gen_random_uuid(),
 mission_id uuid not null references public.missions(id),
 role_destinataire text not null check(role_destinataire in ('client','admin','convoyeur')),
 destinataire text not null,
 snapshot jsonb not null,
 payload jsonb,
 premier_essai timestamptz,
 fournisseur_id text,
 cree_le timestamptz not null default now(),
 unique(mission_id,role_destinataire)
);
alter table public.notifications_mission_test enable row level security;
revoke all on public.notifications_mission_test from public,anon,authenticated;
grant select,insert,update on public.notifications_mission_test to service_role;

-- La publication ouvre la mission tout en conservant ses coordonnées privées.
create function public.ouvrir_mission_test_publiee() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
 if new.statut='a_pourvoir' and old.statut='brouillon' then
   update public.missions set statut='en_attente'
    where id=new.mission_id and devis_source_id is not null and statut='brouillon';
 end if;
 return null;
end $$;
revoke all on function public.ouvrir_mission_test_publiee() from public;
create trigger ouvrir_mission_test_publiee after update on public.opportunites for each row execute function public.ouvrir_mission_test_publiee();

-- Pas d'intention d'e-mail TEST vers les vrais partenaires.
create function public.filtrer_notification_opportunite_test() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.opportunites o join public.missions m on m.id=o.mission_id where o.id=new.opportunite_id and m.devis_source_id is not null) then
   return null; -- Les confirmations de ce parcours passent par la file dédiée ci-dessus.
 end if;
 return new;
end $$;
revoke all on function public.filtrer_notification_opportunite_test() from public;
create trigger filtrer_notification_opportunite_test before insert on public.opportunite_notifications for each row execute function public.filtrer_notification_opportunite_test();

create or replace view public.v_opportunites_partenaire as
select o.id,o.statut,o.intitule,o.categorie,o.date_debut,o.date_fin,o.duree_texte,o.zone_generale,
 o.ponctuelle,o.statut_independant,o.badges_requis,o.nb_professionnels,o.description_publique,o.publiee_le,
 ca.etat as ma_candidature_etat,ca.created_at as ma_candidature_le,
 (m.devis_source_id is not null) as acceptation_directe,
 case when m.devis_source_id is not null then m.remuneration_prevue end as remuneration_prevue,
 case when m.devis_source_id is not null then m.date_prise_en_charge end as depart_prevu,
 case when m.devis_source_id is not null then m.date_livraison end as livraison_prevue,
 case when m.devis_source_id is not null then m.restitution end as restitution_prevue,
 case when m.devis_source_id is not null then m.plateau end as transport_plateau
from public.opportunites o join public.missions m on m.id=o.mission_id
left join public.opportunite_candidatures ca on ca.opportunite_id=o.id and ca.convoyeur_id=public.convoyeur_de_session()
where public.partenaire_actif() and o.statut<>'brouillon'
 and (o.statut='a_pourvoir' or ca.id is not null)
 and (o.badges_requis && public.activites_validees_partenaire())
 and (m.devis_source_id is null or (
   exists(select 1 from public.convoyeurs c where c.id=public.convoyeur_de_session() and lower(c.email) in ('kibaly500@gmail.com','kibaly500+qa-final01@gmail.com'))
   and (m.convoyeur_id is null or m.convoyeur_id=public.convoyeur_de_session())
 ));
alter view public.v_opportunites_partenaire set (security_invoker=false,security_barrier=true);

create function public.accepter_opportunite_payee_test(p_opportunite_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.opportunites%rowtype; m public.missions%rowtype; c public.convoyeurs%rowtype;
 cl public.clients%rowtype; ancien text; instant timestamptz:=now();
begin
 if auth.uid() is null or not public.partenaire_actif() then return jsonb_build_object('ok',false,'code','NON_AUTORISE'); end if;
 select * into c from public.convoyeurs where id=public.convoyeur_de_session();
 if lower(c.email) not in ('kibaly500@gmail.com','kibaly500+qa-final01@gmail.com') then return jsonb_build_object('ok',false,'code','NON_AUTORISE'); end if;
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
 on conflict(mission_id,role_destinataire) do nothing;
 return jsonb_build_object('ok',true,'code','ATTRIBUEE','mission_id',m.id);
end $$;
revoke all on function public.accepter_opportunite_payee_test(uuid) from public,anon;
grant execute on function public.accepter_opportunite_payee_test(uuid) to authenticated;

-- Le paiement convoyeur nécessite la clôture et la validation administrative.
create function public.garder_finance_mission_test() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
 if new.devis_source_id is not null and new.validee_paiement and not coalesce(old.validee_paiement,false) then
   if new.statut<>'terminee' or (auth.uid() is not null and not public.est_admin()) then
     raise exception 'Validation financiere reservee a HelixCar apres fin de mission';
   end if;
   new.date_validation_paiement:=now();
 end if;
 return new;
end $$;
revoke all on function public.garder_finance_mission_test() from public;
create trigger garder_finance_mission_test before update on public.missions for each row execute function public.garder_finance_mission_test();
