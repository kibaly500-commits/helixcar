begin;
-- Une action HelixCar ne constitue pas une nouvelle réponse du client.
create or replace function private.activite_demande_client() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare ignores text[]:=array['vue_admin_at','activite_demande_le','points_fidelite','km_total','nb_missions','creation_cle_hash','reclamation_cle_hash','reclamation_expire_le','auth_user_id'];
begin
 if tg_op='INSERT' then
  new.activite_demande_le:=clock_timestamp();new.vue_admin_at:=null;
 elsif (to_jsonb(new)-ignores) is distinct from (to_jsonb(old)-ignores)
       and auth.uid() is not null and new.auth_user_id=auth.uid() and not public.est_admin() then
  new.activite_demande_le:=greatest(clock_timestamp(),old.activite_demande_le+interval '1 microsecond');new.vue_admin_at:=null;
 elsif pg_trigger_depth()=1 then
  new.activite_demande_le:=old.activite_demande_le;
 end if;
 return new;
end $$;
revoke all on function private.activite_demande_client() from public,anon,authenticated;

create or replace function private.activite_demande_liee() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb; b jsonb; cid uuid; signaler boolean:=false;
begin
 if tg_op<>'INSERT' then a:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then b:=to_jsonb(new);end if;
 cid:=coalesce((b->>tg_argv[0])::uuid,(a->>tg_argv[0])::uuid);
 if not public.est_admin() then
  if tg_table_name='devis' and tg_op='UPDATE' then
   -- Les liens client et Stripe écrivent via le serveur, sans JWT client.
   -- Seuls les événements client explicites comptent : jamais la génération,
   -- l'envoi, la révision, l'annulation ou l'expiration administratives.
   signaler:=
    (new.consulte_le is not null and new.consulte_le is distinct from old.consulte_le)
    or (new.statut='accepte' and new.date_acceptation is not null and new.date_acceptation is distinct from old.date_acceptation)
    or (new.statut='refuse' and new.date_refus is not null and new.date_refus is distinct from old.date_refus)
    or (new.paiement_statut='paye' and new.paiement_confirme_le is not null and new.paiement_confirme_le is distinct from old.paiement_confirme_le);
  elsif auth.uid() is not null and public.est_proprietaire_demande(cid) then
   if tg_table_name='demande_informations_manquantes' and tg_op<>'DELETE' then
    signaler:=b->>'statut'='transmise' and
     (tg_op='INSERT' or (b->'statut',b->'valeur',b->'transmise_le') is distinct from (a->'statut',a->'valeur',a->'transmise_le'));
   elsif tg_table_name='vehicules' then
    signaler:=(a-'created_at') is distinct from (b-'created_at');
   end if;
  end if;
 end if;
 if signaler then
  update public.clients set activite_demande_le=greatest(clock_timestamp(),activite_demande_le+interval '1 microsecond'),vue_admin_at=null where id=cid;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function private.activite_demande_liee() from public,anon,authenticated;
-- Les opérations de mission viennent de HelixCar ou des partenaires.
drop trigger if exists z_activite_demande on public.missions;
commit;
