const assert=require('assert'),fs=require('fs'),L=require('./lib');
const planner=require('../assets/preparation-missions');
const {PGlite}=require('@electric-sql/pglite');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create schema auth;create schema private;
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create function public.est_admin() returns boolean language sql as $$select false$$;`);
 const fixture=JSON.parse(fs.readFileSync(__dirname+'/preparation/schema.json'));
 for(const t of fixture.tables.filter(t=>['clients','vehicules'].includes(t.name)))await db.exec('create table public.'+t.name+'('+t.columns.map(c=>'"'+c.name+'" '+c.type+(c.default?' default '+c.default:'')+(c.notnull?' not null':'')).join(',')+',primary key(id))');
 await db.exec(fs.readFileSync('migrations/92_creation_demande_atomique.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261009142317_restitution_destination_retour.sql','utf8'));
 const base={position:1,type_vehicule:'berline',restitution_concernee:true,adresse_depart_rue:'10 rue du Départ',code_postal_depart:'75001',ville_depart:'Paris',restit_adresse_rue:'7 rue Manuelle',restit_code_postal:'69001',restit_ville:'Lyon',restit_contact_nom:'Contact conservé',restit_date:'2027-11-12',restit_heure:'16:00'};
 let seq=0;
 async function create(service,extra={}){
  const demande={type_service:service,prenom:'Test',nom:'Retour',email:'qa@example.invalid',numero_client:'HC-TEST-'+(++seq),code_parrainage:'RET'+seq,trajet_commun:false};
  await db.query('select public.creer_demande_avec_vehicules($1,$2)',[JSON.stringify(demande),JSON.stringify([{...base,...extra}])]);
  return (await db.query('select v.* from vehicules v join clients c on c.id=v.dossier_id where c.numero_client=$1',[demande.numero_client])).rows[0];
 }
 const manual=await create('convoyage');assert.equal(manual.restit_destination,'adresse');assert.equal(manual.restit_adresse_rue,base.restit_adresse_rue);
 const depart=await create('convoyage',{restit_destination:'depart'});assert.equal(depart.restit_adresse_rue,base.adresse_depart_rue);assert.equal(depart.restit_ville,'Paris');assert.equal(depart.restit_contact_nom,base.restit_contact_nom);
 await db.query('update vehicules set adresse_depart_rue=$1 where id=$2',['20 rue Corrigée',depart.id]);assert.equal((await db.query('select restit_adresse_rue from vehicules where id=$1',[depart.id])).rows[0].restit_adresse_rue,'20 rue Corrigée');
 const storage=await create('stockage',{restit_destination:'stockage'});assert.equal(storage.restit_adresse_rue,'Point de stockage HelixCar');assert.equal(storage.restit_ville,'Noisy-le-Grand');assert.equal(storage.restit_contact_nom,base.restit_contact_nom);
 const off=await create('convoyage',{restit_destination:'depart',restitution_concernee:false});assert.equal(off.restit_destination,'adresse');
 await assert.rejects(create('convoyage',{restit_destination:'stockage'}),/stockage/);
 await assert.rejects(create('stockage',{restit_destination:'autre'}),/check constraint/);
 const plans=planner.build({id:'client',type_service:'stockage',stockage_date_debut:'2027-11-04',stockage_date_fin:'2027-11-10',stockage_acheminement:'helixcar',stockage_sortie:'helixcar'},[{...storage,date_prise_en_charge:'2027-11-04',date_livraison:'2027-11-10',ville_depart:'Paris',ville_arrivee:'Lyon'}],'12 rue Privée, 93160 Noisy-le-Grand');
 assert.equal(plans.length,2);assert.equal(plans[0].mission.restitution,false);assert.equal(plans[1].mission.adresse_restitution,'12 rue Privée, 93160 Noisy-le-Grand');assert(!JSON.stringify(plans.map(planner.publicData)).includes('12 rue Privée'));
 console.log('PASS création atomique, destinations serveur, anciens champs et confidentialité');await db.close();
 const browser=await L.launch();
 try{for(const width of [390,1280]){
  const p=await L.newPage(browser);await p.setViewportSize({width,height:1000});await L.fillStep1(p,'particulier');await L.chooseService(p,'convoyage');
  const r=await p.evaluate(()=>{
   const el=id=>document.getElementById(id),set=(id,v)=>el(id).value=v;
   const radio=(name,v)=>document.querySelector('input[name="'+name+'"][value="'+v+'"]').checked=true;
   set('nb-vehicules','2');rendreFichesVehicules();
   for(let i=0;i<2;i++){radio('veh-'+i+'-restit-active','oui');basculerRestitVehicule(i);set('veh-'+i+'-pc-rue','Départ '+i);set('veh-'+i+'-pc-cp','75001');set('veh-'+i+'-pc-ville','Paris');}
   set('veh-0-restit-rue','Adresse manuelle');set('veh-0-restit-cp','69001');set('veh-0-restit-ville','Lyon');set('veh-0-restit-contact','Contact intact');set('veh-0-restit-heure','16:30');
   const r={defaultUnchecked:!el('veh-0-restit-retour').checked};el('veh-0-restit-retour').click();
   r.destination=_lireFichesVehicules()[0].restit_adresse_rue==='Départ 0';r.isolation=!el('veh-1-restit-retour').checked&&el('veh-1-restit-rue').value==='';
   set('veh-0-pc-rue','Départ corrigé');el('veh-0-pc-rue').dispatchEvent(new Event('input',{bubbles:true}));r.followSource=el('veh-0-restit-rue').value==='Départ corrigé';
   const payload=_normaliserVehiculePourEnvoi(_lireFichesVehicules()[0]);r.payload=payload.restit_destination==='depart'&&!('_restit_adresse_manuelle' in payload);
   rendreFichesVehicules();r.persist=el('veh-0-restit-retour').checked;el('veh-0-restit-retour').click();r.restore=el('veh-0-restit-rue').value==='Adresse manuelle'&&el('veh-0-restit-cp').value==='69001';r.keepOther=el('veh-0-restit-contact').value==='Contact intact'&&el('veh-0-restit-heure').value==='16:30';
   el('veh-0-restit-retour').click();radio('veh-0-restit-active','non');basculerRestitVehicule(0);radio('veh-0-restit-active','oui');basculerRestitVehicule(0);r.noGhost=!el('veh-0-restit-retour').checked&&el('veh-0-restit-rue').value==='';
   radio('type-service','stockage');radio('stock-acheminement','helixcar');radio('stock-sortie','helixcar');rendreFichesVehicules();
   radio('veh-0-restit-active','oui');basculerRestitVehicule(0);el('veh-0-restit-retour').click();const storage=_normaliserVehiculePourEnvoi(_lireFichesVehicules()[0]);r.storage=storage.restit_destination==='stockage'&&storage.restit_ville==='Noisy-le-Grand';r.private=!el('veh-restit-0').textContent.includes('Université')&&!JSON.stringify(storage).includes('Université');r.hidden=el('veh-0-restit-adresse-zone').hidden;
   return r;
  });
  for(const [k,v] of Object.entries(r))assert(v,width+' '+k);assert.deepEqual(p.jsErrors,[]);console.log('PASS formulaire '+width+'px : '+Object.keys(r).join(', '));
  await p.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
