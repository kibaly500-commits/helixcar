-- Contrôles des nouveaux plans uniquement. Les missions déjà publiées restent figées.
create or replace function private.garder_organisation_cinq_jours() returns trigger
language plpgsql security definer set search_path='' as $$
declare v public.vehicules%rowtype; reception timestamp; sortie timestamp; livraison timestamp; parent public.preparations_missions%rowtype;
begin
 if coalesce(new.plan->'organisation'->>'version','')<>'2' then return new; end if;
 if tg_op='UPDATE' and old.mission_id is not null then return new; end if;
 select * into v from public.vehicules where id=nullif(new.plan->>'vehicule_id','')::uuid and dossier_id=new.client_id;
 if v.id is null then return new; end if;
 if new.plan->>'kind'='direct' and (v.date_livraison::date-v.date_prise_en_charge::date)>5 and coalesce(new.plan->'organisation'->>'before','false')<>'true' then
  raise exception 'Au-delà de 5 jours avant livraison, prévoyez Noisy ou une dérogation admin';
 end if;
 if new.plan->'mission'->>'restitution'='true' and not coalesce(v.restit_recuperation_client,false) and coalesce(v.restit_destination,'')<>'stockage' and (v.restit_date::date-v.date_livraison::date)>5
  and coalesce(new.plan->'organisation'->>'return','false')<>'true' and coalesce(new.plan->'retour_helixcar'->>'transfert','false')<>'true' then
  raise exception 'Au-delà de 5 jours avant restitution, prévoyez Noisy ou une dérogation admin';
 end if;
 if new.plan->'retour_helixcar'->>'transfert'='true' then
  reception:=nullif(new.plan->>'retour_reception','')::timestamp;sortie:=nullif(new.plan->>'retour_remise','')::timestamp;
  livraison:=v.date_livraison::date+coalesce(case when v.liv_heure_type='creneau' then v.liv_creneau_fin::time else v.heure_livraison::time end,'00:00'::time);
  if reception is not null and reception<=livraison then raise exception 'Le retour à Noisy doit suivre la livraison'; end if;
  if reception is not null and sortie is not null and sortie<=reception then raise exception 'Le départ suivant doit suivre le retour à Noisy'; end if;
  if new.mission_id is not null and (reception is null or sortie is null) then raise exception 'Fixez le retour à Noisy et le départ de la mission suivante'; end if;
 end if;
 if new.mission_id is not null and new.plan->>'parent_retour_key' is not null then
  select * into parent from public.preparations_missions where client_id=new.client_id and cle=new.plan->>'parent_retour_key';
  if parent.id is null or nullif(parent.plan->>'retour_reception','') is null or
   (parent.plan->>'retour_remise')::timestamp is distinct from (new.plan->'mission'->>'date_prise_en_charge')::timestamp then
   raise exception 'Vérifiez le retour à Noisy et la remise au prochain convoyeur';
  end if;
 end if;
 return new;
end $$;
revoke all on function private.garder_organisation_cinq_jours() from public,anon,authenticated;
create trigger garder_organisation_cinq_jours before insert or update on public.preparations_missions
 for each row execute function private.garder_organisation_cinq_jours();
