-- La réponse sur les clés reste corrigeable dans les archives, pas l'horaire.
alter table public.planning_helixcar add column cles_reponse boolean;
alter table public.planning_restitutions add column reception_reponse boolean, add column remise_reponse boolean;
alter table public.planning_passages_clients add column cles_reponse boolean;
alter table public.planning_passages_clients alter column cles_effectuees_le drop not null;
grant update on public.planning_passages_clients to authenticated;
create policy passages_admin_correction on public.planning_passages_clients for update to authenticated using ((select public.est_admin())) with check ((select public.est_admin()) and cles_effectuees_par=auth.uid() and evenement like 'client:'||client_id::text||':%');

create or replace function private.verrouiller_cles_cloturees() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='planning_helixcar' then
  if (old.cles_effectuees_le is not null or old.cles_reponse is not null) and (new.horaire_confirme,new.empreinte_confirmee) is distinct from (old.horaire_confirme,old.empreinte_confirmee) then raise exception 'Horaire archivé : modification impossible'; end if;
 else
  if (old.reception_effectuee_le is not null or old.reception_reponse is not null) and new.reception_confirmee is distinct from old.reception_confirmee then raise exception 'Réception archivée : horaire non modifiable'; end if;
  if (old.remise_effectuee_le is not null or old.remise_reponse is not null) and new.remise_confirmee is distinct from old.remise_confirmee then raise exception 'Remise archivée : horaire non modifiable'; end if;
 end if;
 return new;
end $$;

create function public.repondre_cles_archive(p_preparation_id uuid,p_etape text,p_reponse boolean,p_revision integer default 0) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.preparations_missions; h public.planning_helixcar; r public.planning_restitutions;
 horaire timestamp; deja_repondu boolean;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 if p_reponse is null then raise exception 'Choisissez Oui ou Non'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_preparation_id::text,0));
 select * into p from public.preparations_missions where id=p_preparation_id;
 if p.id is null then raise exception 'Rendez-vous introuvable'; end if;
 if p_etape in ('avant_stockage','apres_stockage') and p.plan->>'kind'=p_etape then
  insert into public.planning_helixcar(preparation_id) values(p.id) on conflict do nothing;
  select * into h from public.planning_helixcar where preparation_id=p.id for update;
  if h.revision is distinct from p_revision then raise exception 'Le planning a changé. Actualisez avant de continuer.'; end if;
  horaire:=nullif(case when p_etape='avant_stockage' then p.plan->'mission'->>'date_livraison' else p.plan->'mission'->>'date_prise_en_charge' end,'')::timestamp;
  deja_repondu:=h.cles_effectuees_le is not null or h.cles_reponse is not null;
  if not deja_repondu and (horaire is null or now()<(horaire at time zone 'Europe/Paris')+interval '48 hours') then raise exception 'Ce rendez-vous n’est pas encore archivé'; end if;
  update public.planning_helixcar set cles_reponse=p_reponse,cles_effectuees_le=case when p_reponse then coalesce(cles_effectuees_le,now()) else null end,cles_effectuees_par=auth.uid(),revision=revision+1,updated_at=now() where preparation_id=p.id returning * into h;
  return to_jsonb(h);
 elsif p_etape in ('retour_reception','retour_remise') and p.plan->'retour_helixcar' is not null then
  insert into public.planning_restitutions(preparation_id) values(p.id) on conflict do nothing;
  select * into r from public.planning_restitutions where preparation_id=p.id for update;
  if r.revision is distinct from p_revision then raise exception 'Le planning a changé. Actualisez avant de continuer.'; end if;
  horaire:=nullif(p.plan->>p_etape,'')::timestamp;
  deja_repondu:=case when p_etape='retour_reception' then r.reception_effectuee_le is not null or r.reception_reponse is not null else r.remise_effectuee_le is not null or r.remise_reponse is not null end;
  if not deja_repondu and (horaire is null or now()<(horaire at time zone 'Europe/Paris')+interval '48 hours') then raise exception 'Ce rendez-vous n’est pas encore archivé'; end if;
  if p_etape='retour_reception' then
   if not p_reponse and r.remise_effectuee_le is not null then raise exception 'Corrigez d’abord la remise au client avant de retirer la réception'; end if;
   update public.planning_restitutions set reception_reponse=p_reponse,reception_effectuee_le=case when p_reponse then coalesce(reception_effectuee_le,now()) else null end,reception_par=auth.uid(),revision=revision+1,updated_at=now() where preparation_id=p.id returning * into r;
  else
   if p_reponse and r.reception_effectuee_le is null then raise exception 'Confirmez d’abord la réception des clés'; end if;
   update public.planning_restitutions set remise_reponse=p_reponse,remise_effectuee_le=case when p_reponse then coalesce(remise_effectuee_le,now()) else null end,remise_par=auth.uid(),revision=revision+1,updated_at=now() where preparation_id=p.id returning * into r;
  end if;
  return to_jsonb(r);
 end if;
 raise exception 'Rendez-vous HelixCar introuvable';
end $$;
revoke all on function public.repondre_cles_archive(uuid,text,boolean,integer) from public,anon;
grant execute on function public.repondre_cles_archive(uuid,text,boolean,integer) to authenticated;
