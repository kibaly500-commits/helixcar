-- Heures civiles Europe/Paris. L'alerte ne déplace jamais le rendez-vous.
create table public.retards_convoyage (
 id uuid primary key default gen_random_uuid(),
 mission_id uuid not null references public.missions(id) on delete cascade,
 preparation_id uuid not null references public.preparations_missions(id) on delete cascade,
 convoyeur_id uuid not null references public.convoyeurs(id),
 etape text not null check(etape in ('avant_stockage','retour_reception')),
 horaire_prevu timestamp not null,
 arrivee_estimee timestamp not null check(arrivee_estimee>horaire_prevu),
 motif text not null default '' check(length(motif)<=500),
 signale_le timestamptz not null default now(),
 revision integer not null default 1,
 traite_le timestamptz,
 traite_par uuid references auth.users(id),
 unique(preparation_id,etape)
);
create index retards_convoyage_mission_idx on public.retards_convoyage(mission_id);
create index retards_convoyage_convoyeur_idx on public.retards_convoyage(convoyeur_id);
create index retards_convoyage_attente_idx on public.retards_convoyage(signale_le) where traite_le is null;
alter table public.retards_convoyage enable row level security;
revoke all on public.retards_convoyage from public,anon,authenticated;
grant select on public.retards_convoyage to authenticated;
grant update(traite_le,traite_par) on public.retards_convoyage to authenticated;
create policy retards_admin_lecture on public.retards_convoyage for select to authenticated using((select public.est_admin()));
create policy retards_admin_traitement on public.retards_convoyage for update to authenticated using((select public.est_admin())) with check((select public.est_admin()));

-- Les partenaires ne lisent jamais les préparations ni le planning privé.
create function private.rendezvous_retard_convoyeur()
returns table(mission_id uuid,preparation_id uuid,etape text,horaire_prevu timestamp)
language sql stable security definer set search_path='' as $$
 select m.id,p.id,rdv.etape,rdv.horaire
 from public.missions m
 join public.convoyeurs c on c.id=m.convoyeur_id
 join public.preparations_missions p on p.mission_id=m.id
 left join public.planning_helixcar h on h.preparation_id=p.id
 left join public.planning_restitutions r on r.preparation_id=p.id
 cross join lateral (
  select 'avant_stockage'::text etape,coalesce(h.horaire_confirme,nullif(p.plan->'mission'->>'date_livraison','')::timestamp) horaire
  where p.plan->>'kind'='avant_stockage' and h.cles_effectuees_le is null
  union all
  select 'retour_reception',coalesce(r.reception_confirmee,nullif(p.plan->>'retour_reception','')::timestamp)
  where p.plan->'retour_helixcar' is not null and p.plan->'retour_helixcar'<>'null'::jsonb
   and p.plan->'mission'->>'restitution'='true' and r.reception_effectuee_le is null
 ) rdv
 where auth.uid() is not null and c.auth_user_id=auth.uid() and public.partenaire_actif()
 and m.type_mission='convoyage'
 and m.statut in ('acceptee','en_cours','restitution_requise','restitution_en_cours','edl_termine')
 and rdv.horaire is not null
$$;
revoke all on function private.rendezvous_retard_convoyeur() from public,anon,authenticated;

create function public.lister_rendezvous_retard_convoyeur() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Connexion nécessaire' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(rdv)||jsonb_build_object('alerte',
  case when a.convoyeur_id=public.convoyeur_de_session() then jsonb_build_object('arrivee_estimee',a.arrivee_estimee,'motif',a.motif,'traite_le',a.traite_le) else null end))
 from private.rendezvous_retard_convoyeur() rdv
 left join public.retards_convoyage a on a.preparation_id=rdv.preparation_id and a.etape=rdv.etape),'[]'::jsonb);
end $$;
revoke all on function public.lister_rendezvous_retard_convoyeur() from public,anon;
grant execute on function public.lister_rendezvous_retard_convoyeur() to authenticated;

create function public.signaler_retard_convoyage(p_preparation_id uuid,p_etape text,p_horaire_prevu timestamp,p_arrivee_estimee timestamp,p_motif text default '') returns jsonb
language plpgsql security definer set search_path='' as $$
declare rdv record; a public.retards_convoyage; partenaire uuid;
begin
 if auth.uid() is null or not public.partenaire_actif() then raise exception 'Accès convoyeur requis' using errcode='42501'; end if;
 -- Sérialise le signalement avec une attribution ou une modification du rendez-vous.
 perform 1 from public.missions m join public.preparations_missions p on p.mission_id=m.id
 join public.convoyeurs c on c.id=m.convoyeur_id
 where p.id=p_preparation_id and c.auth_user_id=auth.uid() for update of m,p;
 perform 1 from public.planning_helixcar where preparation_id=p_preparation_id for update;
 perform 1 from public.planning_restitutions where preparation_id=p_preparation_id for update;
 select * into rdv from private.rendezvous_retard_convoyeur() where preparation_id=p_preparation_id and etape=p_etape;
 if not found then raise exception 'Aucun rendez-vous éligible sur votre mission' using errcode='42501'; end if;
 if rdv.horaire_prevu is distinct from p_horaire_prevu then raise exception 'Horaire modifié : rechargez le rendez-vous'; end if;
 if p_arrivee_estimee is null or not isfinite(p_arrivee_estimee) or p_arrivee_estimee<=rdv.horaire_prevu
  or p_arrivee_estimee<=timezone('Europe/Paris',now()) then raise exception 'Indiquez une arrivée future, après l’horaire prévu'; end if;
 if length(coalesce(p_motif,''))>500 then raise exception 'Motif limité à 500 caractères'; end if;
 partenaire:=public.convoyeur_de_session();
 select * into a from public.retards_convoyage where preparation_id=p_preparation_id and etape=p_etape for update;
 if a.id is not null and a.convoyeur_id=partenaire and a.horaire_prevu=rdv.horaire_prevu and a.arrivee_estimee=p_arrivee_estimee and a.motif=btrim(coalesce(p_motif,'')) then
  return jsonb_build_object('ok',true,'revision',a.revision);
 end if;
 insert into public.retards_convoyage(mission_id,preparation_id,convoyeur_id,etape,horaire_prevu,arrivee_estimee,motif)
 values(rdv.mission_id,p_preparation_id,partenaire,p_etape,rdv.horaire_prevu,p_arrivee_estimee,btrim(coalesce(p_motif,'')))
 on conflict(preparation_id,etape) do update set mission_id=excluded.mission_id,convoyeur_id=excluded.convoyeur_id,horaire_prevu=excluded.horaire_prevu,
 arrivee_estimee=excluded.arrivee_estimee,motif=excluded.motif,signale_le=now(),revision=public.retards_convoyage.revision+1,traite_le=null,traite_par=null
 returning * into a;
 return jsonb_build_object('ok',true,'revision',a.revision);
end $$;
revoke all on function public.signaler_retard_convoyage(uuid,text,timestamp,timestamp,text) from public,anon;
grant execute on function public.signaler_retard_convoyage(uuid,text,timestamp,timestamp,text) to authenticated;

create function public.traiter_retard_convoyage(p_id uuid,p_revision integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès administrateur requis' using errcode='42501'; end if;
 update public.retards_convoyage set traite_le=now(),traite_par=auth.uid() where id=p_id and revision=p_revision and traite_le is null;
 if not found then raise exception 'Alerte modifiée ou déjà traitée : actualisez le planning'; end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.traiter_retard_convoyage(uuid,integer) from public,anon;
grant execute on function public.traiter_retard_convoyage(uuid,integer) to authenticated;
create trigger hc_sync_change after insert or update or delete on public.retards_convoyage
for each row execute function private.hc_signaler_modification();
