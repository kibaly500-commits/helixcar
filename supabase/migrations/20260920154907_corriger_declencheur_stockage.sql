create or replace function public.preparer_notification_stockage() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.clients%rowtype; d public.devis%rowtype; cid uuid; test_mode boolean;
begin
 cid:=case when tg_table_name='devis' then (to_jsonb(new)->>'client_id')::uuid else new.id end;
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
