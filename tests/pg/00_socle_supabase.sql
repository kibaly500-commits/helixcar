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
  reference    text,
  statut       text not null default 'en_attente',
  ville_depart text,
  ville_arrivee text,
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
  nettoyage_details     jsonb,
  created_at            timestamptz not null default now()
);

-- Grants Supabase par défaut : les rôles ont les privilèges de table,
-- c'est la RLS — et elle seule — qui filtre ensuite les lignes.
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

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

-- Supabase pose des privilèges PAR DÉFAUT sur le schéma public : toute
-- table créée ensuite est automatiquement accessible aux rôles, la RLS
-- restant le seul filtre sur les lignes. On reproduit ce comportement
-- pour que la vérification porte bien sur la RLS et non sur un grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;

-- État de départ : la RLS de public.admins est déjà en place aujourd'hui
-- (le Dashboard lit sa propre ligne via une session authentifiée).
alter table public.admins enable row level security;
drop policy if exists "admins : lecture de sa propre ligne" on public.admins;
create policy "admins : lecture de sa propre ligne"
  on public.admins for select to authenticated
  using (auth_user_id = auth.uid());
