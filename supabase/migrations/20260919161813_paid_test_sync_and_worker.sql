-- Reprise administrative ponctuelle : jeton aléatoire court, empreinte seulement.
alter table public.documents_paiement_test add column worker_token_hash text;
alter table public.documents_paiement_test add column worker_expire_le timestamptz;
create function public.proteger_document_paiement_test() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.devis_id is distinct from old.devis_id or new.client_id is distinct from old.client_id
 or new.numero is distinct from old.numero or new.montant_centimes is distinct from old.montant_centimes
 or new.snapshot is distinct from old.snapshot or new.cree_le is distinct from old.cree_le
 or new.informations_attendues is distinct from old.informations_attendues
 or (old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path)
 or (old.email_payload is not null and new.email_payload is distinct from old.email_payload)
 or (old.email_admin_payload is not null and new.email_admin_payload is distinct from old.email_admin_payload)
 then raise exception 'Document et contenu d envoi immuables'; end if;
 return new;
end $$;
revoke all on function public.proteger_document_paiement_test() from public;
create trigger proteger_document_test before update on public.documents_paiement_test for each row execute function public.proteger_document_paiement_test();

-- Compléments du client : ne synchroniser que le brouillon de CE véhicule.
-- Le devis et son snapshot restent immuables ; aucun autre véhicule touché.
create function public.synchroniser_brouillon_vehicule_test() returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
 update public.missions set
  ville_depart=coalesce(new.ville_depart,''),ville_arrivee=coalesce(new.ville_arrivee,''),
  type_vehicule=new.type_vehicule,marque_modele=new.marque_modele,immatriculation=new.immatriculation,vin=new.vin,
  adresse_depart=concat_ws(', ',new.adresse_depart_rue,concat_ws(' ',new.code_postal_depart,new.ville_depart)),
  adresse_arrivee=concat_ws(', ',new.adresse_arrivee_rue,concat_ws(' ',new.code_postal_arrivee,new.ville_arrivee)),
  contact_depart_nom=new.pc_contact_nom,contact_depart_tel=new.pc_contact_tel,
  contact_arrivee_nom=new.liv_contact_nom,contact_arrivee_tel=new.liv_contact_tel,
  date_prise_en_charge=public.hc_vers_date(new.date_prise_en_charge::text)+coalesce(public.hc_vers_heure(new.heure_prise_en_charge::text),'00:00'::time),
  date_livraison=public.hc_vers_date(new.date_livraison::text)+coalesce(public.hc_vers_heure(new.heure_livraison::text),'00:00'::time),
  restitution=coalesce(new.restitution_concernee,false),
  adresse_restitution=concat_ws(', ',new.restit_adresse_rue,concat_ws(' ',new.restit_code_postal,new.restit_ville)),
  restit_contact_nom=new.restit_contact_nom,restit_contact_tel=new.restit_contact_tel,
  restit_marque_modele=new.restit_marque_modele,restit_immatriculation=new.restit_immatriculation,restit_vin=new.restit_vin,
  date_restitution_depart=public.hc_vers_date(new.restit_date::text)+coalesce(public.hc_vers_heure(new.restit_heure::text),'00:00'::time),
  plateau=new.mode_transport='plateau',consignes=new.consignes
 where vehicule_source_id=new.id and client_id=new.dossier_id and devis_source_id is not null and statut='brouillon';
 return null;
end $$;
revoke all on function public.synchroniser_brouillon_vehicule_test() from public;
create trigger synchroniser_brouillon_vehicule_test after update on public.vehicules for each row execute function public.synchroniser_brouillon_vehicule_test();
