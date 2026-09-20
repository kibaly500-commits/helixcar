// Recette isolée PostgreSQL/WASM. Métadonnées de schéma uniquement, aucun client réel.
const fs=require('fs'),assert=require('assert');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const planner=require('../../assets/preparation-missions.js');
(async()=>{
 const db=new PGlite();const fixture=JSON.parse(fs.readFileSync(process.env.HC_SCHEMA_FIXTURE||require('path').join(__dirname,'schema.json'),'utf8'));
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role',current_user)$$;
 create function auth.email() returns text language sql stable as $$select 'qa@example.test'::text$$;
 grant usage on schema public,auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`);
 for(const t of fixture.tables){for(const c of t.columns){const seq=c.default?.match(/nextval\('([^']+)'/);if(seq)await db.exec('create sequence if not exists '+seq[1]);}
 await db.exec('create table public.'+t.name+'('+t.columns.map(c=> '"'+c.name+'" '+c.type+(c.default?' default '+c.default:'')+(c.notnull?' not null':'')).join(',')+',primary key(id))');}
 await db.exec(`alter table missions add constraint missions_type_mission_check check(type_mission in ('convoyage','nettoyage'));
 alter table opportunites add unique(mission_id);alter table opportunite_candidatures add unique(opportunite_id,convoyeur_id);
 create unique index missions_devis_vehicule_unique on missions(devis_source_id,vehicule_source_id) where devis_source_id is not null;
 create unique index missions_nettoyage_une_par_demande on missions(client_id) where type_mission='nettoyage' and statut<>'annulee';
 create table test_infos(client_id uuid,statut text);
 create function informations_demande(p_client_id uuid) returns table(statut text) language sql as $$select statut from test_infos where client_id=p_client_id$$;`);
 for(const f of fixture.functions)await db.exec(f.sql);
 for(const v of fixture.views)await db.exec('create view '+v.name+' as '+v.sql);
 await db.exec(`create trigger trg_brouillon_opportunite_apres_mission after insert on missions for each row execute function brouillon_opportunite_apres_mission();
 create trigger garde_execution_paiement before insert or update on missions for each row execute function garder_publication_paiement();
 create trigger garde_publication_paiement before insert or update on opportunites for each row execute function garder_publication_paiement();
 create trigger verrou_opp before update on opportunites for each row execute function verrou_opportunite();
 create trigger synchroniser_brouillon_vehicule_test after update on vehicules for each row execute function synchroniser_brouillon_vehicule_test();`);
 const migration=fs.readdirSync('supabase/migrations').find(x=>x.endsWith('_preparation_missions_devis.sql'));
 await db.exec(fs.readFileSync('supabase/migrations/'+migration,'utf8'));
 const admin='11111111-1111-1111-1111-111111111111',cid='22222222-2222-2222-2222-222222222222',did='33333333-3333-3333-3333-333333333333',vid='44444444-4444-4444-4444-444444444444';
 await db.exec(`insert into admins(id,auth_user_id,email,actif) values(gen_random_uuid(),'${admin}','qa@example.test',true);
 insert into clients(id,numero_client,code_parrainage,nom,prenom,email,type_client,societe,type_service,stockage_acheminement,stockage_sortie,stockage_date_debut,stockage_date_fin) values('${cid}','HC-QA-PREP','QA-PREP','SECRETNOM','SECRETPRENOM','secret@example.test','professionnel','SECRETENTREPRISE','stockage','helixcar','helixcar','2026-11-08','2026-11-13');
 insert into devis(id,client_id,reference,prix,statut,paiement_statut) values('${did}','${cid}','DEV-QA',500,'accepte','paye');
 insert into vehicules(id,dossier_id,position,type_vehicule,marque_modele,immatriculation,vin,ville_depart,ville_arrivee,date_prise_en_charge,date_livraison,heure_prise_en_charge,heure_livraison,adresse_depart_rue,adresse_arrivee_rue) values('${vid}','${cid}',1,'berline','Peugeot 308','AB-123-CD','VF123456789012345','Paris','Lyon','2026-11-08','2026-11-13','09:00','16:00','12 rue Secrète','13 rue Privée');
 select set_config('request.jwt.claim.sub','${admin}',false);`);
 const rpc=async(name,args)=>{return (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as r',args)).rows[0].r;};
 let count=0;const check=(name,value)=>{assert(value,name);count++;console.log('PASS '+name);};
 const rejected=async(name,fn)=>{let e=false;try{await fn()}catch(x){e=true;}check(name,e);};
 let src=await rpc('source_preparation_missions',[cid]);let plans=planner.build(src.client,src.vehicules);check('stockage : deux trajets',plans.length===2);
 plans.forEach(p=>{p.remuneration=90;p.distance=25;p.motorisation='Hybride';p.heure_remise='10:00';p.heure_retrait='09:00';if(p.kind==='avant_stockage')p.mission.date_livraison=planner.stamp(p.date_fin,'10:00');else p.mission.date_prise_en_charge=planner.stamp(p.date_debut,'09:00');p.public=planner.publicData(p);});
 src=await rpc('enregistrer_preparation_missions',[cid,src.empreinte,JSON.stringify(plans)]);check('sauvegarde de deux brouillons privés',src.brouillons.length===2);
 check('aucune mission créée à la sauvegarde',(await db.query('select count(*)::int as n from missions')).rows[0].n===0);
 let src2=await rpc('enregistrer_preparation_missions',[cid,src.empreinte,JSON.stringify(plans)]);check('rejeu sans doublon',src2.brouillons.map(x=>x.id).sort().join()===src.brouillons.map(x=>x.id).sort().join());
 const first=src.brouillons.find(x=>x.plan.kind==='avant_stockage');
 await db.exec(`insert into test_infos values('${cid}','attendue')`);await rejected('publication bloquée : informations manquantes',()=>rpc('publier_preparation_mission',[first.id]));await db.exec('delete from test_infos');
 await db.exec(`update clients set notes='Modifié' where id='${cid}'`);await rejected('source périmée refusée',()=>rpc('publier_preparation_mission',[first.id]));await db.exec(`update clients set notes=null where id='${cid}'`);
 const pub=await rpc('publier_preparation_mission',[first.id]);check('publication explicite',pub.ok);
 const again=await rpc('publier_preparation_mission',[first.id]);check('publication idempotente',again.code==='DEJA_PUBLIEE');
 const second=src.brouillons.find(x=>x.plan.kind==='apres_stockage');await rpc('publier_preparation_mission',[second.id]);
 const ms=(await db.query('select * from missions order by date_prise_en_charge')).rows;check('deux missions distinctes',ms.length===2);check('point HelixCar au bon bout',ms[0].ville_arrivee==='Noisy-le-Grand'&&ms[1].ville_depart==='Noisy-le-Grand');
 const annonces=(await db.query('select annonce from preparations_missions')).rows;check('projection sans coordonnées ni identifiants',!JSON.stringify(annonces).match(/SECRET|AB-123-CD|VF123456789012345|rue|@/));
 // Deux autres services : même sauvegarde puis création explicite.
 for(const [service,detail] of [['nettoyage',{type_nettoyage:'interieur',nombre_vehicules_approx:4,adresse_rue:'12 rue Privée',adresse_ville:'Créteil',adresse_cp:'94000',date_souhaitee:'2026-11-08',date_fin:'2026-11-08',creneau_debut:'09:00',creneau_fin:'12:00'}],['professionnel',{categorie:'technicien',specialite:'diagnostic',nombre_professionnels:2,adresse_ville:'Nanterre',adresse_rue:'10 rue Privée',date_debut:'2026-11-08',date_fin:'2026-11-09',heure_debut:'09:00',heure_fin:'17:00',description:'Diagnostic du véhicule SECRETNOM secret@example.test AB-123-CD'}]]){
  const id=(await db.query('select gen_random_uuid() as id')).rows[0].id;
  await db.query('insert into clients(id,numero_client,code_parrainage,nom,prenom,email,type_client,societe,type_service,nettoyage_details,professionnel_details) values($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,'QA-'+service,'SECRETNOM','SECRETPRENOM','secret@example.test','professionnel','Société QA',service,service==='nettoyage'?JSON.stringify(detail):null,service==='professionnel'?JSON.stringify(detail):null]);
  await db.query("insert into devis(id,client_id,reference,prix,statut,paiement_statut) values(gen_random_uuid(),$1,$2,500,'accepte','paye')",[id,'DEV-'+service]);
  const so=await rpc('source_preparation_missions',[id]);const list=planner.build(so.client,so.vehicules);list[0].remuneration=180;list[0].public=planner.publicData(list[0]);
  let save=await rpc('enregistrer_preparation_missions',[id,so.empreinte,JSON.stringify(list)]);
  check(service+' : aperçu nettoyé côté serveur',!JSON.stringify(save.brouillons[0].annonce).match(/SECRETNOM|secret@example|AB-123-CD/));
  const published=await rpc('publier_preparation_mission',[save.brouillons[0].id]);
  const mission=(await db.query('select * from missions where id=$1',[published.mission_id])).rows[0];
  check(service+' : mission sur site correcte',mission.type_mission===service&&mission.ville_intervention===detail.adresse_ville&&mission.ville_depart==='');
  check(service+' : métier filtré correctement',(await db.query('select categorie from opportunites where id=$1',[published.opportunite_id])).rows[0].categorie===(service==='professionnel'?'technicien':'nettoyage'));
 }
 const cv='66666666-6666-6666-6666-666666666666',uid='77777777-7777-7777-7777-777777777777';
 await db.exec(`insert into convoyeurs(id,prenom,nom,email,auth_user_id,bloque) values('${cv}','QA','PARTENAIRE','qa-partner@example.test','${uid}',false);insert into convoyeur_decisions(convoyeur_id,activite,decision) values('${cv}','convoyage','oui');
 alter table missions enable row level security;grant select on missions,opportunites,opportunite_candidatures,convoyeurs,v_opportunites_partenaire to authenticated;
 create policy test_base_missions on missions for select to authenticated using (public.est_admin() or public.partenaire_actif());
 select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`);
 check('partenaire : aucune adresse de mission avant attribution',(await db.query('select * from missions')).rows.length===0);
 const visible=(await db.query('select * from v_opportunites_partenaire')).rows;
 check('partenaire : seulement le métier validé',visible.length===2&&visible.every(o=>o.categorie==='convoyage'));
 check('vue publique sans adresse, plaque ou VIN',!JSON.stringify(visible).match(/12 rue|AB-123-CD|VF123456789012345/));
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${admin}',false);`);
 const candidature=(await db.query("insert into opportunite_candidatures(opportunite_id,convoyeur_id,etat) values($1,$2,'a_etudier') returning id",[pub.opportunite_id,cv])).rows[0].id;
 await rpc('decider_candidature',[candidature,'retenu']);
 await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`);
 const assigned=(await db.query('select * from missions')).rows;check('seule la mission retenue devient accessible',assigned.length===1&&assigned[0].id===pub.mission_id);
 check('fiche détaillée liée à la mission retenue',(await db.query('select mission_id from v_opportunites_partenaire where id=$1',[pub.opportunite_id])).rows[0].mission_id===pub.mission_id);
 await db.exec('reset role');const remise=await rpc('point_remise_mission',[pub.mission_id]);check('point de remise limité au bon trajet',remise.arriveeAvantStockage&&!remise.departApresStockage);

 await db.exec(`select set_config('request.jwt.claim.sub','${admin}',false);`);
 await rpc('decider_candidature',[candidature,'non_retenu']);
 await db.exec(`select set_config('request.jwt.claim.sub','${uid}',false);set role authenticated;`);
 check('annulation : les coordonnées redeviennent inaccessibles',(await db.query('select * from missions')).rows.length===0);
 check('annulation : le point de remise devient inaccessible',await rpc('point_remise_mission',[pub.mission_id])===null);
 await db.exec('reset role');

 await db.exec("select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false)");await rejected('RPC refusée au non-admin',()=>rpc('source_preparation_missions',[cid]));
 await db.exec('set role authenticated');check('table de préparation invisible au non-admin',(await db.query('select * from preparations_missions')).rows.length===0);await db.exec('reset role');
 console.log('TOTAL '+count+' vérifications SQL');await db.close();
})().catch(e=>{console.error(e.message,e.detail||'',e.where||'');process.exitCode=1;});
