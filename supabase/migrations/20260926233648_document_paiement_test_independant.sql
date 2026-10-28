-- Le PDF payé est indépendant de la préparation des missions et de leur métier.
-- Même périmètre de recette que Stripe Checkout ; aucun accès client direct.
create or replace function public.preparer_document_paiement_test(p_devis_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare
 d public.devis%rowtype; c public.clients%rowtype;
 f public.documents_paiement_test%rowtype; manque jsonb; ancien text;
begin
 if auth.uid() is not null then raise exception 'Serveur seulement'; end if;
 select * into d from public.devis where id=p_devis_id for update;
 if not found or d.paiement_statut is distinct from 'paye' or d.statut is distinct from 'accepte'
 or not exists(select 1 from public.paiement_evenements e where e.devis_id=d.id
   and e.fournisseur='stripe' and e.resultat in ('PAYE','DEJA_PAYE') and e.detail->>'livemode'='false')
 then raise exception 'Paiement Stripe test non confirme'; end if;
 select * into c from public.clients where id=d.client_id;
 if not found or not (
   coalesce(lower(trim(c.email))='helixcarpro+qa-final01@gmail.com',false)
   or (c.id='951410e8-7104-4256-b46d-59487e73890a'::uuid and d.id='07bbbfa7-8e6c-437a-a99f-a48e40b18f6f'::uuid)
 ) then raise exception 'Dossier hors recette'; end if;
 -- Le numéro et le snapshot restent figés lors d'une reprise.
 select * into f from public.documents_paiement_test where devis_id=d.id;
 if found then return to_jsonb(f); end if;
 ancien:=current_setting('hc.creation_mission_serveur',true);
 perform set_config('hc.creation_mission_serveur','1',true);
 select coalesce(jsonb_agg(jsonb_build_object('cle',i.cle,'libelle',i.libelle,'statut',i.statut,'commentaire',i.commentaire)),'[]'::jsonb)
 into manque from public.informations_demande(c.id) i where i.statut not in ('fournie','validee');
 perform set_config('hc.creation_mission_serveur',coalesce(ancien,''),true);
 insert into public.documents_paiement_test(devis_id,client_id,numero,montant_centimes,snapshot,informations_attendues)
 values(d.id,c.id,'TEST-'||d.reference,round(d.prix*100),
   jsonb_build_object('devis',d.snapshot_devis,'paiement_confirme_le',d.paiement_confirme_le,
     'nom_client',concat_ws(' ',c.prenom,c.nom),'email',c.email,'reference',d.reference),manque)
 returning * into f;
 return to_jsonb(f);
end $$;
revoke all on function public.preparer_document_paiement_test(uuid) from public,anon,authenticated;
grant execute on function public.preparer_document_paiement_test(uuid) to service_role;
