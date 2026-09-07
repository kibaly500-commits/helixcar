-- ============================================================
-- HelixCar — 05 : blocage persistant d'un partenaire
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- POINT CENTRAL : le blocage doit être RÉEL, pas un bouton ni un
-- masque visuel. Il est donc porté par la base ET appliqué par les
-- politiques RLS : un partenaire bloqué ne lit plus ses propres
-- données protégées, quel que soit le JavaScript exécuté dans son
-- navigateur, après déconnexion/reconnexion ou navigation directe.

alter table public.convoyeurs
  add column if not exists bloque       boolean not null default false,
  add column if not exists bloque_le    timestamptz,
  add column if not exists bloque_par   uuid references auth.users(id),
  add column if not exists bloque_motif text;

comment on column public.convoyeurs.bloque is
  'Blocage réel du partenaire. Appliqué par les politiques RLS, jamais '
  'par le seul affichage : un partenaire bloqué perd l''accès à ses '
  'données protégées côté serveur.';

create index if not exists convoyeurs_bloque_idx
  on public.convoyeurs (bloque) where bloque;

-- Horodatage et auteur du blocage renseignés automatiquement : impossible
-- d'avoir un blocage sans trace.
create or replace function public.tracer_blocage_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.bloque is distinct from old.bloque then
    if new.bloque then
      new.bloque_le  := now();
      new.bloque_par := auth.uid();
    else
      -- Déblocage : on rétablit uniquement les autorisations prévues,
      -- sans conserver un état de blocage résiduel.
      new.bloque_le    := null;
      new.bloque_par   := null;
      new.bloque_motif := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_tracer_blocage_convoyeur on public.convoyeurs;
create trigger trg_tracer_blocage_convoyeur
  before update on public.convoyeurs
  for each row execute function public.tracer_blocage_convoyeur();

-- ------------------------------------------------------------
-- Fonction d'accès : un partenaire actif est un partenaire NON bloqué.
-- Utilisable par toute politique protégeant une donnée partenaire.
-- ------------------------------------------------------------
create or replace function public.partenaire_actif()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.convoyeurs c
     where c.auth_user_id = auth.uid()
       and c.bloque is false
  );
$$;

revoke all on function public.partenaire_actif() from public;
grant execute on function public.partenaire_actif() to authenticated;

-- ------------------------------------------------------------
-- RLS sur la table des candidatures
-- ------------------------------------------------------------
alter table public.convoyeurs enable row level security;

-- Un partenaire lit SA candidature, et seulement s'il n'est pas bloqué.
-- C'est ici que le blocage devient réel : la ligne cesse d'être visible.
drop policy if exists "convoyeurs : lecture par le proprietaire non bloque" on public.convoyeurs;
create policy "convoyeurs : lecture par le proprietaire non bloque"
  on public.convoyeurs for select to authenticated
  using (auth_user_id = auth.uid() and bloque is false);

-- Un administrateur actif voit tout, y compris les partenaires bloqués
-- (sans quoi il ne pourrait plus jamais les débloquer).
drop policy if exists "convoyeurs : lecture admin" on public.convoyeurs;
create policy "convoyeurs : lecture admin"
  on public.convoyeurs for select to authenticated
  using (public.est_admin());

-- Un partenaire met à jour SA candidature tant qu'il n'est pas bloqué.
-- Les colonnes de décision, de statut et de blocage restent hors de sa
-- portée : voir le trigger de garde ci-dessous.
drop policy if exists "convoyeurs : mise a jour par le proprietaire non bloque" on public.convoyeurs;
create policy "convoyeurs : mise a jour par le proprietaire non bloque"
  on public.convoyeurs for update to authenticated
  using (auth_user_id = auth.uid() and bloque is false)
  with check (auth_user_id = auth.uid() and bloque is false);

drop policy if exists "convoyeurs : mise a jour admin" on public.convoyeurs;
create policy "convoyeurs : mise a jour admin"
  on public.convoyeurs for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- Le dépôt d'une candidature reste ouvert (formulaire public, clé anon),
-- comportement actuel inchangé.
drop policy if exists "convoyeurs : depot de candidature" on public.convoyeurs;
create policy "convoyeurs : depot de candidature"
  on public.convoyeurs for insert to anon, authenticated
  with check (true);

-- GARDE-FOU : seul un administrateur peut modifier les colonnes
-- sensibles. Un partenaire qui tenterait de se débloquer lui-même ou de
-- changer son statut est rejeté côté serveur, quelle que soit la requête.
create or replace function public.garde_colonnes_sensibles_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.est_admin() then
    return new;
  end if;
  if new.bloque       is distinct from old.bloque
     or new.bloque_le    is distinct from old.bloque_le
     or new.bloque_par   is distinct from old.bloque_par
     or new.bloque_motif is distinct from old.bloque_motif
     or new.statut       is distinct from old.statut then
    raise exception 'Modification réservée à un administrateur.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

drop trigger if exists trg_garde_colonnes_sensibles_convoyeur on public.convoyeurs;
create trigger trg_garde_colonnes_sensibles_convoyeur
  before update on public.convoyeurs
  for each row execute function public.garde_colonnes_sensibles_convoyeur();

-- ------------------------------------------------------------
-- VÉRIFICATION MANUELLE RECOMMANDÉE APRÈS APPLICATION
-- ------------------------------------------------------------
-- 1. Bloquer un partenaire de test, puis, depuis SA session :
--      select * from convoyeurs;              -> 0 ligne
--      select * from convoyeur_decisions;     -> 0 ligne
--    y compris après déconnexion / reconnexion.
-- 2. Depuis cette même session, tenter :
--      update convoyeurs set bloque = false where auth_user_id = auth.uid();
--    -> doit échouer (insufficient_privilege), jamais réussir.
-- 3. Débloquer depuis un compte administrateur et vérifier que l'accès
--    prévu est rétabli, et lui seul.
