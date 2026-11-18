-- Un rendez-vous est clôturé par la remise des clés, jamais par sa date.
create function private.verrouiller_cles_cloturees() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_table_name='planning_helixcar' then
 if old.cles_effectuees_le is not null and to_jsonb(new) is distinct from to_jsonb(old) then
  raise exception 'Rendez-vous archivé : consultation uniquement';
 end if;
 end if;
 if tg_table_name='planning_restitutions' then
  if old.reception_effectuee_le is not null and (new.reception_confirmee,new.reception_effectuee_le,new.reception_par) is distinct from (old.reception_confirmee,old.reception_effectuee_le,old.reception_par) then raise exception 'Réception archivée : consultation uniquement'; end if;
  if old.remise_effectuee_le is not null and (new.remise_confirmee,new.remise_effectuee_le,new.remise_par) is distinct from (old.remise_confirmee,old.remise_effectuee_le,old.remise_par) then raise exception 'Remise archivée : consultation uniquement'; end if;
 end if;
 return new;
end $$;
revoke all on function private.verrouiller_cles_cloturees() from public,anon,authenticated;
create trigger verrouiller_cles_cloturees before update on public.planning_helixcar for each row execute function private.verrouiller_cles_cloturees();
create trigger verrouiller_cles_cloturees before update on public.planning_restitutions for each row execute function private.verrouiller_cles_cloturees();

-- API étroite : une heure au point HelixCar, le même jour, avec contrôle concurrent.
-- Les coordonnées, tarifs, identités et rendez-vous client ne sont jamais fournis par l'appelant.
create function private.modifier_horaire_helixcar(p_preparation_id uuid,p_etape text,p_horaire timestamp,p_ancien timestamp) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.preparations_missions; h public.planning_helixcar; r public.planning_restitutions;
 champ text; libelle text; ancien timestamp; j jsonb; a jsonb; description text; autre timestamp;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès réservé à HelixCar'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_preparation_id::text,0));
 select * into p from public.preparations_missions where id=p_preparation_id for update;
 if p.id is null then raise exception 'Rendez-vous introuvable'; end if;
 if exists(select 1 from public.missions where id=p.mission_id and statut in ('annule','annulee','terminee')) then raise exception 'Mission clôturée : consultation uniquement'; end if;
 select * into h from public.planning_helixcar where preparation_id=p.id for update;
 select * into r from public.planning_restitutions where preparation_id=p.id for update;
 if p_etape in ('avant_stockage','apres_stockage') and p.plan->>'kind'=p_etape then
  if h.cles_effectuees_le is not null then raise exception 'Rendez-vous archivé : consultation uniquement'; end if;
  champ:=case when p_etape='avant_stockage' then 'date_livraison' else 'date_prise_en_charge' end;
  libelle:=case when p_etape='avant_stockage' then 'Livraison' else 'Prise en charge' end;
  ancien:=nullif(p.plan->'mission'->>champ,'')::timestamp;
 elsif p_etape in ('retour_reception','retour_remise') and p.plan->'retour_helixcar' is not null then
  if (p_etape='retour_reception' and r.reception_effectuee_le is not null) or (p_etape='retour_remise' and r.remise_effectuee_le is not null) then raise exception 'Rendez-vous archivé : consultation uniquement'; end if;
  ancien:=nullif(p.plan->>p_etape,'')::timestamp;
  champ:='date_restitution_depart';libelle:='Restitution prévue';
 else raise exception 'Rendez-vous HelixCar introuvable'; end if;
 if ancien is null or ancien is distinct from p_ancien then raise exception 'L’horaire a changé. Actualisez le planning.'; end if;
 if p_horaire is null or p_horaire::date<>ancien::date then raise exception 'Modifiez uniquement l’heure du rendez-vous'; end if;
 if p_horaire=ancien then return jsonb_build_object('ok',true); end if;
 j:=p.plan;a:=p.annonce;
 if p_etape in ('avant_stockage','apres_stockage') then
  j:=jsonb_set(j,array['mission',champ],to_jsonb(to_char(p_horaire,'YYYY-MM-DD"T"HH24:MI')));
  j:=jsonb_set(j,array[case when p_etape='avant_stockage' then 'heure_remise' else 'heure_retrait' end],to_jsonb(to_char(p_horaire,'HH24:MI')));
  if (j->'mission'->>'date_livraison')::timestamp<(j->'mission'->>'date_prise_en_charge')::timestamp then raise exception 'La livraison doit suivre la prise en charge'; end if;
 else
  j:=jsonb_set(j,array[p_etape],to_jsonb(to_char(p_horaire,'YYYY-MM-DD"T"HH24:MI')));
  if (j->>'retour_remise')::timestamp<=(j->>'retour_reception')::timestamp then raise exception 'La remise doit suivre la réception'; end if;
  if p_etape='retour_reception' then
   if p_horaire<=(j->'mission'->>'date_livraison')::timestamp then raise exception 'Le retour doit suivre la livraison'; end if;
   j:=jsonb_set(j,array['mission',champ],to_jsonb(to_char(p_horaire,'YYYY-MM-DD"T"HH24:MI')));
  end if;
 end if;
 if p_etape<>'retour_remise' then
  select coalesce(jsonb_agg(case when e->>'label'=libelle then jsonb_set(e,'{value}',to_jsonb(to_char(p_horaire,'YYYY-MM-DD · HH24:MI'))) else e end order by n),'[]'::jsonb) into a from jsonb_array_elements(coalesce(p.annonce->'rows','[]')) with ordinality x(e,n);
  a:=jsonb_set(p.annonce,'{rows}',a);
  select coalesce(jsonb_agg(case when e->>'label'=libelle then jsonb_set(e,'{value}',to_jsonb(to_char(p_horaire,'YYYY-MM-DD · HH24:MI'))) else e end order by n),'[]'::jsonb) into j from jsonb_array_elements(coalesce(j->'rows','[]')) with ordinality x(e,n);
  -- Reprendre les champs horaires calculés ci-dessus, puis remplacer les lignes.
  j:=jsonb_set(p.plan,'{rows}',j);
  if p_etape in ('avant_stockage','apres_stockage') then
   j:=jsonb_set(jsonb_set(j,array['mission',champ],to_jsonb(to_char(p_horaire,'YYYY-MM-DD"T"HH24:MI'))),array[case when p_etape='avant_stockage' then 'heure_remise' else 'heure_retrait' end],to_jsonb(to_char(p_horaire,'HH24:MI')));
  else j:=jsonb_set(jsonb_set(j,array[p_etape],to_jsonb(to_char(p_horaire,'YYYY-MM-DD"T"HH24:MI'))),array['mission',champ],to_jsonb(to_char(p_horaire,'YYYY-MM-DD"T"HH24:MI'))); end if;
 end if;
 update public.preparations_missions set plan=j,annonce=a,updated_at=now() where id=p.id returning * into p;
 if p.mission_id is not null and p_etape<>'retour_remise' then
  execute format('update public.missions set %I=$1 where id=$2',champ) using p_horaire,p.mission_id;
  select string_agg((e->>'label')||' : '||(e->>'value'),E'\n' order by n) into description from jsonb_array_elements(p.annonce->'rows') with ordinality x(e,n);
  update public.opportunites set description_publique=description where mission_id=p.mission_id;
 end if;
 if p_etape in ('avant_stockage','apres_stockage') then
  insert into public.planning_helixcar(preparation_id,horaire_confirme,empreinte_confirmee,revision) values(p.id,p_horaire,p.empreinte,1)
  on conflict(preparation_id) do update set horaire_confirme=excluded.horaire_confirme,empreinte_confirmee=excluded.empreinte_confirmee,revision=planning_helixcar.revision+1,updated_at=now();
 else
  insert into public.planning_restitutions(preparation_id) values(p.id) on conflict do nothing;
  if p_etape='retour_reception' then
   update public.planning_restitutions set reception_confirmee=p_horaire,revision=revision+1,updated_at=now() where preparation_id=p.id;
  else
   update public.planning_restitutions set remise_confirmee=case when reception_confirmee is not null then p_horaire else null end,revision=revision+1,updated_at=now() where preparation_id=p.id;
  end if;
 end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.modifier_horaire_helixcar(uuid,text,timestamp,timestamp) from public,anon;
grant execute on function private.modifier_horaire_helixcar(uuid,text,timestamp,timestamp) to authenticated;
create function public.modifier_horaire_helixcar(p_preparation_id uuid,p_etape text,p_horaire timestamp,p_ancien timestamp) returns jsonb
language sql security invoker set search_path='' as $$select private.modifier_horaire_helixcar(p_preparation_id,p_etape,p_horaire,p_ancien)$$;
revoke all on function public.modifier_horaire_helixcar(uuid,text,timestamp,timestamp) from public,anon;
grant execute on function public.modifier_horaire_helixcar(uuid,text,timestamp,timestamp) to authenticated;

-- Passages directs du client : même confirmation physique, sans créer de mission.
create table public.planning_passages_clients (
 evenement text primary key,
 client_id uuid not null references public.clients(id),
 cles_effectuees_le timestamptz not null default now(),
 cles_effectuees_par uuid not null default auth.uid()
);
alter table public.planning_passages_clients enable row level security;
revoke all on public.planning_passages_clients from public,anon,authenticated;
grant select,insert on public.planning_passages_clients to authenticated;
create policy passages_admin_lecture on public.planning_passages_clients for select to authenticated using ((select public.est_admin()));
create policy passages_admin_confirmation on public.planning_passages_clients for insert to authenticated with check ((select public.est_admin()) and cles_effectuees_par=auth.uid() and evenement like 'client:'||client_id::text||':%');
create index planning_passages_clients_client_idx on public.planning_passages_clients(client_id);
