-- Vérification transactionnelle : aucune donnée de recette conservée.
begin;
do $$ declare aid uuid; p public.preparations_missions; src jsonb; newid uuid:=gen_random_uuid(); begin
 select auth_user_id into aid from public.admins where actif is true and auth_user_id is not null limit 1;
 if aid is null then raise exception 'Administrateur de recette indisponible'; end if;
 perform set_config('request.jwt.claim.sub',aid::text,true);
 for p in select * from public.preparations_missions loop
  begin src:=public.source_preparation_missions(p.client_id);exit;exception when raise_exception then src:=null;end;
 end loop;
 if src is null then raise exception 'Préparation complète de référence indisponible'; end if;
 insert into public.preparations_missions(id,client_id,devis_id,cle,empreinte,plan,annonce)
 values(newid,p.client_id,p.devis_id,'QA-PLANNING-ROLLBACK-'||newid,src->>'empreinte','{"kind":"avant_stockage","mission":{"date_livraison":"2026-11-08T10:45"}}','{}');
 perform set_config('hc.test_planning',newid::text,true);
end $$;
set local role authenticated;
do $$ declare r jsonb; id uuid:=current_setting('hc.test_planning')::uuid; begin
 r:=public.action_planning_helixcar(id,'confirmer',0);
 if r->>'horaire_confirme' not like '2026-11-08T10:45%' then raise exception 'Horaire incorrect'; end if;
 begin perform public.action_planning_helixcar(id,'cles',0);raise exception 'Concurrence non détectée';
 exception when raise_exception then if sqlerrm not like 'Le planning a changé%' then raise; end if;end;
 r:=public.action_planning_helixcar(id,'cles',1);
 if r->>'cles_effectuees_le' is null or r->>'cles_effectuees_par' is null then raise exception 'Clés non enregistrées'; end if;
 if (select count(*) from public.planning_helixcar where preparation_id=id)<>1 then raise exception 'Lecture admin refusée';end if;
end $$;
reset role;
do $$ begin perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);end $$;
set local role authenticated;
do $$ declare n integer; begin
 select count(*) into n from public.planning_helixcar;if n<>0 then raise exception 'Fuite vers un compte non admin';end if;
 begin insert into public.planning_helixcar(preparation_id) values(current_setting('hc.test_planning')::uuid);raise exception 'Écriture non admin autorisée';exception when insufficient_privilege then null;end;
 update public.planning_helixcar set horaire_confirme=now();get diagnostics n=row_count;if n<>0 then raise exception 'Modification non admin autorisée';end if;
 begin perform public.action_planning_helixcar(current_setting('hc.test_planning')::uuid,'confirmer',0);raise exception 'RPC non admin autorisée';exception when raise_exception then if sqlerrm<>'Accès réservé à HelixCar' then raise;end if;end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform * from public.planning_helixcar;raise exception 'Lecture anonyme autorisée';exception when insufficient_privilege then null;end;
 begin perform public.action_planning_helixcar(current_setting('hc.test_planning')::uuid,'confirmer',0);raise exception 'RPC anonyme autorisée';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS : confirmation, clés, concurrence, accès admin et refus client/anonyme ; transaction annulée' as resultat;
