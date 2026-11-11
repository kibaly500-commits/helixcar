const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();try{
 await db.exec(`create schema auth;create function auth.uid() returns text language sql as $$select current_setting('test.uid',true)$$;
 create table clients(id int primary key,auth_user_id text);create table preparations_missions(id int primary key,plan jsonb);create table missions(id int primary key,client_id int,preparation_id int,date_prise_en_charge timestamp,date_livraison timestamp);
 create view v_mes_missions as select m.id,m.date_prise_en_charge,m.date_livraison from missions m join clients c on c.id=m.client_id where c.auth_user_id=auth.uid();
 insert into clients values(1,'client-a'),(2,'client-b');insert into preparations_missions values(1,'{"kind":"apres_stockage","retrait_veille":true}'),(2,'{"kind":"apres_stockage"}'),(3,'{"kind":"direct"}');
 insert into missions values(1,1,1,'2026-11-21 17:00','2026-11-22 11:00'),(2,1,2,'2026-11-22 09:00','2026-11-22 11:00'),(3,1,3,'2026-11-20 09:00','2026-11-22 11:00'),(4,2,1,'2026-11-21 17:00','2026-11-22 11:00');set test.uid='client-a';`);
 const migration=fs.readFileSync('supabase/migrations/20261010193552_organisation_interne_retrait_veille.sql','utf8');await db.exec(migration);await db.exec(migration);
 const {rows}=await db.query("select id,to_char(date_prise_en_charge,'YYYY-MM-DD HH24:MI') as date from v_mes_missions order by id");assert.deepEqual(rows,[{id:1,date:'2026-11-22 11:00'},{id:2,date:'2026-11-22 09:00'},{id:3,date:'2026-11-20 09:00'}]);
 const raw=await db.query("select to_char(date_prise_en_charge,'YYYY-MM-DD HH24:MI') as date from missions where id=1");assert.equal(raw.rows[0].date,'2026-11-21 17:00');
 console.log('PASS : date client conservée, horaire interne distinct, anciennes missions intactes, autre client exclu, migration rejouable');
 }finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
