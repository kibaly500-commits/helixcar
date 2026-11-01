const fs = require('fs'), assert = require('assert');
const { PGlite } = require('@electric-sql/pglite');
(async () => {
  const db = new PGlite(); let count = 0;
  const ok = (label, condition) => { assert(condition, label); console.log('PASS ' + label); count++; };
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
    create table auth.users(id uuid primary key,email text,deleted_at timestamptz,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.est_admin() returns boolean language sql stable as $$select false$$;
    grant usage on schema public,auth to anon,authenticated;`);
  const fixture = JSON.parse(fs.readFileSync(__dirname + '/preparation/schema.json'));
  for (const t of fixture.tables.filter(t => ['clients', 'vehicules'].includes(t.name)))
    await db.exec('create table public.' + t.name + '(' + t.columns.map(c => '"' + c.name + '" ' + c.type + (c.default ? ' default ' + c.default : '') + (c.notnull ? ' not null' : '')).join(',') + ',primary key(id))');
  await db.exec(fs.readFileSync('migrations/92_creation_demande_atomique.sql', 'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20261004221754_numeros_clients_demandes_admin.sql', 'utf8'));
  const old = '11111111-1111-4111-8111-111111111111', pending = '22222222-2222-4222-8222-222222222222';
  const fresh = '33333333-3333-4333-8333-333333333333', partner = '44444444-4444-4444-8444-444444444444';
  const proof = 'original-inscription-'.repeat(4), otherProof = 'different-inscription-'.repeat(4);
  const meta = value => JSON.stringify({hc_activation:'client',hc_client_reclamation:value});
  await db.query('insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at) values($1,$2,$3,now()),($4,$5,$6,null)', [old, 'old@example.test', meta(proof), pending, 'pending@example.test', meta(otherProof)]);
  const original = (await q('select private.attribuer_numero_client($1) n', [old]))[0].n;
  await db.exec(fs.readFileSync('supabase/migrations/20261009122120_numero_client_des_inscription.sql', 'utf8'));
  const number = async uid => (await q('select numero from public.comptes_clients where auth_user_id=$1', [uid]))[0]?.numero;
  ok('numéro existant conservé', await number(old) === original);
  const pendingNumber = await number(pending);
  ok('ancien compte non confirmé reçoit son numéro', /^CLI-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(pendingNumber));
  await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3),($4,$5,$6)', [fresh, 'fresh@example.test', meta(proof), partner, 'partner@example.test', '{"hc_activation":"partenaire"}']);
  const freshNumber = await number(fresh);
  ok('nouvelle inscription reçoit immédiatement son numéro', /^CLI-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(freshNumber));
  ok('pas de numéro attribué au partenaire', !await number(partner));
  ok('numéros distincts', new Set([original, pendingNumber, freshNumber]).size === 3);
  await db.exec('set role anon');
  const read = async (uid, key) => (await q('select public.lire_numero_client_inscription($1,$2) n', [uid,key]))[0].n;
  ok('lecture avant activation avec sa preuve', await read(fresh,proof) === freshNumber);
  ok('UUID seul insuffisant', await read(fresh,null) === null);
  ok('preuve étrangère refusée', await read(fresh,otherProof) === null);
  ok('preuve non valable pour un autre compte', await read(pending,proof) === null);
  for (const table of ['public.comptes_clients','private.preuves_numero_inscription']) {
    let blocked = false; try { await q('select * from ' + table); } catch(e) { blocked = true; }
    ok('lecture directe interdite : ' + table, blocked);
  }
  await db.exec('reset role');
  await db.query('update auth.users set raw_user_meta_data=$2 where id=$1', [fresh,meta(otherProof)]);
  ok('métadonnées modifiables ne remplacent pas la preuve', await read(fresh,otherProof) === null);
  ok('preuve initiale préservée', await read(fresh,proof) === freshNumber);
  await db.query("insert into public.clients(id,auth_user_id,numero_client,email,code_parrainage,prenom,nom) values(gen_random_uuid(),$1,'HC-2026-TEST','fresh@example.test','TEST','Test','Client')",[fresh]);
  ok('rattachement ultérieur conserve le même numéro', await number(fresh) === freshNumber);
  ok('lecture du numéro ne confirme pas le compte', (await q('select email_confirmed_at from auth.users where id=$1',[fresh]))[0].email_confirmed_at === null);
  await db.close(); console.log(count + ' vérifications SQL réussies');
})().catch(e => {console.error(e);process.exitCode=1;});
