-- Contrôles ciblés, transaction annulée. Nécessite le dossier QA déjà payé.
begin;
do $$
declare d uuid; n integer; v uuid; r jsonb;
begin
 select id into d from public.devis where reference='DEV-2026-0081' and paiement_statut='paye';
 if d is null then raise exception 'Dossier de recette paye absent'; end if;
 r:=public.preparer_suite_paiement_test(d);
 r:=public.preparer_suite_paiement_test(d);
 select count(*) into n from public.documents_paiement_test where devis_id=d;
 if n<>1 then raise exception 'Doublon document'; end if;
 select count(*) into n from public.missions where devis_source_id=d;
 if n<>2 then raise exception 'Nombre incorrect de brouillons'; end if;
 begin
  update public.missions set statut='en_attente' where devis_source_id=d;
  raise exception 'TEST_ECHEC_PUBLICATION';
 exception when raise_exception then
  if sqlerrm not like 'Informations manquantes%' then raise; end if;
 end;
 select vehicule_source_id into v from public.missions where devis_source_id=d order by reference limit 1;
 update public.vehicules set immatriculation='TEST-SYNC-01' where id=v;
 select count(*) into n from public.missions where devis_source_id=d and immatriculation='TEST-SYNC-01';
 if n<>1 then raise exception 'Synchronisation hors vehicule'; end if;
end $$;
rollback;
