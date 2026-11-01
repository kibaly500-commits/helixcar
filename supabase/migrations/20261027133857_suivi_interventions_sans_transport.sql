-- Les exigences EDL du convoyage restent identiques. Les prestations sur place
-- suivent leur propre progression, sans document de transport.
do $$ declare def text; begin
 select pg_get_functiondef('public.garder_etapes_mission_test()'::regprocedure) into def;
 if position('if new.devis_source_id is null' in def)=0 then raise exception 'Garde EDL inattendue'; end if;
 def:=replace(def,'if new.devis_source_id is null',
   'if new.type_mission in (''nettoyage'',''professionnel'') then return new; end if; if new.devis_source_id is null');
 execute def;
end $$;

create function private.garder_suivi_intervention() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.type_mission not in ('nettoyage','professionnel') or auth.uid() is null then return new; end if;
 if new.statut in ('restitution_requise','restitution_en_cours','edl_termine') and new.statut is distinct from old.statut then
   raise exception 'Une intervention ne suit pas les étapes de transport.' using errcode='23514';
 end if;
 if not public.est_admin() then
   if new.lettre_voiture_signee_url is distinct from old.lettre_voiture_signee_url
      or new.lettre_voiture_signee_date is distinct from old.lettre_voiture_signee_date then
     raise exception 'La lettre de voiture concerne uniquement le convoyage.' using errcode='42501';
   end if;
   if new.statut is distinct from old.statut and not (
     (old.statut='acceptee' and new.statut='en_cours')
     or (old.statut='en_cours' and new.statut='fini')
   ) then
     raise exception 'Transition d’intervention non autorisée ; la confirmation finale appartient à HelixCar.' using errcode='42501';
   end if;
 end if;
 return new;
end $$;
revoke all on function private.garder_suivi_intervention() from public,anon,authenticated;
create trigger garde_suivi_intervention before update on public.missions
for each row execute function private.garder_suivi_intervention();

-- Retirer uniquement les deux obligations photographiques du nettoyage.
-- Les contrôles d’identité, de colonnes, d’attribution et de statut restent actifs.
do $$ declare def text; cleaned text; begin
 select pg_get_functiondef('public.verrou_maj_mission()'::regprocedure) into def;
 cleaned := regexp_replace(def,
   '  if new.type_mission = ''nettoyage''[^;]+mission_photos_completes\(new.id\) then[^;]+;[[:space:]]+end if;',
   '', 'g');
 if cleaned = def or position('mission_photos_completes' in cleaned)>0 then
   raise exception 'Gardes photographiques inattendues';
 end if;
 execute cleaned;
end $$;
