-- Checkout test uniquement. Aucun droit client sur les sessions de paiement.
create table public.stripe_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  devis_id uuid not null references public.devis(id),
  version integer not null,
  montant_centimes bigint not null check (montant_centimes > 0),
  email text not null,
  reference text not null,
  origine text not null,
  session_id text unique,
  created_at timestamptz not null default now(),
  unique(devis_id, version)
);
alter table public.stripe_checkout_sessions enable row level security;
revoke all on public.stripe_checkout_sessions from public, anon, authenticated;
grant select, insert, update on public.stripe_checkout_sessions to service_role;

-- Le webhook vérifié appelle cette fonction. La ligne de devis est verrouillée
-- pendant le contrôle de version, de montant et l'enregistrement idempotent.
create function public.confirmer_stripe_checkout_test(
  p_session_id text, p_evenement_id text, p_montant_centimes bigint,
  p_devise text, p_payment_intent text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp
as $$
declare s public.stripe_checkout_sessions%rowtype; d public.devis%rowtype; r jsonb;
begin
  if auth.uid() is not null then raise exception 'Serveur seulement'; end if;
  select * into s from public.stripe_checkout_sessions where session_id = p_session_id;
  if not found then return jsonb_build_object('ok',false,'code','SESSION_INCONNUE'); end if;
  select * into d from public.devis where id = s.devis_id for update;
  if d.statut is distinct from 'accepte' or d.version is distinct from s.version
     or d.version_acceptee is distinct from s.version
     or p_montant_centimes is distinct from s.montant_centimes
     or round(d.prix * 100) is distinct from s.montant_centimes::numeric
     or p_devise is distinct from 'eur'
     or p_payment_intent is null or p_payment_intent not like 'pi_%'
     or p_evenement_id is null or p_evenement_id not like 'evt_%'
  then return jsonb_build_object('ok',false,'code','PAIEMENT_INCOHERENT'); end if;
  r := public.traiter_paiement_confirme(d.id, 'stripe', p_evenement_id,
    p_montant_centimes::numeric / 100, 'EUR',
    jsonb_build_object('livemode',false,'session_id',p_session_id,
      'payment_intent',p_payment_intent,'version',s.version));
  if not coalesce((r->>'ok')::boolean,false) then return r; end if;
  if not exists(select 1 from public.devis where id=d.id and paiement_statut='paye') then
    raise exception 'Paiement non enregistré';
  end if;
  return r;
end $$;
revoke all on function public.confirmer_stripe_checkout_test(text,text,bigint,text,text) from public, anon, authenticated;
grant execute on function public.confirmer_stripe_checkout_test(text,text,bigint,text,text) to service_role;
