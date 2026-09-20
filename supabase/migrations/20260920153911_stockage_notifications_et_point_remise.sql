-- File privée : uniquement les nouvelles confirmations, aucun envoi rétroactif.
create table public.notifications_stockage (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null unique references public.clients(id),
 devis_id uuid not null references public.devis(id),
 snapshot jsonb not null,
 payload jsonb, premier_essai timestamptz, fournisseur_id text,
 verrou_jusqua timestamptz, erreur text, cree_le timestamptz not null default now()
);
alter table public.notifications_stockage enable row level security;
revoke all on public.notifications_stockage from public,anon,authenticated;
grant select,insert,update on public.notifications_stockage to service_role;

create function public.preparer_notification_stockage() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.clients%rowtype; d public.devis%rowtype; cid uuid; test_mode boolean;
begin
 cid:=case when tg_table_name='devis' then new.client_id else new.id end;
 select * into c from public.clients where id=cid;
 if c.type_service not in ('stockage','convoyage_stockage') or
    (c.stockage_acheminement is distinct from 'depot_client' and c.stockage_sortie is distinct from 'recuperation_client') then return new; end if;
 select * into d from public.devis where client_id=cid and statut='accepte' and paiement_statut='paye' order by date_generation desc limit 1;
 if not found then return new; end if;
 select exists(select 1 from public.paiement_evenements where devis_id=d.id and
   (fournisseur='test' or detail->>'livemode'='false' or detail->>'simulation'='true')) into test_mode;
 insert into public.notifications_stockage(client_id,devis_id,snapshot)
 values(cid,d.id,jsonb_build_object('email',c.email,'reference',d.reference,
  'depotClient',coalesce(c.stockage_acheminement='depot_client',false),'recuperationClient',coalesce(c.stockage_sortie='recuperation_client',false),
  'dateDepot',c.stockage_date_debut,'heureDepot',c.stockage_heure_entree,
  'dateRecuperation',c.stockage_date_fin,'heureRecuperation',c.stockage_heure_sortie,'test',test_mode))
 on conflict(client_id) do nothing;
 return new;
end $$;
revoke all on function public.preparer_notification_stockage() from public,anon,authenticated;
create trigger notification_stockage_devis after insert or update of statut,paiement_statut on public.devis
 for each row execute function public.preparer_notification_stockage();
create trigger notification_stockage_choix after update of stockage_acheminement,stockage_sortie on public.clients
 for each row execute function public.preparer_notification_stockage();

create function public.reclamer_notifications_stockage() returns setof public.notifications_stockage
language sql security invoker set search_path=public,pg_temp as $$
 update public.notifications_stockage n set verrou_jusqua=now()+interval '5 minutes'
 where n.id in (select q.id from public.notifications_stockage q
  where q.fournisseur_id is null and coalesce(q.erreur,'') not in ('RECONCILIATION_REQUIRED','DOSSIER_MODIFIE')
  and (q.verrou_jusqua is null or q.verrou_jusqua<now()) order by q.cree_le limit 20 for update skip locked)
 returning n.*;
$$;
revoke all on function public.reclamer_notifications_stockage() from public,anon,authenticated;
grant execute on function public.reclamer_notifications_stockage() to service_role;

-- La fiche calcule les deux mouvements sans écraser les adresses du client.
-- L'adresse complète n'est jamais ajoutée à une opportunité publique.
create function public.point_remise_mission(p_mission_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare m public.missions%rowtype; c public.clients%rowtype; v public.vehicules%rowtype;
 entree boolean; sortie boolean;
begin
 if auth.uid() is null and coalesce(auth.jwt()->>'role','')<>'service_role' then return null; end if;
 select * into m from public.missions where id=p_mission_id;
 if not found then return null; end if;
 if coalesce(auth.jwt()->>'role','')<>'service_role' and not public.est_admin() and not exists(
  select 1 from public.convoyeurs cv where cv.id=m.convoyeur_id and cv.auth_user_id=auth.uid()
 ) then return null; end if;
 select * into c from public.clients where id=m.client_id;
 if c.type_service not in ('stockage','convoyage_stockage') then return null; end if;
 if not exists(select 1 from public.devis where client_id=c.id and statut='accepte' and paiement_statut='paye') then return null; end if;
 select * into v from public.vehicules where id=m.vehicule_source_id;
 entree:=c.stockage_acheminement='helixcar';
 sortie:=c.stockage_sortie='helixcar' and coalesce(v.livraison_apres_stockage,true);
 if not coalesce(entree,false) and not coalesce(sortie,false) then return null; end if;
 return jsonb_build_object('adresse','ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand',
   'arriveeAvantStockage',coalesce(entree,false),'departApresStockage',coalesce(sortie,false));
end $$;
revoke all on function public.point_remise_mission(uuid) from public,anon;
grant execute on function public.point_remise_mission(uuid) to authenticated,service_role;

-- Invocation serveur périodique avec un secret dédié, jamais exposé au navigateur.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;
do $$ begin
 if not exists(select 1 from vault.secrets where name='stockage_worker_token') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'stockage_worker_token');
 end if;
end $$;
create function public.verifier_stockage_worker(p_token text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(length(p_token)=64 and exists(select 1 from vault.decrypted_secrets
  where name='stockage_worker_token' and decrypted_secret=p_token),false);
$$;
revoke all on function public.verifier_stockage_worker(text) from public,anon,authenticated;
grant execute on function public.verifier_stockage_worker(text) to service_role;
select cron.schedule('helixcar-mails-stockage','* * * * *',$cron$
 select net.http_post(
  url:='https://zsetmqnmmupqbkgqbjbo.supabase.co/functions/v1/stockage-notifications',
  headers:=jsonb_build_object('Content-Type','application/json','x-stockage-worker',
    (select decrypted_secret from vault.decrypted_secrets where name='stockage_worker_token')),
  body:='{}'::jsonb,timeout_milliseconds:=10000)
 where exists(select 1 from public.notifications_stockage where fournisseur_id is null
  and coalesce(erreur,'') not in ('RECONCILIATION_REQUIRED','DOSSIER_MODIFIE')
  and (verrou_jusqua is null or verrou_jusqua<now()));
$cron$);
