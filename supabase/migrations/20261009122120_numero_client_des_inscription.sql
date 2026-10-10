-- Un numéro de compte existe dès l'inscription, même avant confirmation.
-- Il ne donne aucun accès aux demandes : leur rattachement exige toujours
-- la session confirmée et la preuve de réclamation existantes.
create table private.preuves_numero_inscription (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 preuve_hash text not null
);
alter table private.preuves_numero_inscription enable row level security;
revoke all on private.preuves_numero_inscription from public, anon, authenticated;

create or replace function private.numero_client_a_inscription() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_preuve text;
begin
 -- Ce marqueur désigne le parcours d'inscription, jamais un rôle d'accès.
 if new.raw_user_meta_data->>'hc_activation' = 'client' then
  perform private.attribuer_numero_client(new.id);
  v_preuve := new.raw_user_meta_data->>'hc_client_reclamation';
  if length(v_preuve) between 32 and 512 then
   -- Photographie de la preuve à la CRÉATION : les futures modifications
   -- des métadonnées utilisateur ne remplacent jamais cette empreinte.
   insert into private.preuves_numero_inscription(auth_user_id,preuve_hash)
   values(new.id,public.empreinte_secret('numero_inscription',v_preuve))
   on conflict(auth_user_id) do nothing;
  end if;
 end if;
 return new;
end $$;
revoke all on function private.numero_client_a_inscription() from public, anon, authenticated;
create trigger attribuer_numero_client_inscription after insert on auth.users
 for each row execute function private.numero_client_a_inscription();

-- Répare les comptes client déjà créés, y compris ceux non confirmés.
-- L'attribution est idempotente : aucun numéro existant ne change.
do $$
declare u record;
begin
 for u in select id,raw_user_meta_data from auth.users
  where deleted_at is null and raw_user_meta_data->>'hc_activation'='client'
 loop
  perform private.attribuer_numero_client(u.id);
  if length(u.raw_user_meta_data->>'hc_client_reclamation') between 32 and 512 then
   insert into private.preuves_numero_inscription(auth_user_id,preuve_hash)
   values(u.id,public.empreinte_secret('numero_inscription',u.raw_user_meta_data->>'hc_client_reclamation'))
   on conflict(auth_user_id) do nothing;
  end if;
 end loop;
end $$;

-- Lecture limitée au numéro : aucun profil, aucun dossier, aucun rattachement.
-- Avant confirmation, le navigateur doit prouver sa propre inscription par
-- le secret aléatoire transmis à signUp (et non par un e-mail ou UUID seul).
create or replace function public.lire_numero_client_inscription(p_user_id uuid,p_preuve text)
returns text language sql stable security definer set search_path = '' as $$
 select c.numero from public.comptes_clients c
 join private.preuves_numero_inscription p on p.auth_user_id=c.auth_user_id
 join auth.users u on u.id=c.auth_user_id and u.deleted_at is null
 where c.auth_user_id=p_user_id and length(p_preuve) between 32 and 512
 and p.preuve_hash=public.empreinte_secret('numero_inscription',p_preuve)
$$;
revoke all on function public.lire_numero_client_inscription(uuid,text) from public,anon,authenticated;
grant execute on function public.lire_numero_client_inscription(uuid,text) to anon,authenticated;
