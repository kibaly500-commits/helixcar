-- Vérification transactionnelle : aucun changement ni mail n'est conservé.
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare cid uuid; mid uuid; q public.notifications_stockage%rowtype; r jsonb; flags text[];
begin
 select c.id into cid from public.clients c join public.devis d on d.client_id=c.id
 where d.statut='accepte' and d.paiement_statut='paye' and c.email ilike '%+qa-final01@%' limit 1;
 if cid is null then raise exception 'Fixture QA payée absente'; end if;
 foreach flags slice 1 in array array[['depot_client','helixcar'],['helixcar','recuperation_client'],['depot_client','recuperation_client']] loop
  delete from public.notifications_stockage where client_id=cid;
  update public.clients set type_service='stockage',stockage_acheminement=flags[1],stockage_sortie=flags[2] where id=cid;
  select * into q from public.notifications_stockage where client_id=cid;
  if not found then raise exception 'Notification manquante %',flags; end if;
  if (q.snapshot->>'depotClient')::boolean is distinct from (flags[1]='depot_client') or
     (q.snapshot->>'recuperationClient')::boolean is distinct from (flags[2]='recuperation_client') then raise exception 'Mauvais choix dans le mail'; end if;
  update public.devis set statut=statut where id=q.devis_id;
  if (select count(*) from public.notifications_stockage where client_id=cid)<>1 then raise exception 'Doublon'; end if;
  if (select count(*) from public.reclamer_notifications_stockage())<>1 then raise exception 'Prise en charge de la file incorrecte'; end if;
  if (select count(*) from public.reclamer_notifications_stockage())<>0 then raise exception 'Verrou de traitement inefficace'; end if;
 end loop;
 delete from public.notifications_stockage where client_id=cid;
 update public.clients set stockage_acheminement='helixcar',stockage_sortie='helixcar' where id=cid;
 if exists(select 1 from public.notifications_stockage where client_id=cid) then raise exception 'Envoi indu sans déplacement client'; end if;
 select id into mid from public.missions where client_id=cid limit 1;
 if mid is null then raise exception 'Fixture mission absente'; end if;
 r:=public.point_remise_mission(mid);
 if r->>'adresse' not like 'ALDI%' or not (r->>'arriveeAvantStockage')::boolean then raise exception 'Fiche stockage absente'; end if;
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}',true);
 if public.point_remise_mission(mid) is not null then raise exception 'Adresse exposée à un tiers'; end if;
 if has_table_privilege('authenticated','public.notifications_stockage','SELECT') or
    has_function_privilege('anon','public.point_remise_mission(uuid)','EXECUTE') or
    has_function_privilege('authenticated','public.reclamer_notifications_stockage()','EXECUTE') then raise exception 'Permissions excessives'; end if;
end $$;
rollback;
