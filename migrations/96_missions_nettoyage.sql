-- ============================================================
-- HelixCar — 96 : missions de nettoyage et photos d'intervention
-- ============================================================
-- Dépend de : 00_helpers.sql, 90_durcissement_rls_partenaires.sql
-- Idempotent : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : aucune mission existante n'est modifiée.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT
-- ------------------------------------------------------------
-- Une demande de nettoyage pouvait être reçue, chiffrée et devisée,
-- mais jamais TRANSFORMÉE EN MISSION : public.missions ne décrit qu'un
-- convoyage (ville de départ, ville d'arrivée, immatriculation…). Un
-- nettoyeur n'avait donc aucune mission à accepter, et l'administrateur
-- aucun moyen de lui en confier une.
--
-- Le système de missions existant est RÉUTILISÉ — pas dupliqué. Une
-- colonne dit de quel métier relève la mission ; les informations
-- propres à une intervention sur site s'ajoutent à côté de celles du
-- convoyage, sans en retirer aucune.

-- ------------------------------------------------------------
-- 1. De quel métier relève cette mission ?
-- ------------------------------------------------------------
alter table public.missions
  add column if not exists type_mission text not null default 'convoyage';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.missions'::regclass
       and conname  = 'missions_type_mission_check'
  ) then
    alter table public.missions
      add constraint missions_type_mission_check
      check (type_mission in ('convoyage', 'nettoyage'));
  end if;
end $$;

comment on column public.missions.type_mission is
  'Métier dont relève la mission. Toute mission antérieure est un '
  'convoyage : c''est la valeur par défaut, aucune ligne n''est modifiée.';

create index if not exists missions_type_mission_idx
  on public.missions (type_mission);

-- ------------------------------------------------------------
-- 2. Ce qu'une intervention sur site exige de savoir
-- ------------------------------------------------------------
-- Un nettoyeur a besoin d'une adresse, d'un contact, d'une date, d'un
-- horaire, de la prestation attendue et des consignes. Rien de plus,
-- rien de moins : aucune colonne de convoyage n'est détournée.
alter table public.missions
  add column if not exists adresse_intervention    text,
  add column if not exists code_postal_intervention text,
  add column if not exists ville_intervention      text,
  add column if not exists contact_nom             text,
  add column if not exists contact_tel             text,
  add column if not exists date_intervention       date,
  add column if not exists heure_intervention      text,
  add column if not exists prestation              text,
  add column if not exists nb_vehicules            integer,
  add column if not exists consignes               text,
  -- Validation finale de la prestation, par l'administrateur.
  add column if not exists prestation_validee_le   timestamptz,
  add column if not exists prestation_validee_par  uuid references auth.users(id);

comment on column public.missions.prestation is
  'Prestation attendue, reprise de la demande (nettoyage intérieur, '
  'extérieur, préparation complète…).';

-- ------------------------------------------------------------
-- 3. Le partenaire de CETTE mission — helper SECURITY DEFINER
-- ------------------------------------------------------------
-- INDISPENSABLE. Les politiques ci-dessous doivent savoir si le compte
-- en cours est le partenaire affecté à une mission. Une politique qui
-- interrogerait directement public.missions ne verrait rien dès que la
-- RLS de missions s'applique : elle ne matcherait JAMAIS, sans erreur.
-- Même piège que est_proprietaire_demande() pour les clients.
create or replace function public.est_partenaire_de_mission(p_mission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.missions m
      join public.convoyeurs c on c.id = m.convoyeur_id
     where m.id = p_mission_id
       and c.auth_user_id = auth.uid()
       and coalesce(c.bloque, false) = false
  );
$$;

revoke all on function public.est_partenaire_de_mission(uuid) from public;
grant execute on function public.est_partenaire_de_mission(uuid) to authenticated;

comment on function public.est_partenaire_de_mission(uuid) is
  'Le compte en cours est-il le partenaire NON BLOQUÉ affecté à cette '
  'mission ? Un partenaire bloqué perd l''accès, ici comme ailleurs.';

-- ------------------------------------------------------------
-- 4. Photos avant / après
-- ------------------------------------------------------------
-- Elles constatent l'état du véhicule : ce sont des pièces, pas des
-- illustrations. Elles restent donc PRIVÉES, et ne sont accessibles
-- qu'à l'administrateur et au partenaire de la mission concernée.
create table if not exists public.mission_photos (
  id          uuid primary key default gen_random_uuid(),
  mission_id  uuid not null references public.missions(id) on delete cascade,
  etape       text not null check (etape in ('avant', 'apres')),
  chemin      text not null,
  ajoutee_le  timestamptz not null default now(),
  ajoutee_par uuid references auth.users(id),
  unique (mission_id, chemin)
);

comment on table public.mission_photos is
  'Photos d''état avant et après intervention. Le fichier vit dans le '
  'bucket privé missions-photos ; cette table n''en garde que le chemin.';

create index if not exists mission_photos_mission_idx
  on public.mission_photos (mission_id, etape);

-- Privilèges de table : sans eux, PostgREST répondrait « permission
-- denied » AVANT même que la RLS ne s'applique.
grant select, insert on public.mission_photos to authenticated;
grant delete on public.mission_photos to authenticated;

alter table public.mission_photos enable row level security;

drop policy if exists "photos mission : lecture admin" on public.mission_photos;
create policy "photos mission : lecture admin"
  on public.mission_photos for select to authenticated
  using (public.est_admin());

drop policy if exists "photos mission : ecriture admin" on public.mission_photos;
create policy "photos mission : ecriture admin"
  on public.mission_photos for insert to authenticated
  with check (public.est_admin());

drop policy if exists "photos mission : suppression admin" on public.mission_photos;
create policy "photos mission : suppression admin"
  on public.mission_photos for delete to authenticated
  using (public.est_admin());

-- Le partenaire affecté voit et dépose les photos de SA mission, et
-- d'aucune autre.
drop policy if exists "photos mission : lecture partenaire" on public.mission_photos;
create policy "photos mission : lecture partenaire"
  on public.mission_photos for select to authenticated
  using (public.est_partenaire_de_mission(mission_id));

drop policy if exists "photos mission : depot partenaire" on public.mission_photos;
create policy "photos mission : depot partenaire"
  on public.mission_photos for insert to authenticated
  with check (public.est_partenaire_de_mission(mission_id));

-- Un partenaire ne SUPPRIME pas une photo déjà déposée : elle constate
-- un état à un instant donné. Seul l'administrateur peut en retirer une.

-- ------------------------------------------------------------
-- 5. Bucket privé des photos d'intervention
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select 'missions-photos', 'missions-photos', false, 10485760,
       array['image/jpeg', 'image/png', 'image/webp']
where not exists (select 1 from storage.buckets where id = 'missions-photos');

update storage.buckets
   set public = false,
       file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'missions-photos';

-- Politiques Storage : mêmes règles que la table, appliquées au fichier.
-- Le chemin est toujours « missions/<mission_id>/... » : le premier
-- segment après « missions/ » identifie la mission.
drop policy if exists "photos mission : lecture admin" on storage.objects;
create policy "photos mission : lecture admin"
  on storage.objects for select to authenticated
  using (bucket_id = 'missions-photos' and public.est_admin());

drop policy if exists "photos mission : lecture partenaire" on storage.objects;
create policy "photos mission : lecture partenaire"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'missions-photos'
    and (storage.foldername(name))[1] = 'missions'
    and public.est_partenaire_de_mission(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "photos mission : depot partenaire" on storage.objects;
create policy "photos mission : depot partenaire"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'missions-photos'
    and (storage.foldername(name))[1] = 'missions'
    and public.est_partenaire_de_mission(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "photos mission : suppression admin" on storage.objects;
create policy "photos mission : suppression admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'missions-photos' and public.est_admin());

-- AUCUNE politique n'est accordée à `anon` : ces photos ne sont jamais
-- accessibles sans compte, et le bucket n'est jamais public.

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select id, public from storage.buckets where id = 'missions-photos';
--   -- public doit valoir false
--
--   select count(*) from public.missions where type_mission <> 'convoyage';
--   -- 0 juste après la migration : aucune mission existante n'a changé
--
--   select polname from pg_policies
--    where tablename = 'objects' and polname like 'photos mission%';
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
-- Les colonnes ajoutées à public.missions doivent être LAISSÉES EN
-- PLACE : elles sont nullables, la version précédente les ignore, et
-- les retirer supprimerait des missions de nettoyage réellement créées.
--
-- Pour revenir en arrière sans perte :
--   1. ne plus créer de mission de nettoyage depuis le Dashboard ;
--   2. si nécessaire, retirer les politiques Storage :
--        drop policy if exists "photos mission : depot partenaire" on storage.objects;
--        drop policy if exists "photos mission : lecture partenaire" on storage.objects;
--        drop policy if exists "photos mission : lecture admin" on storage.objects;
--        drop policy if exists "photos mission : suppression admin" on storage.objects;
--
-- Ne PAS supprimer public.mission_photos ni le bucket tant qu'une
-- mission de nettoyage a été réalisée : ce sont des pièces
-- justificatives de l'état des véhicules.
