-- Préparation réservée aux dossiers complets ; devis et paiement restent indépendants.
do $migration$
declare def text; marker text; replacement text;
begin
 select pg_get_functiondef('public.source_preparation_missions(uuid)'::regprocedure) into def;
 marker := 'if d is null then raise exception ''Le devis doit être accepté et le paiement confirmé''; end if;';
 replacement := marker || $gate$
 if exists(select 1 from public.informations_demande(p_client_id) where statut not in ('fournie','validee')) then
   raise exception 'Dossier incomplet : renseignez et validez toutes les informations obligatoires avant de préparer les missions. À traiter : %',
     (select string_agg(libelle, ' · ') from public.informations_demande(p_client_id) where statut not in ('fournie','validee'));
 end if;
$gate$;
 if position(marker in def)=0 then raise exception 'Contrôle paiement source introuvable'; end if;
 execute replace(def,marker,replacement);
 -- Conserver le contrat de la vue, sans transmettre de montant de mission au client.
 select pg_get_viewdef('public.v_mes_missions'::regclass,true) into def;
 if position('m.prix_ttc' in def)=0 then raise exception 'Colonne prix client introuvable'; end if;
 execute 'create or replace view public.v_mes_missions as ' || replace(def,'m.prix_ttc','NULL::numeric AS prix_ttc');
end $migration$;
comment on view public.v_mes_missions is 'Suivi des missions du compte connecté uniquement. Aucun montant de rémunération partenaire ; prix_ttc neutralisé pour compatibilité.';
