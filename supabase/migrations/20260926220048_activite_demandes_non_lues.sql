begin;
alter table public.clients add column activite_demande_le timestamptz;
-- Reprendre les événements historiques datés sans transformer le déploiement en nouveauté.
update public.clients c set activite_demande_le=greatest(c.created_at,c.informations_confirmees_le,
 (select max(greatest(i.transmise_le,i.validee_le)) from public.demande_informations_manquantes i where i.client_id=c.id),
 (select max(greatest(d.created_at,d.date_envoi,d.date_acceptation,d.date_refus,d.consulte_le,d.paiement_confirme_le,d.annule_le,d.expire_le)) from public.devis d where d.client_id=c.id),
 (select max(v.created_at) from public.vehicules v where v.dossier_id=c.id),
 (select max(greatest(m.created_at,m.lettre_voiture_signee_date,m.prestation_validee_le)) from public.missions m where m.client_id=c.id));
update public.clients set vue_admin_at=null where activite_demande_le>vue_admin_at;

create or replace function private.activite_demande_client() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare ignores text[]:=array['vue_admin_at','activite_demande_le','points_fidelite','km_total','nb_missions','creation_cle_hash','reclamation_cle_hash','reclamation_expire_le','auth_user_id'];
begin
 if tg_op='INSERT' then new.activite_demande_le:=clock_timestamp();new.vue_admin_at:=null;
 elsif (to_jsonb(new)-ignores) is distinct from (to_jsonb(old)-ignores) then
  new.activite_demande_le:=greatest(clock_timestamp(),old.activite_demande_le+interval '1 microsecond');new.vue_admin_at:=null;
 elsif pg_trigger_depth()=1 then
  -- Une écriture directe ne peut fabriquer une date d'activité.
  new.activite_demande_le:=old.activite_demande_le;
 end if;
 return new;
end $$;
revoke all on function private.activite_demande_client() from public,anon,authenticated;
create trigger z_activite_demande_client before insert or update on public.clients for each row execute function private.activite_demande_client();

-- Interne seulement : les écritures sources restent soumises à leurs contrôles/RLS.
create or replace function private.activite_demande_liee() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb; b jsonb; cid uuid; ancien uuid; ignores text[]:=array['updated_at','created_at','acceptation_token_hash','date_expiration_token','envoi_en_cours_depuis'];
begin
 if tg_op<>'INSERT' then a:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then b:=to_jsonb(new);end if;
 if tg_op='UPDATE' and (a-ignores) is not distinct from (b-ignores) then return new;end if;
 cid:=coalesce((b->>tg_argv[0])::uuid,(a->>tg_argv[0])::uuid);
 ancien:=(a->>tg_argv[0])::uuid;
 update public.clients set activite_demande_le=greatest(clock_timestamp(),activite_demande_le+interval '1 microsecond'),vue_admin_at=null where id=cid or id=ancien;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.activite_demande_liee() from public,anon,authenticated;
create trigger z_activite_demande after insert or update or delete on public.demande_informations_manquantes for each row execute function private.activite_demande_liee('client_id');
create trigger z_activite_demande after insert or update or delete on public.vehicules for each row execute function private.activite_demande_liee('dossier_id');
create trigger z_activite_demande after insert or update or delete on public.devis for each row execute function private.activite_demande_liee('client_id');
create trigger z_activite_demande after insert or update or delete on public.missions for each row execute function private.activite_demande_liee('client_id');
-- Le suivi de lecture ne doit pas invalider les brouillons préparés.
do $$ declare def text;begin
 select pg_get_functiondef('public.source_preparation_missions(uuid)'::regprocedure) into def;
 if position('to_jsonb(x)-''vue_admin_at''-''informations_confirmees_le'' into c' in def)=0 then raise exception 'Empreinte de préparation inattendue';end if;
 execute replace(def,'to_jsonb(x)-''vue_admin_at''-''informations_confirmees_le'' into c','to_jsonb(x)-''vue_admin_at''-''informations_confirmees_le''-''activite_demande_le'' into c');
end $$;
create index clients_activite_demande_idx on public.clients(activite_demande_le desc);
commit;
