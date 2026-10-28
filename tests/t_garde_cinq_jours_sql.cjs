const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
await db.exec(`create schema private;create role anon;create role authenticated;
create table public.vehicules(id uuid,dossier_id uuid,date_prise_en_charge date,date_livraison date,restit_date date,restit_recuperation_client boolean,liv_heure_type text,liv_creneau_fin time,heure_livraison time,restit_destination text);
create table public.preparations_missions(id uuid default gen_random_uuid(),client_id uuid,cle text,plan jsonb,mission_id uuid);
insert into vehicules values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-11-01','2026-11-07','2026-11-17',false,'precise',null,'14:30','adresse');`);
await db.exec(fs.readFileSync('supabase/migrations/20261010211000_garde_cinq_jours.sql','utf8'));
const base={vehicule_id:'11111111-1111-4111-8111-111111111111',kind:'direct',organisation:{version:2},mission:{restitution:true}};
async function insert(p){return db.query("insert into preparations_missions(client_id,cle,plan) values('22222222-2222-4222-8222-222222222222','test',$1) returning id",[JSON.stringify(p)]);}
await assert.rejects(insert(base),/5 jours avant livraison/);
await assert.rejects(insert({...base,organisation:{version:2,before:true}}),/5 jours avant restitution/);
await insert({...base,organisation:{version:2,before:true,return:true}});
await assert.rejects(insert({...base,organisation:{version:2,before:true},retour_helixcar:{transfert:true},retour_reception:'2026-11-07T13:00',retour_remise:'2026-11-16T17:00'}),/suivre la livraison/);
const r=await insert({...base,organisation:{version:2,before:true},retour_helixcar:{transfert:true},retour_reception:'2026-11-07T19:00',retour_remise:'2026-11-16T17:00'});
await db.query("update preparations_missions set mission_id=gen_random_uuid() where id=$1",[r.rows[0].id]);
await insert({...base,organisation:undefined});
console.log('PASS SQL : seuils indépendants, dérogations, chronologie, publication valide, anciens plans préservés');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
