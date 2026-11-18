const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite(),id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function convoyeur_de_session() returns uuid language sql stable as $$select auth.uid()$$;
create function partenaire_actif() returns boolean language sql stable as $$select auth.uid() is not null$$;
create table missions(id uuid primary key,convoyeur_id uuid,statut text,type_mission text,date_prise_en_charge timestamp,date_livraison timestamp,restitution boolean,date_restitution_depart timestamp,date_restitution_arrivee timestamp,date_intervention date,date_fin_intervention date,heure_intervention text,heure_debut_intervention time,heure_fin_intervention time);
create table opportunites(id uuid primary key,mission_id uuid);
create table opportunite_candidatures(id uuid primary key,opportunite_id uuid,convoyeur_id uuid,etat text);
grant usage on schema public,auth,private to authenticated;`);
await db.exec(fs.readFileSync('supabase/migrations/20261101165859_conflits_creneaux_partenaire.sql','utf8'));
const mission=async(n,start,end,extra={})=>db.query('insert into missions select * from jsonb_populate_record(null::missions,$1)',[{id:id(n),statut:'en_attente',type_mission:'convoyage',date_prise_en_charge:'2026-11-10T'+start,date_livraison:'2026-11-10T'+end,...extra}]);
await mission(1,'09:00','12:00',{convoyeur_id:id(9),statut:'acceptee',restitution:true,date_restitution_depart:'2026-11-10T17:00'});
await mission(2,'15:00','16:00');await mission(3,'17:00','19:00');await mission(4,'18:00','20:00');
await db.exec(`insert into opportunites values('${id(12)}','${id(2)}'),('${id(13)}','${id(3)}'),('${id(14)}','${id(4)}');`);
const apply=(n,offer,partner=9,state='a_etudier')=>db.query('insert into opportunite_candidatures values($1,$2,$3,$4)',[id(n),id(offer),id(partner),state]);
await assert.rejects(()=>apply(22,12),/Créneau indisponible/); // conflit avec restitution seulement
await apply(23,13);await apply(24,14); // deux candidatures non retenues ne réservent pas
await db.query("update opportunite_candidatures set etat='retenu' where id=$1",[id(23)]);
await assert.rejects(()=>db.query("update opportunite_candidatures set etat='retenu' where id=$1",[id(24)]),/Créneau indisponible/);
await assert.rejects(()=>db.query("update missions set convoyeur_id=$1,statut='acceptee' where id=$2",[id(9),id(2)]),/Créneau indisponible/);
await apply(25,12,8); // autre partenaire libre
await db.exec(`update missions set statut='terminee' where id='${id(1)}'`);await apply(26,12); // terminée ne bloque plus
await db.exec(`select set_config('request.jwt.claim.sub','${id(9)}',false);set role authenticated;`);
let rows=(await db.query('select missions_du_partenaire() r')).rows[0].r;assert.deepEqual(rows.map(x=>x.id).sort(),[id(1),id(3)]);
await assert.rejects(()=>db.query("select private.verifier_creneau_partenaire($1,'{}')",[id(9)]),/permission denied/);
await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated;`);await assert.rejects(()=>db.query('select missions_du_partenaire()'),/Accès partenaire/);
await db.exec('reset role');
const onsite={type_mission:'professionnel',date_intervention:'2026-11-12',date_fin_intervention:'2026-11-13',heure_debut_intervention:'09:00',heure_fin_intervention:'12:00'};
await db.query('insert into missions select * from jsonb_populate_record(null::missions,$1)',[{id:id(5),convoyeur_id:id(9),statut:'acceptee',...onsite}]);
await mission(6,'15:00','16:00',{date_prise_en_charge:'2026-11-12T15:00',date_livraison:'2026-11-12T16:00',convoyeur_id:id(9)});
await assert.rejects(()=>mission(7,'10:00','11:00',{date_prise_en_charge:'2026-11-13T10:00',date_livraison:'2026-11-13T11:00',convoyeur_id:id(9)}),/Créneau indisponible/);
await db.close();console.log('PASS conflits : aller, restitution, limite horaire, candidature non réservante, attribution revérifiée, autre partenaire, mission terminée, journées professionnelles et accès privé.');
})().catch(e=>{console.error(e);process.exitCode=1});
