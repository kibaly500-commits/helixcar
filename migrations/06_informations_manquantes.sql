-- ============================================================
-- HelixCar — 06 : informations manquantes (préparation sans Stripe)
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- STRIPE N'EXISTE PAS ENCORE. Ce modèle est volontairement INDÉPENDANT
-- du paiement : aucune colonne « payé », aucun statut de paiement,
-- aucune création automatique de mission. L'enchaînement
-- paiement -> complément -> mission reste DORMANT et devra être activé
-- dans un lot ultérieur, uniquement sur confirmation serveur fiable
-- (webhook Stripe signé) — jamais sur un état modifiable dans le
-- navigateur.

-- ------------------------------------------------------------
-- PRÉALABLE : lien entre une demande et le compte de son auteur.
-- Ce lien N'EXISTAIT PAS (public.clients ne portait aucun
-- auth_user_id) ; sans lui, aucune politique « le client voit ce qui
-- le concerne » n'est possible. Colonne ajoutée ici, nullable :
-- aucune demande déjà enregistrée n'est modifiée ni invalidée.
-- ------------------------------------------------------------
alter table public.clients
  add column if not exists auth_user_id uuid references auth.users(id);

create index if not exists clients_auth_user_id_idx
  on public.clients (auth_user_id);

comment on column public.clients.auth_user_id is
  'Compte Supabase Auth du demandeur. NULL pour les demandes créées '
  'avant ce lien, et pour toute demande déposée sans compte.';

-- RATTACHEMENT DE L''HISTORIQUE — VOLONTAIREMENT NON EXÉCUTÉ.
-- Un rapprochement automatique par e-mail rattacherait des demandes à
-- un compte sur la seule foi d''une adresse : en cas d''homonymie ou
-- d''adresse réutilisée, cela exposerait la demande d''un tiers.
-- À décider explicitement par HelixCar, après vérification :
--
--   update public.clients c
--      set auth_user_id = u.id
--     from auth.users u
--    where c.auth_user_id is null
--      and lower(c.email) = lower(u.email);

create table if not exists public.demande_informations_manquantes (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  cle           text not null,          -- identifiant technique stable
  libelle       text not null,          -- intitulé présenté au client
  statut        text not null default 'attendue'
                  check (statut in ('attendue', 'transmise', 'validee', 'a_corriger')),
  valeur        text,                   -- réponse réellement fournie
  commentaire   text,                   -- demande de correction éventuelle
  transmise_le  timestamptz,
  validee_le    timestamptz,
  validee_par   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (client_id, cle)
);

comment on table public.demande_informations_manquantes is
  'Éléments restant à compléter pour une demande. Aucun lien avec un '
  'paiement : Stripe n''est pas installé et aucune activation ne dépend '
  'de cette table.';

create index if not exists dim_client_idx
  on public.demande_informations_manquantes (client_id, statut);

-- Horodatage automatique des transitions réellement effectuées.
create or replace function public.tracer_information_manquante()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.statut is distinct from old.statut then
    if new.statut = 'transmise' then new.transmise_le := now(); end if;
    if new.statut = 'validee' then
      new.validee_le  := now();
      new.validee_par := auth.uid();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tracer_information_manquante on public.demande_informations_manquantes;
create trigger trg_tracer_information_manquante
  before insert or update on public.demande_informations_manquantes
  for each row execute function public.tracer_information_manquante();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.demande_informations_manquantes enable row level security;

-- Le client concerné voit ce qui lui est demandé, et peut y répondre.
-- Le lien passe par clients.auth_user_id (compte du demandeur).
drop policy if exists "infos manquantes : lecture client" on public.demande_informations_manquantes;
create policy "infos manquantes : lecture client"
  on public.demande_informations_manquantes for select to authenticated
  using (
    exists (
      select 1 from public.clients c
       where c.id = demande_informations_manquantes.client_id
         and c.auth_user_id = auth.uid()
    )
  );

-- Le client renseigne sa réponse et passe l'élément en « transmise ».
-- Il ne peut jamais le valider lui-même : la validation est réservée à
-- l'administrateur (contrôlée par le trigger ci-dessous).
drop policy if exists "infos manquantes : reponse client" on public.demande_informations_manquantes;
create policy "infos manquantes : reponse client"
  on public.demande_informations_manquantes for update to authenticated
  using (
    exists (
      select 1 from public.clients c
       where c.id = demande_informations_manquantes.client_id
         and c.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.clients c
       where c.id = demande_informations_manquantes.client_id
         and c.auth_user_id = auth.uid()
    )
    and statut in ('attendue', 'transmise')
  );

drop policy if exists "infos manquantes : lecture admin" on public.demande_informations_manquantes;
create policy "infos manquantes : lecture admin"
  on public.demande_informations_manquantes for select to authenticated
  using (public.est_admin());

drop policy if exists "infos manquantes : ecriture admin" on public.demande_informations_manquantes;
create policy "infos manquantes : ecriture admin"
  on public.demande_informations_manquantes for insert to authenticated
  with check (public.est_admin());

drop policy if exists "infos manquantes : modification admin" on public.demande_informations_manquantes;
create policy "infos manquantes : modification admin"
  on public.demande_informations_manquantes for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

drop policy if exists "infos manquantes : suppression admin" on public.demande_informations_manquantes;
create policy "infos manquantes : suppression admin"
  on public.demande_informations_manquantes for delete to authenticated
  using (public.est_admin());

-- Garde-fou : seul un administrateur valide ou demande une correction.
create or replace function public.garde_validation_information_manquante()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.est_admin() then
    return new;
  end if;
  if new.statut in ('validee', 'a_corriger') and new.statut is distinct from old.statut then
    raise exception 'La validation est réservée à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  if new.libelle is distinct from old.libelle or new.cle is distinct from old.cle then
    raise exception 'Élément demandé non modifiable par le client.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_garde_validation_information_manquante on public.demande_informations_manquantes;
create trigger trg_garde_validation_information_manquante
  before update on public.demande_informations_manquantes
  for each row execute function public.garde_validation_information_manquante();

-- ------------------------------------------------------------
-- Progression, pour l'onglet « Informations à compléter ».
-- ------------------------------------------------------------
create or replace view public.v_informations_manquantes_progression as
select
  client_id,
  count(*)                                             as total,
  count(*) filter (where statut = 'validee')           as validees,
  count(*) filter (where statut = 'transmise')         as transmises,
  count(*) filter (where statut in ('attendue', 'a_corriger')) as restantes
from public.demande_informations_manquantes
group by client_id;

alter view public.v_informations_manquantes_progression set (security_invoker = on);

-- ------------------------------------------------------------
-- NON FAIT VOLONTAIREMENT (à traiter dans un lot ultérieur) :
--   * aucune colonne ni table de paiement ;
--   * aucun webhook, réel ou simulé ;
--   * aucune création automatique de mission ;
--   * aucun statut « payé » atteignable depuis le navigateur.
-- ------------------------------------------------------------
