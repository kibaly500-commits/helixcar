const {PGlite}=require('@electric-sql/pglite');const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();await db.exec(`
create schema auth;create schema private;create schema storage;create role anon;create role authenticated;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function public.partenaire_actif() returns boolean language sql as $$select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid$$;
create function public.est_admin() returns boolean language sql as $$select false$$;
create table convoyeurs(id uuid primary key,auth_user_id uuid);
insert into convoyeurs values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
create table clients(id uuid,auth_user_id uuid);
create table missions(id uuid primary key,convoyeur_id uuid,client_id uuid,devis_source_id uuid,vehicule_source_id uuid,type_mission text,statut text,restitution boolean,date_prise_en_charge timestamp);
create table etats_des_lieux(id uuid primary key default gen_random_uuid(),mission_id uuid,phase text,submission_id uuid unique,vehicule_source_id uuid,km integer,carburant text,etat_general text,observations text,dommages text,signature_url text,photos jsonb,created_at timestamptz default now());
create table storage.objects(bucket_id text,name text);
`);
let migration=fs.readFileSync('supabase/migrations/20261101214321_edl_toutes_missions_atomique.sql','utf8');migration=migration.slice(migration.indexOf('create or replace function private.enregistrer_edl_mission'));
await db.exec(migration);await db.exec(`create trigger garder_edl before insert or update on etats_des_lieux for each row execute function garder_edl_test();create trigger garder_etapes before update on missions for each row execute function garder_etapes_mission_test();
create function fail_transition() returns trigger language plpgsql as $$begin if current_setting('test.fail',true)='1' then raise exception 'panne simulée';end if;return new;end$$;
create trigger z_failure before update on missions for each row execute function fail_transition();
select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);`);
const mid='33333333-3333-4333-8333-333333333333';await db.query(`insert into missions values($1,'22222222-2222-4222-8222-222222222222',null,null,null,'convoyage','acceptee',true,'2026-10-01')`,[mid]);
const slots=['vin','avant','arriere','gauche','droit','avg','avd','arg','ard','pag','pad','prg','prd','tenue','parebrise','hab-av','hab-ar','tableau','coffre'];
async function payload(phase,km){const sid=crypto.randomUUID(),photos={};for(const slot of [...slots,'signature']){const path=mid+'/'+phase+'/'+sid+'/'+slot+'.png';await db.query('insert into storage.objects values($1,$2)',['edl-test',path]);photos[slot]='edl-test/'+path;}const signature=photos.signature;delete photos.signature;return{sid,p:{km,carburant:'plein',etat_general:'bon',signature_url:signature,photos}};}
async function call(phase,p){return (await db.query('select public.enregistrer_edl_test($1,$2,$3,$4) as r',[mid,phase,p.sid,p.p])).rows[0].r;}
let dep=await payload('depart',10000);await db.exec("select set_config('test.fail','1',false)");await assert.rejects(call('depart',dep));assert.equal((await db.query('select count(*)::int as n from etats_des_lieux')).rows[0].n,0);assert.equal((await db.query('select statut from missions')).rows[0].statut,'acceptee');console.log('PASS panne transition : aucun rapport partiel');await db.exec("select set_config('test.fail','0',false)");
assert.equal((await call('depart',dep)).ok,true);assert.equal((await call('depart',dep)).code,'DEJA_ENREGISTRE');assert.equal((await call('depart',await payload('depart',10000))).code,'PHASE_DEJA_VALIDEE');assert.equal((await db.query('select count(*)::int as n from etats_des_lieux')).rows[0].n,1);console.log('PASS départ atomique, reprise idempotente et doublon refusé');
assert.equal((await call('arrivee',await payload('arrivee',9999))).code,'KILOMETRAGE_INCOHERENT');assert.equal((await call('restitution_arrivee',await payload('restitution_arrivee',10000))).code,'ORDRE_INVALIDE');
for(const [phase,km,state] of [['arrivee',10020,'restitution_requise'],['restitution_depart',500,'restitution_en_cours'],['restitution_arrivee',520,'edl_termine']]){assert.equal((await call(phase,await payload(phase,km))).statut,state);console.log('PASS '+phase+' et statut '+state);}
assert.equal((await db.query("select date_prise_en_charge::text as date from missions")).rows[0].date,'2026-10-01 00:00:00');console.log('PASS horaires planifiés conservés, kilométrage propre au véhicule de restitution');
await db.exec("select set_config('test.uid','99999999-9999-4999-8999-999999999999',false)");assert.equal((await call('depart',dep)).code,'NON_AUTORISE');
await assert.rejects(db.query("insert into etats_des_lieux(mission_id,phase) values($1,'depart')",[mid]));console.log('PASS autre compte et insertion directe refusés');await db.close();})().catch(e=>{console.error(e);process.exitCode=1;});
