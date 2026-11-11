const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create table convoyeurs(id integer primary key,created_at timestamp,nom text);
 insert into convoyeurs values(2,'2026-02-01','B'),(1,'2026-01-01','A');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261028135708_numeros_partenaires.sql','utf8'));
 let r=await db.query('select numero_partenaire from convoyeurs order by id');
 assert.deepEqual(r.rows.map(x=>x.numero_partenaire),['PART-0001','PART-0002']);
 await db.exec("insert into convoyeurs(id,numero_partenaire) values(3,'Faux');update convoyeurs set nom='Modifié' where id=1;");
 assert.equal((await db.query('select numero_partenaire from convoyeurs where id=3')).rows[0].numero_partenaire,'PART-0003');
 await assert.rejects(db.exec("update convoyeurs set numero_partenaire='PART-9999' where id=1"),/permanent/);
 await db.exec('delete from convoyeurs where id=3;insert into convoyeurs(id) values(4);');
 assert.equal((await db.query('select numero_partenaire from convoyeurs where id=4')).rows[0].numero_partenaire,'PART-0004');
 await db.exec("select setval('private.numeros_partenaires_seq',9999);insert into convoyeurs(id) values(5)");
 assert.equal((await db.query('select numero_partenaire from convoyeurs where id=5')).rows[0].numero_partenaire,'PART-10000');
 assert.equal((await db.query("select has_function_privilege('authenticated','private.attribuer_numero_partenaire()','EXECUTE') as ok")).rows[0].ok,false);
 await db.close();console.log('PASS numéros partenaires : reprise stable, attribution serveur, immutabilité, non-réutilisation, dépassement 9999 et permissions');
})().catch(e=>{console.error(e);process.exitCode=1});
