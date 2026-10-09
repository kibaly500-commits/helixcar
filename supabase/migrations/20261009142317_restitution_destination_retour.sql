-- Choix facultatif par véhicule ; les anciens dossiers restent en adresse libre.
alter table public.vehicules add column restit_destination text not null default 'adresse'
 check (restit_destination in ('adresse','depart','stockage'));
do $$
declare def text;
begin
 select pg_get_functiondef('public.champs_publics_vehicule()'::regprocedure) into def;
 if position('''restitution_concernee''' in def)=0 then raise exception 'Liste des champs véhicule inattendue'; end if;
 execute replace(def,'''restitution_concernee''','''restitution_concernee'', ''restit_destination''');
end $$;
create function private.resoudre_destination_restitution() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.clients%rowtype;
begin
 new.restit_destination:=coalesce(new.restit_destination,'adresse');
 if not coalesce(new.restitution_concernee,false) then new.restit_destination:='adresse'; return new; end if;
 if new.restit_destination='adresse' then return new; end if;
 select * into c from public.clients where id=new.dossier_id;
 if new.restit_destination='stockage' then
  if c.type_service not in ('stockage','convoyage_stockage') then raise exception 'Le retour au stockage nécessite une demande avec stockage'; end if;
  -- Nom du point uniquement : l'adresse privée n'est pas copiée au dossier client.
  new.restit_adresse_rue:='Point de stockage HelixCar';
  new.restit_code_postal:='93160';new.restit_ville:='Noisy-le-Grand';
 elsif new.restit_destination='depart' then
  new.restit_adresse_rue:=coalesce(nullif(new.adresse_depart_rue,''),case when c.trajet_commun then c.adresse_depart_rue end);
  new.restit_code_postal:=coalesce(nullif(new.code_postal_depart,''),case when c.trajet_commun then c.code_postal_depart end);
  new.restit_ville:=coalesce(nullif(new.ville_depart,''),case when c.trajet_commun then c.ville_depart end);
 end if;
 return new;
end $$;
revoke all on function private.resoudre_destination_restitution() from public,anon,authenticated;
create trigger resoudre_destination_restitution before insert or update of
 restit_destination,restitution_concernee,adresse_depart_rue,code_postal_depart,ville_depart,restit_adresse_rue,restit_code_postal,restit_ville
 on public.vehicules for each row execute function private.resoudre_destination_restitution();
