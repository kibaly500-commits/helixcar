const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const assert = require('node:assert/strict');
(async () => {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated;
 create table convoyeurs(id uuid primary key, note numeric default 10, nb_missions integer default 0, km_total integer default 0);
 create table missions(id uuid primary key, convoyeur_id uuid references convoyeurs, statut text, type_mission text, distance_km integer);
 create table evaluations(id int primary key, mission_id uuid references missions on delete cascade, convoyeur_id uuid references convoyeurs, note_totale integer);
 insert into convoyeurs(id) values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
 insert into missions values ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','terminee','professionnel',999);
 insert into evaluations values(1,'00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',12);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261028134205_statistiques_partenaires_synchronisees.sql','utf8'));
 async function check(note,count,km,id=1) {
 const {rows:[r]}=await db.query(`select note,nb_missions,km_total from convoyeurs where id=$1`,['00000000-0000-0000-0000-00000000000'+id]);
 assert.equal(r.note==null?null:Number(r.note),note);assert.equal(r.nb_missions,count);assert.equal(r.km_total,km);
 }
 await check(12,1,0);await check(null,0,0,2);
 await db.exec(`update convoyeurs set note=20,nb_missions=100,km_total=1000;`);await check(12,1,0);
 await db.exec(`insert into missions values ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001','en_cours','convoyage',150);`);await check(12,1,0);
 await db.exec(`update missions set statut='terminee'; insert into evaluations values(2,'00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000001',16);`);await check(14,2,150);
 await db.exec(`update missions set statut=statut;`);await check(14,2,150);
 await db.exec(`update evaluations set note_totale=0 where id=2;`);await check(6,2,150);
 await db.exec(`update missions set convoyeur_id='00000000-0000-0000-0000-000000000002' where type_mission='convoyage';`);await check(12,1,0);await check(null,1,150,2);
 await db.exec(`update evaluations set convoyeur_id='00000000-0000-0000-0000-000000000002' where id=2;`);await check(0,1,150,2);
 await db.exec(`delete from missions where type_mission='convoyage';`);await check(null,0,0,2);
 await db.exec(`delete from evaluations;`);await check(null,1,0);
 const {rows:[acl]} = await db.query(`select has_function_privilege('authenticated','private.hc_calculer_stats_partenaire()','EXECUTE') as allowed`);assert.equal(acl.allowed,false);
 await db.close();console.log('PASS statistiques : reprise, moyenne, zéro, métiers, répétition, réattribution, suppression et permissions');
})().catch(e=>{console.error(e);process.exitCode=1;});
