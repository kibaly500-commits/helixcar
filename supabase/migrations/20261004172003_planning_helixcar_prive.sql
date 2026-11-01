-- Planning privé : aucune donnée client ou mission existante modifiée.
create table public.planning_helixcar (
 preparation_id uuid primary key references public.preparations_missions(id) on delete cascade,
 horaire_confirme timestamp,
 empreinte_confirmee text,
 cles_effectuees_le timestamptz,
 cles_effectuees_par uuid,
 revision integer not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.planning_helixcar enable row level security;
revoke all on public.planning_helixcar from public,anon,authenticated;
grant select,insert,update on public.planning_helixcar to authenticated;
create policy planning_admin_select on public.planning_helixcar for select to authenticated using ((select public.est_admin()));
create policy planning_admin_insert on public.planning_helixcar for insert to authenticated with check ((select public.est_admin()));
create policy planning_admin_update on public.planning_helixcar for update to authenticated using ((select public.est_admin())) with check ((select public.est_admin()));
create function public.action_planning_helixcar(p_preparation_id uuid,p_action text,p_revision integer default 0) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare p public.preparations_missions; r public.planning_helixcar; horaire timestamp; src jsonb;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 select * into p from public.preparations_missions where id=p_preparation_id ;
 if p.id is null or coalesce(p.plan->>'kind','') not in ('avant_stockage','apres_stockage') then raise exception 'Rendez-vous HelixCar introuvable'; end if;
 if p.mission_id is null then
  src:=public.source_preparation_missions(p.client_id);
  if p.empreinte is distinct from src->>'empreinte' then raise exception 'La demande a changé. Rouvrez la préparation.'; end if;
 end if;
 if coalesce(p_action,'') not in ('confirmer','cles') then raise exception 'Action inconnue'; end if;
 insert into public.planning_helixcar(preparation_id) values(p.id) on conflict do nothing;
 select * into r from public.planning_helixcar where preparation_id=p.id for update;
 if r.revision is distinct from p_revision then raise exception 'Le planning a changé dans un autre onglet. Actualisez avant de continuer.'; end if;
 horaire:=nullif(case when p.plan->>'kind'='avant_stockage' then p.plan->'mission'->>'date_livraison' else p.plan->'mission'->>'date_prise_en_charge' end,'')::timestamp;
 if p_action='confirmer' then
  if horaire is null then raise exception 'Renseignez puis enregistrez l’horaire de remise dans la préparation.'; end if;
  if r.cles_effectuees_le is not null then raise exception 'La remise des clés a déjà été enregistrée.'; end if;
  update public.planning_helixcar set horaire_confirme=horaire,empreinte_confirmee=p.empreinte,revision=revision+1,updated_at=now() where preparation_id=p.id returning * into r;
 else
  if r.horaire_confirme is distinct from horaire or r.empreinte_confirmee is distinct from p.empreinte then raise exception 'Le rendez-vous a changé : confirmez de nouveau l’horaire.'; end if;
  if r.horaire_confirme is null then raise exception 'Confirmez d’abord le rendez-vous.'; end if;
  if r.cles_effectuees_le is not null then return to_jsonb(r); end if;
  update public.planning_helixcar set cles_effectuees_le=now(),cles_effectuees_par=auth.uid(),revision=revision+1,updated_at=now() where preparation_id=p.id returning * into r;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.action_planning_helixcar(uuid,text,integer) from public,anon;
grant execute on function public.action_planning_helixcar(uuid,text,integer) to authenticated;
