-- Une récompense par compte et seuil, conservée même après son envoi.
create table public.fidelite_recompenses (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id),
 seuil integer not null check(seuil>0 and seuil%2000=0),
 statut text not null default 'a_preparer' check(statut in ('a_preparer','prete','envoyee','suspendue')),
 debloquee_le timestamptz not null default now(),
 prete_le timestamptz, envoyee_le timestamptz, modifiee_par uuid references auth.users(id),
 unique(auth_user_id,seuil)
);
alter table public.fidelite_recompenses enable row level security;
revoke all on public.fidelite_recompenses from anon,authenticated;
grant select on public.fidelite_recompenses to authenticated;
create policy recompenses_lecture on public.fidelite_recompenses for select to authenticated
 using(auth_user_id=(select auth.uid()) or (select public.est_admin()));
create index recompenses_a_traiter on public.fidelite_recompenses(statut,debloquee_le);

-- Sérialiser les mouvements d'un même compte avant de calculer les seuils.
create function private.verrou_fidelite_compte() returns trigger language plpgsql security definer set search_path='' as $$
begin perform pg_advisory_xact_lock(hashtextextended(new.auth_user_id::text,1847)); return new; end $$;
revoke all on function private.verrou_fidelite_compte() from public,anon,authenticated;
create trigger fidelite_verrou_compte before insert on public.fidelite_mouvements for each row execute function private.verrou_fidelite_compte();

create function private.synchroniser_recompenses(p_compte uuid) returns void language plpgsql security definer set search_path='' as $$
declare solde bigint; begin
 perform pg_advisory_xact_lock(hashtextextended(p_compte::text,1847));
 select greatest(coalesce(sum(points),0),0) into solde from public.fidelite_mouvements where auth_user_id=p_compte;
 insert into public.fidelite_recompenses(auth_user_id,seuil)
 select p_compte,s::integer from generate_series(2000,solde,2000) s
 on conflict(auth_user_id,seuil) do nothing;
 -- Un remboursement ne doit pas laisser une box non envoyée à expédier.
 update public.fidelite_recompenses set statut='suspendue'
 where auth_user_id=p_compte and seuil>solde and statut in ('a_preparer','prete');
 update public.fidelite_recompenses set statut='a_preparer',prete_le=null
 where auth_user_id=p_compte and seuil<=solde and statut='suspendue';
end $$;
revoke all on function private.synchroniser_recompenses(uuid) from public,anon,authenticated;
create function private.recompenses_apres_points() returns trigger language plpgsql security definer set search_path='' as $$
begin perform private.synchroniser_recompenses(new.auth_user_id);return null;end $$;
revoke all on function private.recompenses_apres_points() from public,anon,authenticated;
create trigger recompenses_apres_points after insert on public.fidelite_mouvements for each row execute function private.recompenses_apres_points();

create function private.avancer_recompense(p_id uuid,p_statut text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fidelite_recompenses; begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Action réservée à HelixCar.' using errcode='42501';end if;
 select * into r from public.fidelite_recompenses where id=p_id;
 if not found then raise exception 'Récompense introuvable.';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.auth_user_id::text,1847));
 select * into r from public.fidelite_recompenses where id=p_id for update;
 if p_statut not in ('prete','envoyee') or p_statut is null then raise exception 'Étape invalide.';end if;
 if r.statut=p_statut then return jsonb_build_object('ok',true);end if;
 if not ((r.statut='a_preparer' and p_statut='prete') or (r.statut='prete' and p_statut='envoyee')) then raise exception 'Cette récompense a changé. Actualisez la liste.';end if;
 update public.fidelite_recompenses set statut=p_statut,modifiee_par=auth.uid(),
 prete_le=case when p_statut='prete' then now() else prete_le end,
 envoyee_le=case when p_statut='envoyee' then now() else envoyee_le end where id=p_id;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function private.avancer_recompense(uuid,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.avancer_recompense(uuid,text) to authenticated;
create function public.avancer_recompense(p_id uuid,p_statut text) returns jsonb language sql security invoker set search_path='' as $$select private.avancer_recompense(p_id,p_statut)$$;
revoke all on function public.avancer_recompense(uuid,text) from public,anon;
grant execute on function public.avancer_recompense(uuid,text) to authenticated;

create view public.v_recompenses_admin with(security_invoker=true) as
 select r.*,cc.numero as numero_client,c.prenom,c.nom,c.societe,c.email,
 (r.seuil-1)/10000+1 as cycle,((r.seuil/2000-1)%5)+1 as palier
 from public.fidelite_recompenses r left join public.comptes_clients cc on cc.auth_user_id=r.auth_user_id
 left join lateral(select prenom,nom,societe,email from public.clients where auth_user_id=r.auth_user_id order by created_at desc,id limit 1)c on true
 where public.est_admin();
grant select on public.v_recompenses_admin to authenticated;

create or replace function public.fidelite_prochain_palier(p_solde integer) returns jsonb language sql immutable set search_path='' as $$
 with s as(select coalesce(p_solde,0) brut,greatest(coalesce(p_solde,0),0) solde),p as(select *,solde/2000*2000 courant,(solde/2000+1)*2000 suivant from s)
 select jsonb_build_object('solde',brut,'pas',2000,'palier_courant',courant,'palier_numero',courant/2000,
 'palier_courant_nom',case when courant=0 then null else 'Palier '||((courant/2000-1)%5+1) end,
 'prochain_seuil',suivant,'prochain_nom','Palier '||((suivant/2000-1)%5+1),'points_restants',suivant-solde,
 'box_mystere',true,'boxes_mystere_acquises',courant/2000,'cycle',solde/10000+1) from p;
$$;
-- Renforcer le crédit existant sans changer sa clé d'idempotence ni l'arrondi TTC.
do $$ declare def text;begin
 select pg_get_functiondef('public.crediter_points_prestation(uuid)'::regprocedure) into def;
 if position($old$if d.paiement_statut is distinct from 'paye' then$old$ in def)=0 or position('and m.client_id = d.client_id' in def)=0 then raise exception 'Contrat de crédit inattendu'; end if;
 def:=replace(def,$old$if d.paiement_statut is distinct from 'paye' then$old$, $new$if d.paiement_statut is distinct from 'paye' or d.statut is distinct from 'accepte' or d.annule_le is not null then$new$);
 def:=replace(def,'and m.client_id = d.client_id','and m.client_id = d.client_id and (m.devis_source_id = d.id or m.devis_source_id is null)');
 execute def;
end $$;
-- Le contrat de vue conserve ses colonnes ; l'identité du partenaire n'est plus exposée.
do $$ declare def text;begin
 select pg_get_viewdef('public.v_mes_missions'::regclass,true) into def;
 if position('m.convoyeur_id,' in def)=0 or position('cv.prenom AS convoyeur_prenom' in def)=0 or position('m.reference_courte' in def)=0 then raise exception 'Contrat de récapitulatif inattendu';end if;
 def:=replace(def,'m.convoyeur_id,','NULL::uuid AS convoyeur_id,');
 def:=replace(def,'cv.prenom AS convoyeur_prenom','NULL::text AS convoyeur_prenom');
 def:=replace(def,'m.reference_courte','m.reference_courte, m.marque_modele, m.immatriculation, m.adresse_depart, m.adresse_arrivee, m.adresse_intervention, m.heure_intervention, m.heure_debut_intervention, m.heure_fin_intervention, m.consignes');
 execute 'create or replace view public.v_mes_missions as '||def;
end $$;
-- Reprise idempotente des seules prestations réellement admissibles.
do $$ declare r record;begin
 for r in select id from public.devis where paiement_statut='paye' and statut='accepte' and annule_le is null loop
 perform public.crediter_points_prestation(r.id);end loop;
 for r in select distinct auth_user_id from public.fidelite_mouvements loop perform private.synchroniser_recompenses(r.auth_user_id);end loop;
end $$;
create trigger hc_sync_change after insert or update on public.fidelite_recompenses for each row execute function private.hc_signaler_modification();
do $$ declare def text;begin
 select pg_get_functiondef('private.hc_signaler_modification()'::regprocedure) into def;
 def:=replace(def,'''evaluations'',''fidelite_mouvements''', '''evaluations'',''fidelite_mouvements'',''fidelite_recompenses''');
 execute def;
end $$;
