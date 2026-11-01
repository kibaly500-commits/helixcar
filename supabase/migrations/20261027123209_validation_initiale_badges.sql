begin;
-- Une approbation de candidature vaut approbation de ses métiers initiaux.
-- Ce journal privé évite toute nouvelle approbation automatique à la réactivation.
create table private.professionnel_validation_initiale (
 professionnel_id uuid primary key references public.convoyeurs(id) on delete cascade,
 metiers text[] not null,
 enregistre_le timestamptz not null default now()
);
revoke all on private.professionnel_validation_initiale from public,anon,authenticated;

-- Reprise du lot importé lors de la création des badges : les demandes
-- postérieures et toute décision explicite (y compris un refus) restent intactes.
with lot as (select min(demande_le) date_import from public.professionnel_badges),
 corriges as (
 update public.professionnel_badges b set decision='oui',decide_le=now()
 from public.convoyeurs c,lot
 where c.id=b.professionnel_id and c.statut='actif'
 and c.created_at <= lot.date_import at time zone 'UTC'
 and b.demande_le=lot.date_import and b.decision='en_attente' and b.decide_le is null
 returning b.professionnel_id,b.metier
)
insert into public.convoyeur_decisions_historique(convoyeur_id,activite,ancienne_decision,nouvelle_decision,modifie_par)
select professionnel_id,metier,'en_attente','oui',null from corriges;

insert into private.professionnel_validation_initiale(professionnel_id,metiers)
select c.id,array(select b.metier from public.professionnel_badges b
 where b.professionnel_id=c.id and b.demande_le=(select min(demande_le) from public.professionnel_badges))
from public.convoyeurs c where c.statut='actif';

create or replace function private.valider_badges_candidature_initiale() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Le passage à actif reste soumis aux contrôles existants de la candidature.
 if old.statut is not distinct from 'actif' or new.statut is distinct from 'actif' then return new; end if;
 insert into private.professionnel_validation_initiale(professionnel_id,metiers)
 values(new.id,coalesce(new.metiers,'{}')) on conflict do nothing;
 if not found then return new; end if;
 insert into public.professionnel_badges(professionnel_id,metier)
 select new.id,m from unnest(new.metiers) m on conflict do nothing;
 with corriges as (
  update public.professionnel_badges set decision='oui',decide_le=now(),decide_par=auth.uid()
  where professionnel_id=new.id and metier=any(new.metiers)
  and decision='en_attente' and decide_le is null returning metier
 )
 insert into public.convoyeur_decisions_historique(convoyeur_id,activite,ancienne_decision,nouvelle_decision,modifie_par)
 select new.id,metier,'en_attente','oui',auth.uid() from corriges;
 return new;
end $$;
revoke all on function private.valider_badges_candidature_initiale() from public,anon,authenticated;
create trigger valider_badges_candidature_initiale after update of statut on public.convoyeurs
for each row execute function private.valider_badges_candidature_initiale();
notify pgrst,'reload schema';
commit;
