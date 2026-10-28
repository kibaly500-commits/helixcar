-- Parcours de recette uniquement : document TEST non fiscal et brouillons.
-- Aucune numérotation de facture réelle n'est utilisée.
create table public.documents_paiement_test (
 id uuid primary key default gen_random_uuid(),
 devis_id uuid not null unique references public.devis(id),
 client_id uuid not null references public.clients(id),
 numero text not null unique,
 montant_centimes bigint not null check(montant_centimes>0),
 snapshot jsonb not null,
 informations_attendues jsonb not null,
 cree_le timestamptz not null default now(),
 pdf_path text,
 email_payload jsonb,
 email_premier_essai timestamptz,
 email_id text,
 email_admin_payload jsonb,
 email_admin_premier_essai timestamptz,
 email_admin_id text
);
alter table public.documents_paiement_test enable row level security;
revoke all on public.documents_paiement_test from public,anon,authenticated;
grant select,insert,update on public.documents_paiement_test to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('factures-client-test','factures-client-test',false,5242880,array['application/pdf'])
on conflict(id) do nothing;

alter table public.missions add column devis_source_id uuid references public.devis(id);
alter table public.missions add column vehicule_source_id uuid references public.vehicules(id);
alter table public.missions add column remuneration_prevue numeric check(remuneration_prevue is null or remuneration_prevue>=0);
create unique index missions_devis_vehicule_unique on public.missions(devis_source_id,vehicule_source_id) where devis_source_id is not null;

-- Les coordonnées intégrales restent administratives avant attribution.
create policy "missions : dossiers payes attribues seulement" on public.missions
as restrictive for all to authenticated
using (devis_source_id is null or public.est_admin() or
 (statut <> 'brouillon' and exists(select 1 from public.convoyeurs c where c.id=missions.convoyeur_id and c.auth_user_id=auth.uid())))
with check (devis_source_id is null or public.est_admin() or
 (statut <> 'brouillon' and exists(select 1 from public.convoyeurs c where c.id=missions.convoyeur_id and c.auth_user_id=auth.uid())));

create function public.preparer_suite_paiement_test(p_devis_id uuid) returns jsonb
language plpgsql security invoker set search_path=public,pg_temp as $$
declare d public.devis%rowtype; c public.clients%rowtype; v public.vehicules%rowtype;
 f public.documents_paiement_test%rowtype; manque jsonb; anciens text;
begin
 if auth.uid() is not null then raise exception 'Serveur seulement'; end if;
 select * into d from public.devis where id=p_devis_id for update;
 if not found or d.paiement_statut is distinct from 'paye' or d.statut is distinct from 'accepte'
    or not exists(select 1 from public.paiement_evenements e where e.devis_id=d.id
      and e.fournisseur='stripe' and e.resultat in ('PAYE','DEJA_PAYE') and e.detail->>'livemode'='false')
 then raise exception 'Paiement Stripe test non confirme'; end if;
 select * into c from public.clients where id=d.client_id;
 if lower(c.email) <> 'helixcarpro+qa-final01@gmail.com' or (c.prenom||' '||c.nom) not ilike '%TEST-QA%'
 then raise exception 'Dossier hors recette'; end if;
 if c.type_service not in ('convoyage','convoyage_stockage') or not exists(select 1 from public.vehicules where dossier_id=c.id)
 then raise exception 'Recette reservee au convoyage avec vehicules'; end if;
 anciens:=current_setting('hc.creation_mission_serveur',true);
 perform set_config('hc.creation_mission_serveur','1',true);
 select coalesce(jsonb_agg(jsonb_build_object('cle',i.cle,'libelle',i.libelle,'statut',i.statut,'commentaire',i.commentaire)),'[]'::jsonb)
 into manque from public.informations_demande(c.id) i where i.statut not in ('fournie','validee');
 insert into public.documents_paiement_test(devis_id,client_id,numero,montant_centimes,snapshot,informations_attendues)
 values(d.id,c.id,'TEST-'||d.reference,round(d.prix*100),
   jsonb_build_object('devis',d.snapshot_devis,'paiement_confirme_le',d.paiement_confirme_le,
     'nom_client',concat_ws(' ',c.prenom,c.nom),'email',c.email,'reference',d.reference),manque)
 on conflict(devis_id) do nothing;
 for v in select * from public.vehicules where dossier_id=c.id order by position,id loop
 insert into public.missions(reference,client_id,devis_source_id,vehicule_source_id,statut,type_mission,
   ville_depart,ville_arrivee,type_vehicule,marque_modele,immatriculation,vin,
   adresse_depart,adresse_arrivee,contact_depart_nom,contact_depart_tel,contact_arrivee_nom,contact_arrivee_tel,
   date_prise_en_charge,date_livraison,restitution,adresse_restitution,restit_contact_nom,restit_contact_tel,
   restit_marque_modele,restit_immatriculation,restit_vin,date_restitution_depart,plateau,consignes,nb_vehicules,notes)
 values('TEST-M-'||d.reference||'-'||v.position,c.id,d.id,v.id,'brouillon','convoyage',
   coalesce(v.ville_depart,''),coalesce(v.ville_arrivee,''),v.type_vehicule,v.marque_modele,v.immatriculation,v.vin,
   concat_ws(', ',v.adresse_depart_rue,concat_ws(' ',v.code_postal_depart,v.ville_depart)),
   concat_ws(', ',v.adresse_arrivee_rue,concat_ws(' ',v.code_postal_arrivee,v.ville_arrivee)),
   v.pc_contact_nom,v.pc_contact_tel,v.liv_contact_nom,v.liv_contact_tel,
   public.hc_vers_date(v.date_prise_en_charge::text)+coalesce(public.hc_vers_heure(v.heure_prise_en_charge::text),'00:00'::time),
   public.hc_vers_date(v.date_livraison::text)+coalesce(public.hc_vers_heure(v.heure_livraison::text),'00:00'::time),
   coalesce(v.restitution_concernee,false),concat_ws(', ',v.restit_adresse_rue,concat_ws(' ',v.restit_code_postal,v.restit_ville)),
   v.restit_contact_nom,v.restit_contact_tel,v.restit_marque_modele,v.restit_immatriculation,v.restit_vin,
   public.hc_vers_date(v.restit_date::text)+coalesce(public.hc_vers_heure(v.restit_heure::text),'00:00'::time),
   v.mode_transport='plateau',v.consignes,1,'TEST QA - Brouillon issu du devis paye. Remuneration a definir avant publication.')
 on conflict(devis_source_id,vehicule_source_id) where devis_source_id is not null do nothing;
 end loop;
 perform set_config('hc.creation_mission_serveur',coalesce(anciens,''),true);
 select * into f from public.documents_paiement_test where devis_id=d.id;
 return to_jsonb(f);
end $$;
revoke all on function public.preparer_suite_paiement_test(uuid) from public,anon,authenticated;
grant execute on function public.preparer_suite_paiement_test(uuid) to service_role;

-- Protection serveur, y compris si un administrateur appelle directement REST.
create function public.garder_publication_paiement() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
declare m public.missions%rowtype; ancien text;
begin
 if tg_table_name='opportunites' then
   if new.statut='brouillon' then return new; end if;
   select * into m from public.missions where id=new.mission_id;
 else
   m:=new;
   if tg_op='UPDATE' and old.devis_source_id is not null and
      (new.devis_source_id is distinct from old.devis_source_id or new.vehicule_source_id is distinct from old.vehicule_source_id)
   then raise exception 'Source de mission immuable'; end if;
   if m.devis_source_id is null then return new; end if;
   if m.statut='brouillon' and m.convoyeur_id is null and not coalesce(m.validee_paiement,false) then return new; end if;
   if m.statut='annulee' and m.convoyeur_id is null then return new; end if;
 end if;
 if m.devis_source_id is null then return new; end if;
 if not exists(select 1 from public.devis where id=m.devis_source_id and client_id=m.client_id and paiement_statut='paye' and statut='accepte') then
   raise exception 'Paiement non confirme'; end if;
 ancien:=current_setting('hc.creation_mission_serveur',true);
 perform set_config('hc.creation_mission_serveur','1',true);
 if exists(select 1 from public.informations_demande(m.client_id) where statut not in ('fournie','validee')) then
   raise exception 'Informations manquantes ou en attente de validation'; end if;
 perform set_config('hc.creation_mission_serveur',coalesce(ancien,''),true);
 if m.remuneration_prevue is null then raise exception 'Renseignez le tarif convoyeur avant publication'; end if;
 return new;
end $$;
revoke all on function public.garder_publication_paiement() from public;
create trigger garde_publication_paiement before insert or update on public.opportunites for each row execute function public.garder_publication_paiement();
create trigger garde_execution_paiement before insert or update on public.missions for each row execute function public.garder_publication_paiement();

-- Métadonnées seulement, jamais le chemin privé ou les détails d'envoi.
create view public.v_mes_documents_paiement_test with(security_barrier=true) as
select f.id,f.devis_id,f.numero,f.montant_centimes,f.cree_le,(f.pdf_path is not null) as disponible
from public.documents_paiement_test f join public.clients c on c.id=f.client_id
where c.auth_user_id=auth.uid() or public.est_admin();
revoke all on public.v_mes_documents_paiement_test from public,anon;
grant select on public.v_mes_documents_paiement_test to authenticated;
