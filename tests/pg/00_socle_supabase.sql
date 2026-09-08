-- ============================================================
-- Socle de vérification — reproduction locale de l'environnement
-- Supabase AVANT migrations.
-- ============================================================
-- Ce fichier n'est PAS une migration et ne doit JAMAIS être exécuté
-- sur Supabase. Il sert uniquement à monter une base PostgreSQL
-- jetable pour y appliquer les vrais fichiers de migrations/ et
-- observer réellement le comportement des politiques RLS.
--
-- Il reconstitue :
--   * les rôles Supabase (anon, authenticated, service_role) ;
--   * le schéma auth et auth.uid() / auth.email() tels que Supabase
--     les définit (lecture des claims JWT via current_setting) ;
--   * les tables publiques telles qu'elles existent AUJOURD'HUI,
--     c'est-à-dire SANS RLS — l'état de départ réel.

create extension if not exists pgcrypto;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Définitions Supabase : l'identité vient du JWT, pas du rôle SQL.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
$$;

grant usage on schema auth   to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Tables telles qu'elles existent avant ce lot.
-- ------------------------------------------------------------
create table if not exists public.admins (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  email        text,
  actif        boolean not null default true
);

create table if not exists public.convoyeurs (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  prenom       text,
  nom          text,
  email        text,
  telephone    text,
  experience   text,
  activites    text[],
  id_url       text,
  permis_url   text,
  rc_pro_url   text,
  rib_iban     text,
  statut       text not null default 'en_attente',
  created_at   timestamptz not null default now()
);

create table if not exists public.missions (
  id           uuid primary key default gen_random_uuid(),
  convoyeur_id uuid references public.convoyeurs(id),
  -- Simple uuid : public.clients est déclarée plus bas dans ce socle,
  -- et une contrainte croisée n'apporterait rien au test.
  client_id    uuid,
  reference    text,
  statut       text not null default 'en_attente',
  ville_depart text,
  ville_arrivee text,
  prix_ttc     numeric,
  created_at   timestamptz not null default now()
);

create table if not exists public.clients (
  id                    uuid primary key default gen_random_uuid(),
  numero_client         text,
  email                 text,
  nom                   text,
  -- Colonnes lues par les migrations 01, 02 et 06. Le schéma réel en
  -- comporte davantage : seules celles dont dépendent les migrations
  -- sont reproduites ici.
  type_service          text,
  type_client           text,
  societe               text,
  siret                 text,
  source_acquisition        text,
  source_acquisition_detail text,
  nettoyage_details     jsonb,
  professionnel_details jsonb,
  statut                text not null default 'nouveau',
  prenom                text,
  telephone             text,
  nb_vehicules          integer,
  immatriculation       text,
  marque_modele         text,
  date_prise_en_charge  date,
  contact_pc_nom        text,
  contact_pc_tel        text,
  adresse_depart_rue    text,
  adresse_arrivee_rue   text,
  contact_liv_nom       text,
  contact_liv_tel       text,
  ville_depart          text,
  ville_arrivee         text,
  -- Trajet commun à tous les véhicules ? Depuis la refonte du
  -- formulaire, le navigateur envoie TOUJOURS false : les informations
  -- de trajet vivent dans public.vehicules, y compris à 1 véhicule.
  trajet_commun         boolean,
  stockage_ville        text,
  stockage_acheminement text,
  stockage_sortie       text,
  stockage_date_debut   date,
  -- Colonne interne : sert à prouver qu'elle ne fuit JAMAIS vers le client.
  prix_interne          numeric,
  created_at            timestamptz not null default now()
);

-- Grants Supabase par défaut : les rôles ont les privilèges de table,
-- c'est la RLS — et elle seule — qui filtre ensuite les lignes.
-- Table des véhicules d'une demande. Elle EXISTE en production et
-- n'a jamais été touchée par une migration du dépôt : sa RLS vient donc
-- du projet Supabase lui-même. On reproduit ici l'état qui provoque
-- l'erreur 42501 constatée après le durcissement des demandes.
create table if not exists public.vehicules (
  id                     uuid primary key default gen_random_uuid(),
  dossier_id             uuid references public.clients(id) on delete cascade,
  position               integer default 1,
  type_vehicule          text,
  marque_modele          text,
  immatriculation        text,
  vin                    text,
  mode_transport         text,
  consignes              text,
  adresse_depart_rue     text,
  code_postal_depart     text,
  ville_depart           text,
  pc_contact_nom         text,
  pc_contact_tel         text,
  date_prise_en_charge   date,
  heure_prise_en_charge  text,
  pc_heure_type          text,
  pc_creneau_debut       text,
  pc_creneau_fin         text,
  adresse_arrivee_rue    text,
  code_postal_arrivee    text,
  ville_arrivee          text,
  liv_contact_nom        text,
  liv_contact_tel        text,
  date_livraison         date,
  heure_livraison        text,
  liv_heure_type         text,
  liv_creneau_debut      text,
  liv_creneau_fin        text,
  restitution_concernee  boolean default false,
  restit_adresse_rue     text,
  restit_code_postal     text,
  restit_ville           text,
  restit_contact_nom     text,
  restit_contact_tel     text,
  restit_date            date,
  restit_heure           text,
  restit_heure_type      text,
  restit_creneau_debut   text,
  restit_creneau_fin     text,
  restit_contraintes     text,
  heure_recuperation_client text,
  restit_type_vehicule   text,
  restit_marque_modele   text,
  restit_immatriculation text,
  restit_vin             text,
  created_at             timestamptz not null default now()
);

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant select on all tables in schema auth to anon, authenticated;

-- ------------------------------------------------------------
-- Schéma storage (réduit au strict nécessaire pour appliquer 03).
-- ------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id       uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name     text,
  owner    uuid
);

-- storage.foldername() : Supabase la fournit pour découper le chemin
-- d'un objet en segments. Les politiques Storage s'appuient dessus, il
-- faut donc la reproduire à l'identique pour les éprouver.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
as $$
  select string_to_array(name, '/');
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

-- Comme en production : la RLS de storage.objects est active, et seules
-- les politiques donnent accès.
alter table storage.objects enable row level security;

-- Supabase pose des privilèges PAR DÉFAUT sur le schéma public : toute
-- table créée ensuite est automatiquement accessible aux rôles, la RLS
-- restant le seul filtre sur les lignes. On reproduit ce comportement
-- pour que la vérification porte bien sur la RLS et non sur un grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- ÉTAT REPRODUIT : public.vehicules porte déjà une RLS dont la policy
-- d'insertion vérifie l'existence du dossier parent dans public.clients.
-- Tant que public.clients n'avait AUCUNE RLS, cette sous-requête voyait
-- la ligne et l'insertion passait. C'est exactement la configuration qui
-- casse dès que les demandes sont fermées.
alter table public.vehicules enable row level security;
drop policy if exists "vehicules : depot lie au dossier" on public.vehicules;
create policy "vehicules : depot lie au dossier"
  on public.vehicules for insert to anon, authenticated
  with check (
    exists (select 1 from public.clients c where c.id = vehicules.dossier_id)
  );

-- État de départ : la RLS de public.admins est déjà en place aujourd'hui
-- (le Dashboard lit sa propre ligne via une session authentifiée).
alter table public.admins enable row level security;
drop policy if exists "admins : lecture de sa propre ligne" on public.admins;
create policy "admins : lecture de sa propre ligne"
  on public.admins for select to authenticated
  using (auth_user_id = auth.uid());
