-- Q01-003, Q02-002 : identité ayant répondu. Additive ; aucune identité
-- historique inventée, aucune donnée ni politique existante supprimée.
begin;
alter table public.devis
  add column if not exists accepte_par uuid references auth.users(id),
  add column if not exists refuse_par uuid references auth.users(id);
comment on column public.devis.accepte_par is 'Identité Auth vérifiée, propriétaire de la demande lors de son acceptation.';
comment on column public.devis.refuse_par is 'Identité Auth vérifiée, propriétaire de la demande lors de son refus.';

-- Archives immuables des PDF et des liens préparés. Les versions déjà
-- envoyées restent téléchargeables par leur propriétaire après révision.
create table if not exists public.devis_preparations (
  id uuid primary key default gen_random_uuid(),
  devis_id uuid not null references public.devis(id),
  version integer not null check(version > 0),
  token_hash text not null unique,
  pdf_path text not null,
  snapshot_devis jsonb not null,
  date_expiration timestamptz not null,
  envoyee_le timestamptz,
  created_at timestamptz not null default now()
);
alter table public.devis_preparations enable row level security;
revoke all on public.devis_preparations from public, anon, authenticated;
grant select, insert, update on public.devis_preparations to service_role;
create index if not exists devis_preparations_version_idx on public.devis_preparations(devis_id,version);

-- File d'envoi privée, distincte du journal d'audit. Le payload figé
-- contient le lien du destinataire et le PDF : aucun accès navigateur,
-- aucune vue admin, aucune copie dans les logs ou captures.
create table if not exists public.devis_envoi_operations (
  id uuid primary key default gen_random_uuid(),
  devis_id uuid not null references public.devis(id),
  version integer not null check(version > 0),
  envoi_cle text not null,
  token_hash text not null,
  payload jsonb not null,
  destinataire text not null,
  auteur uuid not null references auth.users(id),
  renvoi boolean not null default false,
  etat text not null default 'en_cours' check(etat in ('en_cours','a_reconcilier','acceptee','echec')),
  fournisseur_id text,
  acceptee_le timestamptz,
  created_at timestamptz not null default now(),
  unique(devis_id,envoi_cle)
);
alter table public.devis_envoi_operations enable row level security;
revoke all on public.devis_envoi_operations from public, anon, authenticated;
grant select, insert, update on public.devis_envoi_operations to service_role;
create unique index if not exists devis_une_operation_active on public.devis_envoi_operations(devis_id)
  where etat in ('en_cours','a_reconcilier');

-- Préserve ce qui est effectivement disponible avant la migration.
-- Aucun historique disparu n'est reconstruit ou présenté comme certain.
insert into public.devis_preparations(devis_id,version,token_hash,pdf_path,snapshot_devis,date_expiration,envoyee_le)
select id,coalesce(version_preparee,version),acceptation_token_hash,pdf_path,snapshot_devis,date_expiration_token,
       case when version_preparee=version_envoyee then date_envoi else null end
from public.devis
where acceptation_token_hash is not null and pdf_path is not null and snapshot_devis is not null and date_expiration_token is not null
on conflict(token_hash) do nothing;

-- C02 : un administrateur peut fixer un prix, mais ne peut pas déclarer
-- un paiement reçu. Seul le traitement serveur authentifié le peut.
create or replace function public.garde_confirmation_paiement_serveur()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (new.paiement_statut <> 'aucun' or new.paiement_confirme_le is not null) then
      raise exception 'La confirmation de paiement est réservée au serveur.' using errcode='42501';
    end if;
    return new;
  end if;
  if auth.uid() is not null and
     (new.paiement_statut is distinct from old.paiement_statut or
      new.paiement_confirme_le is distinct from old.paiement_confirme_le) then
    raise exception 'La confirmation de paiement est réservée au serveur.' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.garde_confirmation_paiement_serveur() from public;
drop trigger if exists trg_confirmation_paiement_serveur on public.devis;
create trigger trg_confirmation_paiement_serveur before insert or update on public.devis
for each row execute function public.garde_confirmation_paiement_serveur();
commit;
