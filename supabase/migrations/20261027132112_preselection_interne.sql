-- La présélection est interne ; les partenaires voient une candidature envoyée
-- jusqu'à la décision finale. La vue conserve tous ses filtres d'éligibilité.
do $$ declare def text; begin
 select pg_get_viewdef('public.v_opportunites_partenaire'::regclass,true) into def;
 if position('ca.etat AS ma_candidature_etat' in def)=0 then
   raise exception 'Projection de candidature inattendue';
 end if;
 def:=replace(def,'ca.etat AS ma_candidature_etat',
   'CASE WHEN ca.etat = ''preselectionne'' THEN ''a_etudier'' ELSE ca.etat END AS ma_candidature_etat');
 execute 'create or replace view public.v_opportunites_partenaire as '||def;
end $$;
-- Empêcher la lecture de l'état interne en contournant la vue partenaire.
drop policy "candidatures opportunite : lecture par le partenaire" on public.opportunite_candidatures;
create policy "candidatures opportunite : lecture par le partenaire"
on public.opportunite_candidatures for select to authenticated
using (public.est_proprietaire_convoyeur(convoyeur_id) and etat in ('retenu','non_retenu'));
