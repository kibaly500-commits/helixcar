-- ============================================================
-- HelixCar — 04 : décisions par activité + historique
-- ============================================================
-- Dépend de : 00_helpers.sql
--
-- Un partenaire peut candidater sur PLUSIEURS activités
-- (convoyeurs.activites text[], déjà en place). Chaque activité reçoit
-- sa PROPRE décision, indépendante des autres, et modifiable.
-- Valeur par défaut : « en_attente ».

create table if not exists public.convoyeur_decisions (
  id           uuid primary key default gen_random_uuid(),
  convoyeur_id uuid not null references public.convoyeurs(id) on delete cascade,
  activite     text not null check (activite in ('convoyage', 'nettoyage', 'renfort')),
  decision     text not null default 'en_attente'
                 check (decision in ('oui', 'non', 'en_attente')),
  decide_le    timestamptz,
  decide_par   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Une seule décision courante par (candidature, activité) :
  -- l'historique vit dans la table dédiée ci-dessous.
  unique (convoyeur_id, activite)
);

comment on table public.convoyeur_decisions is
  'Décision courante par activité d''une candidature partenaire. '
  'Défaut en_attente ; les décisions sont indépendantes entre activités.';

create index if not exists convoyeur_decisions_convoyeur_idx
  on public.convoyeur_decisions (convoyeur_id);

-- ------------------------------------------------------------
-- Historique : ancienne décision, nouvelle décision, date, auteur.
-- Alimenté automatiquement — il ne peut donc pas être « oublié ».
-- ------------------------------------------------------------
create table if not exists public.convoyeur_decisions_historique (
  id                uuid primary key default gen_random_uuid(),
  convoyeur_id      uuid not null references public.convoyeurs(id) on delete cascade,
  activite          text not null,
  ancienne_decision text,
  nouvelle_decision text not null,
  modifie_le        timestamptz not null default now(),
  modifie_par       uuid references auth.users(id)
);

create index if not exists convoyeur_decisions_hist_convoyeur_idx
  on public.convoyeur_decisions_historique (convoyeur_id, modifie_le desc);

create or replace function public.tracer_decision_convoyeur()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.decision is not distinct from old.decision then
    return new;   -- aucune décision réellement changée : rien à tracer
  end if;

  new.updated_at := now();
  if new.decision <> 'en_attente' then
    new.decide_le  := now();
    new.decide_par := auth.uid();
  end if;

  insert into public.convoyeur_decisions_historique
    (convoyeur_id, activite, ancienne_decision, nouvelle_decision, modifie_par)
  values
    (new.convoyeur_id, new.activite,
     case when tg_op = 'UPDATE' then old.decision else null end,
     new.decision, auth.uid());

  return new;
end $$;

drop trigger if exists trg_tracer_decision_convoyeur on public.convoyeur_decisions;
create trigger trg_tracer_decision_convoyeur
  before insert or update on public.convoyeur_decisions
  for each row execute function public.tracer_decision_convoyeur();

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.convoyeur_decisions            enable row level security;
alter table public.convoyeur_decisions_historique enable row level security;

-- Seul un administrateur actif décide. Un partenaire ne peut jamais
-- écrire sa propre décision.
drop policy if exists "decisions : lecture admin" on public.convoyeur_decisions;
create policy "decisions : lecture admin"
  on public.convoyeur_decisions for select to authenticated
  using (public.est_admin());

drop policy if exists "decisions : ecriture admin" on public.convoyeur_decisions;
create policy "decisions : ecriture admin"
  on public.convoyeur_decisions for insert to authenticated
  with check (public.est_admin());

drop policy if exists "decisions : modification admin" on public.convoyeur_decisions;
create policy "decisions : modification admin"
  on public.convoyeur_decisions for update to authenticated
  using (public.est_admin()) with check (public.est_admin());

-- L'historique est consultable par les administrateurs et n'est jamais
-- modifiable à la main : il n'existe aucune policy update/delete.
drop policy if exists "historique decisions : lecture admin" on public.convoyeur_decisions_historique;
create policy "historique decisions : lecture admin"
  on public.convoyeur_decisions_historique for select to authenticated
  using (public.est_admin());

-- ------------------------------------------------------------
-- Amorçage : une ligne « en_attente » par activité réellement
-- déclarée, pour les candidatures déjà enregistrées. Idempotent.
-- ------------------------------------------------------------
insert into public.convoyeur_decisions (convoyeur_id, activite, decision)
select c.id, a, 'en_attente'
  from public.convoyeurs c
  cross join lateral unnest(coalesce(c.activites, '{}')) as a
 where a in ('convoyage', 'nettoyage', 'renfort')
on conflict (convoyeur_id, activite) do nothing;
