-- Signaux d'invalidation uniquement : aucune donnée métier dans les messages.
-- Les écrans relisent les vues/RPC existantes avec leurs permissions habituelles.
create policy hc_sync_reception on realtime.messages for select to authenticated
using (extension='broadcast' and (
  (select realtime.topic())='hc:user:'||(select auth.uid())::text
  or ((select realtime.topic())='hc:admin' and public.est_admin())
  or ((select realtime.topic())='hc:partenaires' and public.partenaire_actif())
));

create or replace function private.hc_signaler_modification() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb; cid uuid; pid uuid; mid uuid; did uuid; uid uuid;
 topics text[]:=array['hc:admin']; topic text;
begin
 -- Ancien ET nouveau propriétaire : affectation, retrait et suppression.
 for r in select x from jsonb_array_elements(jsonb_build_array(
   case when tg_op<>'INSERT' then to_jsonb(old) else '{}'::jsonb end,
   case when tg_op<>'DELETE' then to_jsonb(new) else '{}'::jsonb end)) as a(x)
 loop
   if r='{}'::jsonb then continue; end if;
   cid:=coalesce(r->>'client_id',r->>'dossier_id')::uuid;
   pid:=(r->>'convoyeur_id')::uuid;
   mid:=(r->>'mission_id')::uuid;
   did:=(r->>'devis_id')::uuid;
   if tg_table_name='clients' then cid:=(r->>'id')::uuid; end if;
   if tg_table_name='convoyeurs' then pid:=(r->>'id')::uuid; end if;
   if tg_table_name in ('clients','convoyeurs','admins','evaluations','fidelite_mouvements') and r->>'auth_user_id' is not null then
     topics:=array_append(topics,'hc:user:'||(r->>'auth_user_id'));
   end if;
   if r->>'opportunite_id' is not null then
     select mission_id into mid from public.opportunites where id=(r->>'opportunite_id')::uuid;
   end if;
   if mid is not null then
     select coalesce(cid,client_id),coalesce(pid,convoyeur_id) into cid,pid from public.missions where id=mid;
   end if;
   if cid is null and did is not null then select client_id into cid from public.devis where id=did; end if;
   if cid is not null then
     select auth_user_id into uid from public.clients where id=cid;
     if uid is not null then topics:=array_append(topics,'hc:user:'||uid::text); end if;
   end if;
   if pid is not null then
     select auth_user_id into uid from public.convoyeurs where id=pid;
     if uid is not null then topics:=array_append(topics,'hc:user:'||uid::text); end if;
   end if;
 end loop;
 -- Le signal collectif ne contient ni identité, ni adresse, ni identifiant de mission.
 if tg_table_name in ('opportunites','missions','preparations_missions') then
   topics:=array_append(topics,'hc:partenaires');
 end if;
 for topic in select distinct unnest(topics) loop
   perform realtime.send('{}'::jsonb,'changed',topic,true);
 end loop;
 return null;
exception when others then
 -- Une panne de notification ne doit jamais annuler une opération métier.
 raise warning 'HC sync unavailable: %',sqlstate;
 return null;
end $$;
revoke all on function private.hc_signaler_modification() from public,anon,authenticated;

do $$ declare t text; begin
 foreach t in array array['admins','clients','convoyeurs','convoyeur_decisions',
 'vehicules','devis','devis_envois','demande_informations_manquantes','missions',
 'preparations_missions','opportunites','opportunite_candidatures','documents',
 'documents_paiement_test','etats_des_lieux','mission_photos','evaluations',
 'factures_convoyeur','fidelite_mouvements','paiement_evenements','notifications_stockage','recontacts'] loop
   execute format('create trigger hc_sync_change after insert or update or delete on public.%I for each row execute function private.hc_signaler_modification()',t);
 end loop;
end $$;
