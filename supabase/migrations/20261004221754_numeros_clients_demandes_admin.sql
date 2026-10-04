-- Numéro du COMPTE distinct de clients.numero_client (référence de DEMANDE).
-- Le dépôt public existant reste inchangé.
create table public.comptes_clients (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 numero text not null unique check (numero ~ '^CLI-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'),
 created_at timestamptz not null default now()
);
alter table public.comptes_clients enable row level security;
revoke all on public.comptes_clients from public, anon, authenticated;
grant select on public.comptes_clients to authenticated;
create policy compte_client_lecture on public.comptes_clients for select to authenticated
 using (auth_user_id = (select auth.uid()) or public.est_admin());

create or replace function private.attribuer_numero_client(p_uid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_num text; v_bytes bytea; v_chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
 if p_uid is null then return null; end if;
 -- Sérialise les attributions du même compte, y compris deux dépôts simultanés.
 perform pg_advisory_xact_lock(hashtextextended(p_uid::text, 438));
 select numero into v_num from public.comptes_clients where auth_user_id=p_uid;
 if found then return v_num; end if;
 for tentative in 1..100 loop
  v_bytes := uuid_send(gen_random_uuid()); v_num := 'CLI-';
  for i in 0..4 loop v_num := v_num || substr(v_chars, (get_byte(v_bytes,i) % 32)+1, 1); end loop;
  begin
   insert into public.comptes_clients(auth_user_id,numero) values(p_uid,v_num);
   return v_num;
  exception when unique_violation then null;
  end;
 end loop;
 raise exception 'Attribution du numéro client indisponible. Réessayez.';
end $$;
revoke all on function private.attribuer_numero_client(uuid) from public,anon,authenticated;
create or replace function private.numero_client_apres_rattachement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if new.auth_user_id is not null then perform private.attribuer_numero_client(new.auth_user_id); end if;
 return new;
end $$;
revoke all on function private.numero_client_apres_rattachement() from public,anon,authenticated;
create trigger numero_client_compte after insert or update of auth_user_id on public.clients
 for each row execute function private.numero_client_apres_rattachement();
-- Un numéro par compte existant, jamais un numéro par demande.
select private.attribuer_numero_client(c.auth_user_id)
 from (select distinct auth_user_id from public.clients where auth_user_id is not null) c;

create or replace function public.rechercher_compte_client_admin(p_numero text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_num text; v_profil jsonb;
begin
 if auth.uid() is null or not public.est_admin() then raise exception 'Accès administrateur requis.' using errcode='42501'; end if;
 select c.auth_user_id,c.numero into v_uid,v_num from public.comptes_clients c
 join auth.users u on u.id=c.auth_user_id
 where c.numero=upper(trim(p_numero)) and u.deleted_at is null;
 if not found then raise exception 'Numéro client introuvable. Utilisez le numéro CLI à cinq caractères.'; end if;
 select jsonb_build_object('prenom',c.prenom,'nom',c.nom,'email',u.email,'telephone',c.telephone,
 'type_client',c.type_client,'societe',c.societe,'siret',c.siret,
 'source_acquisition',c.source_acquisition,'source_acquisition_detail',c.source_acquisition_detail)
 into v_profil from public.clients c join auth.users u on u.id=c.auth_user_id
 where c.auth_user_id=v_uid order by c.created_at desc,c.id limit 1;
 if v_profil is null then raise exception 'Le profil client doit être complété avant la saisie.'; end if;
 return jsonb_build_object('numero',v_num,'profil',v_profil);
end $$;
revoke all on function public.rechercher_compte_client_admin(text) from public,anon,authenticated;
grant execute on function public.rechercher_compte_client_admin(text) to authenticated;

create table public.demandes_saisies_admin (
 demande_id uuid primary key references public.clients(id) on delete cascade,
 admin_id uuid not null references auth.users(id),
 compte_id uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
alter table public.demandes_saisies_admin enable row level security;
revoke all on public.demandes_saisies_admin from public,anon,authenticated;
grant select on public.demandes_saisies_admin to authenticated;
create policy saisies_admin_lecture on public.demandes_saisies_admin for select to authenticated using(public.est_admin());

create or replace function public.creer_demande_admin(
 p_numero text, p_demande jsonb, p_vehicules jsonb, p_cle_creation text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_compte jsonb; v_uid uuid; v_id uuid; v_existing public.clients%rowtype;
 v_hash text; v_charge jsonb; v_element jsonb; v_cols text; v_sel text; v_num text; v_nb int:=0;
begin
 -- Lookup contrôle aussi les droits, avant toute lecture d'une demande.
 v_compte := public.rechercher_compte_client_admin(p_numero);
 select auth_user_id into strict v_uid from public.comptes_clients where numero=v_compte->>'numero';
 if jsonb_typeof(p_demande) is distinct from 'object' or jsonb_typeof(p_vehicules) is distinct from 'array'
  or jsonb_array_length(p_vehicules)>50 or length(coalesce(p_cle_creation,''))<32 then
  raise exception 'Demande invalide.';
 end if;
 if coalesce(p_demande->>'type_service','') not in ('convoyage','stockage','convoyage_stockage','nettoyage','professionnel') then
  raise exception 'Choisissez une prestation.';
 end if;
 v_id := (p_demande->>'id')::uuid;
 if v_id is null then raise exception 'Identifiant de demande requis.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,439));
 v_hash := public.empreinte_secret('creation_admin',p_cle_creation);
 select * into v_existing from public.clients where id=v_id;
 if found then
  if v_existing.auth_user_id=v_uid and v_existing.creation_cle_hash=v_hash
    and exists(select 1 from public.demandes_saisies_admin where demande_id=v_id and admin_id=auth.uid() and compte_id=v_uid) then
   return jsonb_build_object('id',v_id,'numero_client',v_existing.numero_client,'rattachee',true,'deja_existante',true);
  end if;
  raise exception 'Cette demande ne peut pas être réutilisée.';
 end if;
 -- Identité et rattachement relus côté serveur, pas acceptés du formulaire.
 v_charge := p_demande || (v_compte->'profil') || jsonb_build_object('id',v_id,'statut','nouveau','auth_user_id',v_uid,'creation_cle_hash',v_hash);
 select string_agg(quote_ident(column_name),', ' order by column_name),
 string_agg('r.'||quote_ident(column_name),', ' order by column_name) into v_cols,v_sel
 from information_schema.columns where table_schema='public' and table_name='clients'
 and column_name=any(public.champs_publics_demande()) and v_charge ? column_name;
 execute format('insert into public.clients(id,statut,auth_user_id,creation_cle_hash,%s) select r.id,r.statut,r.auth_user_id,r.creation_cle_hash,%s from jsonb_populate_record(null::public.clients,$1) r',v_cols,v_sel) using v_charge;
 for v_element in select value from jsonb_array_elements(p_vehicules) loop
  if jsonb_typeof(v_element)<>'object' then raise exception 'Véhicule invalide.'; end if;
  select string_agg(quote_ident(column_name),', ' order by column_name),
   string_agg('r.'||quote_ident(column_name),', ' order by column_name) into v_cols,v_sel
   from information_schema.columns where table_schema='public' and table_name='vehicules'
   and column_name=any(public.champs_publics_vehicule()) and v_element ? column_name;
  execute format('insert into public.vehicules(dossier_id%s) select $2%s from jsonb_populate_record(null::public.vehicules,$1) r',
   case when v_cols is null then '' else ', '||v_cols end,case when v_sel is null then '' else ', '||v_sel end) using v_element,v_id;
  v_nb:=v_nb+1;
 end loop;
 insert into public.demandes_saisies_admin(demande_id,admin_id,compte_id) values(v_id,auth.uid(),v_uid);
 select numero_client into v_num from public.clients where id=v_id;
 return jsonb_build_object('id',v_id,'numero_client',v_num,'rattachee',true,'vehicules',v_nb,'deja_existante',false);
end $$;
revoke all on function public.creer_demande_admin(text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.creer_demande_admin(text,jsonb,jsonb,text) to authenticated;
