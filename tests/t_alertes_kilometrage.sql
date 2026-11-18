-- Integration test on a dedicated test mission; the transaction rolls back all fixtures.
begin;
select set_config('hc.validation_edl_test','1',true);
do $$
declare m public.missions%rowtype; n integer; x public.controles_kilometriques%rowtype;
begin
 if private.niveau_ecart_km(1000,1359,300)<>'normal' or private.niveau_ecart_km(1000,1360,300)<>'orange'
 or private.niveau_ecart_km(1000,1399,300)<>'orange' or private.niveau_ecart_km(1000,1400,300)<>'rouge'
 or private.niveau_ecart_km(1000,1380,null)<>'incomplet' or private.niveau_ecart_km(1000,999,300)<>'incoherent' then raise exception 'Threshold regression'; end if;
 select * into strict m from public.missions where reference_courte='HC-2026-0013';
 if exists(select 1 from public.etats_des_lieux where mission_id=m.id) then raise exception 'Test fixture already used'; end if;
 update public.missions set distance_km=300 where id=m.id;
 update public.preparations_missions set plan=jsonb_set(plan,'{distance_restitution}','150'::jsonb) where id=m.preparation_id;
 insert into public.etats_des_lieux(mission_id,vehicule_source_id,phase,km) values(m.id,m.vehicule_source_id,'depart',1000);
 if exists(select 1 from public.controles_kilometriques where mission_id=m.id) then raise exception 'Alert before arrival'; end if;
 insert into public.etats_des_lieux(mission_id,vehicule_source_id,phase,km) values(m.id,m.vehicule_source_id,'arrivee',1380);
 select * into strict x from public.controles_kilometriques where mission_id=m.id and phase='arrivee';
 if x.niveau<>'orange' or x.distance_reelle<>380 or x.ecart<>80 then raise exception 'Outbound comparison'; end if;
 insert into public.etats_des_lieux(mission_id,vehicule_source_id,phase,km) values(m.id,m.vehicule_source_id,'restitution_depart',50000),(m.id,m.vehicule_source_id,'restitution_arrivee',50250);
 select * into strict x from public.controles_kilometriques where mission_id=m.id and phase='restitution_arrivee';
 if x.niveau<>'rouge' or x.distance_reelle<>250 or x.ecart<>100 or x.distance_prevue<>150 then raise exception 'Return paired with wrong vehicle or distance'; end if;
 update public.missions set distance_km=999 where id=m.id;
 if (select distance_prevue from public.controles_kilometriques where mission_id=m.id and phase='arrivee')<>300 then raise exception 'Snapshot changed'; end if;
 select count(*) into n from public.controles_kilometriques where mission_id=m.id;
 if n<>2 then raise exception 'Duplicate check'; end if;
end $$;
select 'PASS thresholds, arrival trigger, separate return, stable snapshot' as result;
rollback;
