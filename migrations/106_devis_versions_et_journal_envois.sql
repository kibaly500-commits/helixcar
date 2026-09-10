-- ============================================================
-- HelixCar — 106 : versions de devis et journal des envois
-- ============================================================
-- Dépend de : 00_helpers.sql (est_admin), et de la table public.devis
--             telle qu'elle existe en production (antérieure au dépôt :
--             id, reference, client_id, prix, statut, date_generation,
--             date_envoi, date_acceptation, date_refus, motif_refus,
--             pdf_path, acceptation_token_hash, date_expiration_token,
--             snapshot_devis).
-- Idempotente : peut être rejouée sans effet de bord.
-- Purement ADDITIVE : des colonnes nullables ou à valeur par défaut sur
-- public.devis, une table de journal fermée par RLS, un trigger de
-- version. Aucune donnée modifiée, aucune RLS désactivée, aucun bucket
-- ouvert. Aucun objet Stripe : le paiement n'est PAS intégré ici
-- (décision de gouvernance : rien avant la validation du gate devis) —
-- seules les colonnes d'ÉTAT sont préparées, et rien ne les renseigne
-- encore à « payé ».
--
-- LES MIGRATIONS 92 À 105 NE SONT PAS RETOUCHÉES.
--
-- ------------------------------------------------------------
-- CE QUI MANQUAIT (lot Q01, décision C11)
-- ------------------------------------------------------------
--   1. Un devis n'avait pas de VERSION. Un prix modifié après envoi
--      laissait le lien envoyé pointer vers un PDF périmé, sans que
--      personne ne puisse dire quelle version le client avait vue,
--      acceptée, ou qu'on lui avait envoyée.
--
--   2. « Envoyé » était un seul mot pour cinq faits différents : le
--      clic, la préparation, la tentative, l'acceptation par le
--      prestataire d'e-mail, et la réception réelle en boîte. Un échec
--      ne laissait aucune trace, un renvoi non plus.
--
--   3. Les états du devis n'étaient pas séparés : rien ne distinguait
--      « consulté » d'« envoyé », ni « accepté » d'« accepté — paiement
--      en attente ».

-- ------------------------------------------------------------
-- 1. LA VERSION D'UN DEVIS
-- ------------------------------------------------------------
alter table public.devis
  add column if not exists version               integer     not null default 1,
  add column if not exists version_preparee      integer,
  add column if not exists version_envoyee       integer,
  add column if not exists version_acceptee      integer,
  add column if not exists consulte_le           timestamptz,
  add column if not exists envoi_en_cours_depuis timestamptz,
  add column if not exists paiement_statut       text        not null default 'aucun',
  add column if not exists paiement_confirme_le  timestamptz,
  add column if not exists annule_le             timestamptz,
  add column if not exists expire_le             timestamptz;

comment on column public.devis.version is
  'Version courante du devis. Incrémentée par trigger à chaque '
  'changement de prix. Une version modifiée après envoi doit être '
  'renvoyée et acceptée à nouveau.';
comment on column public.devis.version_preparee is
  'Version pour laquelle le PDF et le lien sécurisé ont été préparés '
  '(action prepare). L''envoi refuse toute version préparée différente '
  'de la version courante.';
comment on column public.devis.version_envoyee is
  'Version RÉELLEMENT envoyée au client, posée uniquement après '
  'acceptation de l''envoi par le prestataire d''e-mail.';
comment on column public.devis.version_acceptee is
  'Version que le client a acceptée. Une acceptation n''est possible '
  'que sur la version envoyée, et seulement si elle est encore la '
  'version courante.';
comment on column public.devis.consulte_le is
  'Première consultation du devis par le client via son lien sécurisé. '
  'État distinct d''« envoyé » : un e-mail parti n''est pas un e-mail lu.';
comment on column public.devis.envoi_en_cours_depuis is
  'Verrou d''envoi côté serveur : posé au début d''une tentative, levé à '
  'sa fin. Empêche deux envois simultanés (double clic, deux onglets).';
comment on column public.devis.paiement_statut is
  'État de paiement, SÉPARÉ du statut du devis : aucun, en_attente '
  '(devis accepté, paiement proposé), paye, rembourse_partiel, '
  'rembourse. Seul un événement de paiement authentifié côté serveur '
  'pourra un jour passer à paye — rien dans ce lot ne le fait.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'devis_paiement_statut_valide') then
    alter table public.devis
      add constraint devis_paiement_statut_valide
      check (paiement_statut in ('aucun', 'en_attente', 'paye', 'rembourse_partiel', 'rembourse'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'devis_version_positive') then
    alter table public.devis
      add constraint devis_version_positive
      check (version >= 1);
  end if;
end $$;

-- Le trigger de version : un prix qui change fait une nouvelle version.
-- Rien d'autre n'est modifié ici — c'est le Dashboard qui repasse le
-- statut à « genere », et la fonction serveur qui refuse d'envoyer ou
-- d'accepter une version qui n'est plus la courante.
create or replace function public.devis_nouvelle_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.prix is distinct from old.prix then
    new.version := coalesce(old.version, 1) + 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_devis_nouvelle_version on public.devis;
create trigger trg_devis_nouvelle_version
  before update on public.devis
  for each row execute function public.devis_nouvelle_version();

-- ------------------------------------------------------------
-- 2. LE JOURNAL DES ENVOIS : préparation, tentative, acceptation par
--    le prestataire, échec, réception prouvée — SÉPARÉMENT (C11)
-- ------------------------------------------------------------
create table if not exists public.devis_envois (
  id              uuid primary key default gen_random_uuid(),
  devis_id        uuid not null references public.devis(id) on delete cascade,
  version         integer not null,
  etape           text not null
                    check (etape in ('preparation', 'tentative', 'acceptee_prestataire',
                                     'echec', 'reception_prouvee')),
  destinataire    text,
  renvoi          boolean not null default false,
  envoi_cle       text,                 -- clé d'idempotence d'une tentative (double clic)
  fournisseur     text,                 -- ex. resend
  fournisseur_id  text,                 -- identifiant du message chez le prestataire
  detail          text,                 -- code d'erreur ou précision, JAMAIS un secret
  auteur          uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

comment on table public.devis_envois is
  'Journal des envois de devis. Une ligne par ÉVÉNEMENT : préparation, '
  'tentative, acceptation par le prestataire d''e-mail, échec, réception '
  'prouvée. Un clic ne prouve rien ; chaque fait est tracé séparément. '
  'Aucun jeton, aucune adresse d''envoi signée, aucun secret.';

create index if not exists devis_envois_devis_idx
  on public.devis_envois (devis_id, created_at desc);
create index if not exists devis_envois_cle_idx
  on public.devis_envois (devis_id, envoi_cle)
  where envoi_cle is not null;

-- FERMÉ : seuls les administrateurs lisent le journal ; personne n'y
-- écrit depuis le navigateur. La fonction serveur (service_role,
-- hors RLS) est la seule à y insérer.
alter table public.devis_envois enable row level security;
revoke all on public.devis_envois from anon;
revoke all on public.devis_envois from authenticated;
grant select on public.devis_envois to authenticated;

drop policy if exists "devis_envois : lecture admin" on public.devis_envois;
create policy "devis_envois : lecture admin"
  on public.devis_envois for select to authenticated
  using (public.est_admin());

-- ------------------------------------------------------------
-- VÉRIFICATION APRÈS APPLICATION
-- ------------------------------------------------------------
--   select count(*) from information_schema.columns
--    where table_name = 'devis'
--      and column_name in ('version','version_preparee','version_envoyee','version_acceptee',
--                          'consulte_le','envoi_en_cours_depuis','paiement_statut',
--                          'paiement_confirme_le','annule_le','expire_le');
--   -- attendu : 10
--
--   select tgname from pg_trigger
--    where tgrelid = 'public.devis'::regclass and tgname = 'trg_devis_nouvelle_version';
--   -- attendu : 1 ligne
--
--   select policyname from pg_policies where tablename = 'devis_envois';
--   -- attendu : « devis_envois : lecture admin » uniquement
--
--   select count(*) from information_schema.role_table_grants
--    where table_name = 'devis_envois' and grantee = 'anon';
--   -- attendu : 0
--
-- ------------------------------------------------------------
-- RETOUR ARRIÈRE
-- ------------------------------------------------------------
--   1. Ne rien faire : colonnes vides et journal vide n'ont aucun effet
--      sur l'existant.
--   2. Retirer le trigger de version :
--        drop trigger if exists trg_devis_nouvelle_version on public.devis;
--        drop function if exists public.devis_nouvelle_version();
--      ⚠️ Un prix modifié après envoi ne fait plus de nouvelle version.
--   3. Retirer le journal (DESTRUCTIF : l'historique des envois est perdu) :
--        drop table if exists public.devis_envois;
--   4. Retirer les colonnes (DESTRUCTIF) :
--        alter table public.devis drop column if exists version, ... ;
