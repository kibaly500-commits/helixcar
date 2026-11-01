-- Opt-in uniquement : les anciennes restitutions gardent leur signification.
alter table public.vehicules add column restit_recuperation_client boolean not null default false;
do $$ declare def text; begin
 select pg_get_functiondef('public.champs_publics_vehicule()'::regprocedure) into def;
 if position('''restit_destination''' in def)=0 then raise exception 'Champs véhicule inattendus'; end if;
 execute replace(def,'''restit_destination''','''restit_destination'', ''restit_recuperation_client''');
 select pg_get_functiondef('private.resoudre_destination_restitution()'::regprocedure) into def;
 def:=replace(def,
 'if c.type_service not in (''stockage'',''convoyage_stockage'') then raise exception ''Le retour au stockage nécessite une demande avec stockage''; end if;',
 'if c.type_service not in (''stockage'',''convoyage_stockage'',''convoyage'') then raise exception ''Retour HelixCar réservé au stockage et au convoyage''; end if;');
 execute def;
end $$;
create function private.normaliser_recuperation_restitution() returns trigger
language plpgsql set search_path='' as $$
begin
 new.restit_recuperation_client:=coalesce(new.restit_recuperation_client,false)
  and coalesce(new.restitution_concernee,false) and new.restit_destination='stockage';
 return new;
end $$;
create trigger zz_normaliser_recuperation_restitution before insert or update on public.vehicules
 for each row execute function private.normaliser_recuperation_restitution();
revoke all on function private.normaliser_recuperation_restitution() from public,anon,authenticated;

create table public.planning_restitutions (
 preparation_id uuid primary key references public.preparations_missions(id) on delete cascade,
 reception_confirmee timestamp,
 remise_confirmee timestamp,
 reception_effectuee_le timestamptz,
 remise_effectuee_le timestamptz,
 reception_par uuid,
 remise_par uuid,
 revision integer not null default 0,
 updated_at timestamptz not null default now(),
 check (remise_confirmee is null or (reception_confirmee is not null and remise_confirmee>reception_confirmee)),
 check (remise_effectuee_le is null or reception_effectuee_le is not null)
);
alter table public.planning_restitutions enable row level security;
revoke all on public.planning_restitutions from public,anon,authenticated;
grant select,insert,update on public.planning_restitutions to authenticated;
create policy planning_restitution_admin on public.planning_restitutions for all to authenticated
 using ((select public.est_admin())) with check ((select public.est_admin()));

-- Une préparation possède un trajet partenaire, mais deux rendez-vous internes.
create function private.garder_rendezvous_restitution() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.vehicules%rowtype; r public.planning_restitutions%rowtype;
 reception timestamp; remise timestamp; livraison timestamp; debut timestamp; fin timestamp; h time; j jsonb;
begin
 select * into v from public.vehicules where id=nullif(new.plan->>'vehicule_id','')::uuid and dossier_id=new.client_id;
 if not coalesce(v.restit_recuperation_client,false) or new.plan->'mission'->>'restitution' is distinct from 'true' then return new; end if;
 reception:=nullif(new.plan->>'retour_reception','')::timestamp;
 remise:=nullif(new.plan->>'retour_remise','')::timestamp;
 livraison:=v.date_livraison::date+coalesce(case when v.liv_heure_type='creneau' then v.liv_creneau_fin::time else v.heure_livraison::time end,'00:00'::time);
 debut:=v.restit_date::date+coalesce(case when v.restit_heure_type='creneau' then v.restit_creneau_debut::time else v.restit_heure::time end,'00:00'::time);
 fin:=v.restit_date::date+coalesce(case when v.restit_heure_type='creneau' then v.restit_creneau_fin::time else v.restit_heure::time end,'23:59'::time);
 if reception is not null and (livraison is null or reception<=livraison) then raise exception 'La réception chez HelixCar doit suivre la livraison du premier véhicule'; end if;
 if remise is not null and reception is not null and remise<=reception then raise exception 'La récupération client doit suivre la réception du convoyeur'; end if;
 if remise is not null and (debut is null or remise<debut or remise>fin) then raise exception 'La remise doit respecter la date et le créneau demandés par le client'; end if;
 if new.mission_id is not null and (reception is null or remise is null) then raise exception 'Renseignez les deux rendez-vous : réception convoyeur et récupération client'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.id::text,0));
 select * into r from public.planning_restitutions where preparation_id=new.id;
 if r.reception_effectuee_le is not null and reception is distinct from r.reception_confirmee then raise exception 'La réception a déjà été enregistrée'; end if;
 if r.remise_effectuee_le is not null and remise is distinct from r.remise_confirmee then raise exception 'La remise au client a déjà été enregistrée'; end if;
 j:=jsonb_build_object('demande',jsonb_build_object('date',v.restit_date,'heure',v.restit_heure,'type',v.restit_heure_type,'debut',v.restit_creneau_debut,'fin',v.restit_creneau_fin,'contact',v.restit_contact_nom,'telephone',v.restit_contact_tel));
 new.plan:=jsonb_set(new.plan,'{retour_helixcar}',j);
 new.plan:=jsonb_set(new.plan,'{mission,date_restitution_depart}',coalesce(to_jsonb(reception),'null'::jsonb));
 new.plan:=jsonb_set(new.plan,'{mission,restit_contact_nom}','"HelixCar"'::jsonb);
 new.plan:=jsonb_set(new.plan,'{mission,restit_contact_tel}','null'::jsonb);
 -- L'annonce expose l'arrivée du convoyeur, jamais le rendez-vous client.
 select coalesce(jsonb_agg(case when e->>'label'='Restitution prévue' then jsonb_set(e,'{value}',to_jsonb(coalesce(to_char(reception,'YYYY-MM-DD · HH24:MI'),'Réception chez HelixCar à fixer'))) else e end),'[]'::jsonb)
 into j from jsonb_array_elements(coalesce(new.plan->'rows','[]'::jsonb)) e;
 new.plan:=jsonb_set(new.plan,'{rows}',j);
 select coalesce(jsonb_agg(case when e->>'label'='Restitution prévue' then jsonb_set(e,'{value}',to_jsonb(coalesce(to_char(reception,'YYYY-MM-DD · HH24:MI'),'Réception chez HelixCar à fixer'))) else e end),'[]'::jsonb)
 into j from jsonb_array_elements(coalesce(new.annonce->'rows','[]'::jsonb)) e;
 new.annonce:=jsonb_set(new.annonce,'{rows}',j);
 return new;
end $$;
revoke all on function private.garder_rendezvous_restitution() from public,anon,authenticated;
create trigger garder_rendezvous_restitution before insert or update on public.preparations_missions
 for each row execute function private.garder_rendezvous_restitution();

create function public.action_restitution_helixcar(p_preparation_id uuid,p_action text,p_revision integer default 0) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.preparations_missions; r public.planning_restitutions; reception timestamp; remise timestamp; src jsonb;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_preparation_id::text,0));
 select * into p from public.preparations_missions where id=p_preparation_id;
 if p.id is null or p.plan->'retour_helixcar' is null then raise exception 'Retour HelixCar introuvable'; end if;
 src:=public.source_preparation_missions(p.client_id);
 if p.empreinte is distinct from src->>'empreinte' then raise exception 'La demande a changé. Rouvrez la préparation.'; end if;
 if exists(select 1 from public.missions where id=p.mission_id and statut in ('annule','annulee')) then raise exception 'Mission annulée'; end if;
 if p_action not in ('confirmer_reception','confirmer_remise','recevoir','remettre') or p_action is null then raise exception 'Action inconnue'; end if;
 reception:=nullif(p.plan->>'retour_reception','')::timestamp;
 remise:=nullif(p.plan->>'retour_remise','')::timestamp;
 if reception is null or remise is null or remise<=reception then raise exception 'Vérifiez les deux rendez-vous dans la préparation'; end if;
 insert into public.planning_restitutions(preparation_id) values(p.id) on conflict do nothing;
 select * into r from public.planning_restitutions where preparation_id=p.id for update;
 if r.revision is distinct from p_revision then raise exception 'Le planning a changé. Actualisez avant de continuer.'; end if;
 if p_action='confirmer_reception' then
  if r.reception_effectuee_le is not null then raise exception 'Véhicule déjà réceptionné'; end if;
  update public.planning_restitutions set reception_confirmee=reception,remise_confirmee=case when reception_confirmee is not distinct from reception then remise_confirmee else null end where preparation_id=p.id;
 elsif p_action='confirmer_remise' then
  if r.reception_confirmee is distinct from reception then raise exception 'Confirmez d’abord la réception prévue du convoyeur'; end if;
  if r.remise_effectuee_le is not null then raise exception 'Véhicule déjà remis'; end if;
  update public.planning_restitutions set remise_confirmee=remise where preparation_id=p.id;
 elsif p_action='recevoir' then
  if r.reception_confirmee is distinct from reception then raise exception 'Confirmez l’horaire de réception'; end if;
  update public.planning_restitutions set reception_effectuee_le=coalesce(reception_effectuee_le,now()),reception_par=coalesce(reception_par,auth.uid()) where preparation_id=p.id;
 else
  if r.reception_effectuee_le is null then raise exception 'Réceptionnez le véhicule avant de le remettre au client'; end if;
  if r.remise_confirmee is distinct from remise then raise exception 'Confirmez l’horaire de récupération client'; end if;
  update public.planning_restitutions set remise_effectuee_le=coalesce(remise_effectuee_le,now()),remise_par=coalesce(remise_par,auth.uid()) where preparation_id=p.id;
 end if;
 update public.planning_restitutions set revision=revision+1,updated_at=now() where preparation_id=p.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.action_restitution_helixcar(uuid,text,integer) from public,anon;
grant execute on function public.action_restitution_helixcar(uuid,text,integer) to authenticated;
-- Ne pas invalider les empreintes des brouillons existants pour un champ absent.
do $$ declare def text; begin
 select pg_get_functiondef('public.source_preparation_missions(uuid)'::regprocedure) into def;
 if position('jsonb_agg(to_jsonb(v) order by' in def)=0 then raise exception 'Source de préparation inattendue'; end if;
 execute replace(def,'jsonb_agg(to_jsonb(v) order by','jsonb_agg(case when v.restit_recuperation_client then to_jsonb(v) else to_jsonb(v)-''restit_recuperation_client'' end order by');
end $$;
