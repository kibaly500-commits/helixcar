const L=require('./lib');const plan=require('../assets/preparation-missions.js');
(async()=>{const browser=await L.launch();try{
 const page=await L.newPage(browser);const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await L.fillStep1(page,'particulier');await L.chooseService(page,'convoyage');
 await page.evaluate(()=>{document.getElementById('nb-vehicules').value='2';onNbVehiculesChange();rendreFichesVehicules();});
 L.check('Motorisation proposée pour chaque véhicule',await page.locator('select[id^="veh-"][id$="-motorisation"]').count()===4);
 L.check('Motorisation facultative pour établir le devis',await page.locator('#veh-0-motorisation').evaluate(e=>!e.required));
 await page.evaluate(()=>{document.getElementById('veh-0-motorisation').value='Électrique';document.getElementById('veh-1-motorisation').value='Diesel';document.querySelector('input[name="veh-0-restit-active"][value="oui"]').checked=true;basculerRestitVehicule(0);document.getElementById('veh-0-restit-motorisation').value='Hybride';});
 const vs=await page.evaluate(()=>_lireFichesVehicules());
 L.check('Valeurs indépendantes par véhicule',vs[0].motorisation==='Électrique'&&vs[1].motorisation==='Diesel');
 L.check('Restitution indépendante',vs[0].restit_motorisation==='Hybride');
 L.check('Valeurs autorisées dans la charge envoyée',await page.evaluate(()=>CHAMPS_VEHICULE.includes('motorisation')&&CHAMPS_VEHICULE.includes('restit_motorisation')));
 await page.evaluate(()=>rendreFichesVehicules());L.check('Valeurs conservées après reconstruction',await page.locator('#veh-0-motorisation').inputValue()==='Électrique');
 const copie=await page.evaluate(()=>{
  const set=(id,v)=>document.getElementById(id).value=v;
  set('veh-0-immat','AA-111-AA');set('veh-1-immat','BB-222-BB');
  set('veh-0-restit-immat','CC-333-CC');set('veh-1-restit-immat','DD-444-DD');
  _hcCopierVehiculeVers(0,1);
  const get=id=>document.getElementById(id).value;
  return {motorisation:get('veh-1-motorisation'),restitution:get('veh-1-restit-motorisation'),plaque:get('veh-1-immat'),plaqueRestit:get('veh-1-restit-immat')};
 });
 L.check('Duplication : les deux motorisations sont reprises',copie.motorisation==='Électrique'&&copie.restitution==='Hybride');
 L.check('Duplication : les deux plaques restent propres à la cible',copie.plaque==='BB-222-BB'&&copie.plaqueRestit==='DD-444-DD');
 await page.evaluate(()=>_completerRendre([{cle:'vehicule_1_motorisation',libelle:'Motorisation',statut:'attendue',valeur:null}]));
 L.check('Complément sous forme de liste obligatoire',await page.locator('#completer-champ-vehicule_1_motorisation').evaluate(e=>e.tagName==='SELECT'&&e.required));
 await page.locator('#completer-champ-vehicule_1_motorisation').evaluate(e=>{e.value='Électrique';e.dispatchEvent(new Event('input',{bubbles:true}));});
 L.check('Complément sélectionnable',await page.locator('#completer-champ-vehicule_1_motorisation').inputValue()==='Électrique');
 const p=plan.build({type_service:'convoyage'},[{...vs[0],ville_depart:'Paris',ville_arrivee:'Lyon',date_prise_en_charge:'2026-11-01',date_livraison:'2026-11-01'}])[0];
 L.check('Préparation reprend la motorisation principale',p.motorisation==='Électrique');L.check('Préparation reprend celle de restitution',p.restit_motorisation==='Hybride');
 L.check('Annonce porte la motorisation',plan.publicData(p).rows.some(r=>r.label==='Motorisation'&&r.value==='Électrique'));
 L.check('Aucune exception JS',errors.length===0,errors.join(' / '));
 // Vérifier le texte réellement imprimé, pas la présence du champ dans
 // l'adaptateur de données partagé avec la fiche administrative.
 const {construirePdfServeur}=await import('../supabase/functions/_shared/devis-pdf.mjs');
 const {jsPDF}=require('jspdf');
 const imprimer=dossier=>{
  const textes=[];
  function PdfObserve(options){const doc=new jsPDF(options),text=doc.text.bind(doc);
   doc.text=(val,...args)=>{textes.push(val);return text(val,...args);};return doc;}
  construirePdfServeur(PdfObserve,dossier,{reference:'DEV-QA',prix:100});
  return JSON.stringify(textes);
 };
 for(const multi of [false,true]){
  const v={marque_modele:'Peugeot 308',type_vehicule:'berline',immatriculation:'QA-001',vin:'VF123456789012345',motorisation:'MOTORISATION_SECRETE',restit_motorisation:'RESTIT_SECRETE'};
  const dossier={type_service:'convoyage',nb_vehicules:multi?2:1,...(multi?{_vehicules:[v,{...v,position:2}]}:v)};
  const sans=JSON.parse(JSON.stringify(dossier));delete sans.motorisation;delete sans.restit_motorisation;
  (sans._vehicules||[]).forEach(x=>{delete x.motorisation;delete x.restit_motorisation;});
  const rendu=imprimer(dossier);
  L.check('Motorisation absente du devis '+(multi?'multi':'mono'),rendu.includes('Peugeot 308')&&rendu.includes('DEV-QA')&&rendu===imprimer(sans)&&!rendu.includes('SECRETE'));
 }
 await page.close();
 }finally{await browser.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
