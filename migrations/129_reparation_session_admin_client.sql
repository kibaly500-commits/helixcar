-- ============================================================
-- HelixCar — 129 : réparer un dossier capturé par une session admin
-- ============================================================
-- La Preview publique et le Dashboard admin partagent la même origine
-- et donc la même session Supabase. Avant le correctif applicatif, une
-- inscription avec confirmation pouvait laisser cette ancienne session
-- active au moment du dépôt : la demande était alors rattachée à l'admin
-- au lieu du nouveau compte.
--
-- Cette migration permet uniquement au propriétaire de l'adresse e-mail
-- confirmée de récupérer ce dossier, et uniquement si son propriétaire
-- actuel est un administrateur actif. Tous les autres transferts restent
-- refusés. Idempotente.
create or replace function public.reclamer_demande(
  p_client_id uuid,
  p_cle       text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_confirme timestamptz;
  v_ligne    public.clients%rowtype;
  v_hash     text;
  v_depuis_admin boolean := false;
begin
  -- 1. Une session, sinon rien.
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'SESSION_REQUISE');
  end if;

  select u.email, u.email_confirmed_at
    into v_email, v_confirme
    from auth.users u where u.id = v_uid;

  -- 2. Une adresse RÉELLEMENT confirmée. Un compte créé et jamais
  --    confirmé ne réclame rien : ce serait rouvrir la porte que la
  --    confirmation est censée fermer.
  if v_confirme is null then
    return jsonb_build_object('ok', false, 'code', 'ADRESSE_NON_CONFIRMEE');
  end if;

  -- 5. Le secret, avant même de regarder la ligne.
  if p_cle is null or length(p_cle) < 32 then
    return jsonb_build_object('ok', false, 'code', 'CLE_INVALIDE');
  end if;
  -- Empreinte préfixée par son usage : ce calcul ne peut pas produire
  -- une valeur acceptée par la vérification de creation_cle_hash.
  v_hash := public.empreinte_secret('reclamation', p_cle);

  -- 4. L'identifiant exact.
  select * into v_ligne from public.clients c where c.id = p_client_id;
  if not found then
    -- Même réponse que pour un refus : ne pas révéler ce qui existe.
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
  end if;

  -- Demande déjà rattachée. Si c'est à MOI, l'appel est idempotent.
  -- Le seul transfert admis répare la régression de la Preview : une
  -- session administrateur restée ouverte a reçu le dossier avant la
  -- confirmation du nouveau compte. Aucun autre propriétaire ne peut
  -- jamais être remplacé.
  if v_ligne.auth_user_id is not null then
    if v_ligne.auth_user_id = v_uid then
      return jsonb_build_object('ok', true, 'code', 'DEJA_RATTACHEE',
                                'id', v_ligne.id);
    end if;
    v_depuis_admin := exists (
      select 1 from public.admins a
       where a.auth_user_id = v_ligne.auth_user_id
         and a.actif is true
    );
    if not v_depuis_admin then
      return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
    end if;
  end if;

  -- Une demande réellement anonyme garde les protections historiques :
  -- empreinte exacte et délai d'expiration. Le cas réparé ci-dessus ne
  -- possédait justement aucune empreinte, puisque l'ancienne session
  -- admin avait empêché le serveur d'armer la réclamation.
  if not v_depuis_admin then
    if v_ligne.reclamation_cle_hash is null
       or v_ligne.reclamation_cle_hash <> v_hash then
      return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
    end if;
    if v_ligne.reclamation_expire_le is null
       or v_ligne.reclamation_expire_le <= now() then
      return jsonb_build_object('ok', false, 'code', 'RECLAMATION_EXPIREE');
    end if;
  end if;

  -- 3. L'adresse vérifiée du compte est celle de la demande. C'est une
  --    CONDITION supplémentaire, pas une preuve : sans le secret, elle
  --    ne donne aucun droit.
  if v_email is null or v_ligne.email is null
     or lower(btrim(v_email)) <> lower(btrim(v_ligne.email)) then
    return jsonb_build_object('ok', false, 'code', 'RECLAMATION_REFUSEE');
  end if;

  -- Tout est réuni : on rattache, et on CONSOMME les secrets.
  --
  -- creation_cle_hash part avec le reste. Elle ne servait qu'à prouver
  -- un rejeu de création avant qu'un compte ne soit connu ; la demande a
  -- maintenant un propriétaire, qui prouve son droit par sa session
  -- (branche « v_uid is not null and auth_user_id = v_uid » de la
  -- migration 92). La garder n'apporterait rien et laisserait traîner
  -- une preuve utilisable sans session.
  update public.clients c
     set auth_user_id          = v_uid,
         reclamation_cle_hash  = null,
         reclamation_expire_le = null,
         creation_cle_hash     = null
   where c.id = p_client_id
     and (c.auth_user_id is null
          or (v_depuis_admin and c.auth_user_id = v_ligne.auth_user_id));

  return jsonb_build_object('ok', true, 'code', 'RATTACHEE', 'id', p_client_id);
end $$;

comment on function public.reclamer_demande(uuid, text) is
  'Rattache une demande anonyme avec preuve, ou répare exclusivement un '
  'dossier capturé par une session administrateur active au profit du '
  'compte portant la même adresse confirmée. Aucun autre transfert.';

revoke all on function public.reclamer_demande(uuid, text) from public;
grant execute on function public.reclamer_demande(uuid, text) to authenticated;
