-- Lecture toujours limitée aux administrateurs par la RLS existante.
grant select on public.recontacts to authenticated;

-- Un devis refusé ne permet plus d'envoyer des informations.
do $$ declare def text; marker text := ' if jsonb_typeof(p_reponses)'; begin
 select pg_get_functiondef('public.repondre_informations_demande(uuid,jsonb)'::regprocedure) into def;
 if position(marker in def)=0 then raise exception 'Contrat réponse inattendu'; end if;
 def:=replace(def,marker,$guard$
 if (select d.statut from public.devis d where d.client_id=p_client_id order by d.date_generation desc,d.id desc limit 1)='refuse' then
 raise exception 'Ce devis a été refusé. Les informations ne sont plus modifiables.' using errcode='42501';end if;
$guard$||marker);
 execute def;
end $$;

-- Classement calculé à partir des missions terminées et validées par HelixCar.
-- Pas de coordonnées personnelles ni de montants de missions dans ce résultat.
create function private.challenge_partenaire(p_trimestre date default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare debut date; fin date; propre uuid; classement jsonb; begin
 if auth.uid() is null then raise exception 'Connexion requise' using errcode='42501';end if;
 propre:=public.convoyeur_de_session();
 if not public.est_admin() and (propre is null or not public.partenaire_actif()) then raise exception 'Accès réservé aux partenaires actifs' using errcode='42501';end if;
 debut:=date_trunc('quarter',coalesce(p_trimestre,(now() at time zone 'Europe/Paris')::date))::date;
 fin:=(debut+interval '3 months')::date;
 with scores as (
 select c.id,c.numero_partenaire,count(distinct m.id)::int missions,max(m.date_validation_paiement) dernier
 from public.convoyeurs c join public.missions m on m.convoyeur_id=c.id
 where m.statut='terminee' and (m.date_validation_paiement at time zone 'Europe/Paris')::date>=debut
 and (m.date_validation_paiement at time zone 'Europe/Paris')::date<fin
 group by c.id,c.numero_partenaire), rangs as (
 select *,row_number() over(order by missions desc,dernier asc,id asc)::int rang from scores)
 select coalesce(jsonb_agg(jsonb_build_object('numero',numero_partenaire,'missions',missions,'rang',rang,'moi',id=propre,
 'recompense',case rang when 1 then 150 when 2 then 100 when 3 then 50 else 0 end) order by rang),'[]'::jsonb)
 into classement from rangs where rang<=3 or id=propre or public.est_admin();
 return jsonb_build_object('debut',debut,'fin',fin,'termine',fin<=(now() at time zone 'Europe/Paris')::date,'classement',classement);
end $$;
revoke all on function private.challenge_partenaire(date) from public,anon;
grant execute on function private.challenge_partenaire(date) to authenticated;
create function public.challenge_partenaire(p_trimestre date default null) returns jsonb language sql security invoker set search_path='' as $$select private.challenge_partenaire(p_trimestre)$$;
revoke all on function public.challenge_partenaire(date) from public,anon;
grant execute on function public.challenge_partenaire(date) to authenticated;

create table public.preferences_compte(
 auth_user_id uuid primary key references auth.users(id),
 theme text not null default 'systeme' check(theme in ('clair','sombre','systeme')),
 nouveautes_lues jsonb not null default '{}'::jsonb check(jsonb_typeof(nouveautes_lues)='object')
);
alter table public.preferences_compte enable row level security;
revoke all on public.preferences_compte from anon,authenticated;
grant select,insert,update on public.preferences_compte to authenticated;
create policy preferences_propres on public.preferences_compte to authenticated
 using(auth_user_id=(select auth.uid())) with check(auth_user_id=(select auth.uid()));
-- Le formulaire de modification individuel suit le même verrou que la soumission groupée.
do $$ declare def text; begin
 select pg_get_functiondef('public.modifier_information_demande(uuid,text,text)'::regprocedure) into def;
 def:=regexp_replace(def,'\mbegin\M',$guard$begin
 if not public.est_admin() and (select d.statut from public.devis d where d.client_id=p_client_id order by d.date_generation desc,d.id desc limit 1)='refuse' then
 raise exception 'Ce devis a été refusé. Les informations ne sont plus modifiables.' using errcode='42501';end if;
$guard$,'i');execute def;
end $$;

-- Portrait privé, obligatoire avant une candidature à une mission.
alter table public.convoyeurs add column photo_profil_chemin text;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portraits-partenaires','portraits-partenaires',false,5242880,array['image/jpeg','image/png']);
create policy portrait_lecture on storage.objects for select to authenticated using(bucket_id='portraits-partenaires' and ((select public.est_admin()) or (storage.foldername(name))[1]=(select auth.uid())::text));
create policy portrait_depot on storage.objects for insert to authenticated with check(bucket_id='portraits-partenaires' and (storage.foldername(name))[1]=(select auth.uid())::text and lower(storage.extension(name)) in ('jpg','jpeg','png') and exists(select 1 from public.convoyeurs c where c.auth_user_id=(select auth.uid())));
create function private.enregistrer_portrait(p_chemin text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or split_part(p_chemin,'/',1)<>auth.uid()::text or not exists(select 1 from storage.objects where bucket_id='portraits-partenaires' and name=p_chemin) then raise exception 'Photo invalide' using errcode='42501';end if;
 update public.convoyeurs set photo_profil_chemin=p_chemin where auth_user_id=auth.uid();
 if not found then raise exception 'Profil introuvable';end if;
end $$;
revoke all on function private.enregistrer_portrait(text) from public,anon;
grant execute on function private.enregistrer_portrait(text) to authenticated;
create function public.enregistrer_portrait(p_chemin text) returns void language sql security invoker set search_path='' as $$select private.enregistrer_portrait(p_chemin)$$;
revoke all on function public.enregistrer_portrait(text) from public,anon;
grant execute on function public.enregistrer_portrait(text) to authenticated;
create function private.exiger_portrait_candidature() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.convoyeurs c join storage.objects s on s.bucket_id='portraits-partenaires' and s.name=c.photo_profil_chemin where c.id=new.convoyeur_id and split_part(c.photo_profil_chemin,'/',1)=c.auth_user_id::text) then
 raise exception 'Ajoutez votre photo de profil professionnelle dans Mon profil avant de postuler.' using errcode='23514';end if;
 return new;
end $$;
revoke all on function private.exiger_portrait_candidature() from public,anon,authenticated;
create trigger exiger_portrait_candidature before insert on public.opportunite_candidatures for each row execute function private.exiger_portrait_candidature();

-- Suppression de l'accès au compte, avec suivi de la fermeture Auth.
create table public.suppressions_comptes(
 auth_user_id uuid primary key references auth.users(id),motif text not null check(length(motif) between 1 and 1000),
 demandee_le timestamptz not null default now(),auth_supprime_le timestamptz
);
alter table public.suppressions_comptes enable row level security;
revoke all on public.suppressions_comptes from public,anon,authenticated;
grant select on public.suppressions_comptes to authenticated;
create policy suppression_admin on public.suppressions_comptes for select to authenticated using((select public.est_admin()));
create function public.preparer_suppression_compte(p_uid uuid,p_motif text) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.admins where auth_user_id=p_uid) then raise exception 'Suppression administrateur interdite';end if;
 if not exists(select 1 from auth.users where id=p_uid) then raise exception 'Compte introuvable';end if;
 insert into public.suppressions_comptes(auth_user_id,motif) values(p_uid,btrim(p_motif)) on conflict(auth_user_id) do nothing;
 -- Détacher les dossiers historiques pour qu'une réinscription ne puisse pas les récupérer.
 update public.clients set auth_user_id=null,email='supprime-'||id::text||'@compte.invalid' where auth_user_id=p_uid;
 update public.convoyeurs set auth_user_id=null,email='supprime-'||id::text||'@compte.invalid',bloque=true,bloque_motif='Compte supprimé à la demande du partenaire' where auth_user_id=p_uid;
 delete from public.preferences_compte where auth_user_id=p_uid;
end $$;
revoke all on function public.preparer_suppression_compte(uuid,text) from public,anon,authenticated;
grant execute on function public.preparer_suppression_compte(uuid,text) to service_role;
grant all on public.suppressions_comptes to service_role;
-- Révocation immédiate des lectures personnelles encore liées à l'ancien UUID.
create function private.compte_ouvert() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.suppressions_comptes where auth_user_id=auth.uid())
$$;
revoke all on function private.compte_ouvert() from public,anon;
grant execute on function private.compte_ouvert() to authenticated;
create policy recompenses_compte_ouvert on public.fidelite_recompenses as restrictive for all to authenticated using((select private.compte_ouvert())) with check((select private.compte_ouvert()));
create policy points_compte_ouvert on public.fidelite_mouvements as restrictive for all to authenticated using((select private.compte_ouvert())) with check((select private.compte_ouvert()));
create policy numero_compte_ouvert on public.comptes_clients as restrictive for all to authenticated using((select private.compte_ouvert())) with check((select private.compte_ouvert()));
create function private.controler_portrait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.photo_profil_chemin is not null and (new.auth_user_id is null or split_part(new.photo_profil_chemin,'/',1)<>new.auth_user_id::text or not exists(select 1 from storage.objects where bucket_id='portraits-partenaires' and name=new.photo_profil_chemin)) then raise exception 'Photo de profil non autorisée';end if;
 return new;
end $$;
revoke all on function private.controler_portrait() from public,anon,authenticated;
create trigger controler_portrait before insert or update of photo_profil_chemin on public.convoyeurs for each row execute function private.controler_portrait();
create policy stockage_compte_ouvert on storage.objects as restrictive for all to authenticated using((select private.compte_ouvert())) with check((select private.compte_ouvert()));
