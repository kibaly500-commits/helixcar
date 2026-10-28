const L=require('./lib');
const {urlFichier}=require('./env');
const fs=require('fs');
(async()=>{
 const browser=await L.launch();
 try{
  for(const width of [390,1280]){
   const p=await L.newPage(browser);await p.setViewportSize({width,height:1000});
   await L.fillStep1(p,'particulier');await L.chooseService(p,'convoyage');
   for(const n of [1,3]){
    const r=await p.evaluate(n=>{
     const val=(id,v)=>document.getElementById(id).value=v;
     val('nb-vehicules',String(n));rendreFichesVehicules();
     val('veh-0-pc-date','2027-10-08');val('veh-0-liv-date','2027-10-06');
     _hcOuvrirCalendrier(document.getElementById('veh-0-liv-date'));
     _hcCalAnneeAffichee=2027;_hcCalMoisAffiche=9;_hcRendreCalendrier();
     const dates=[...document.querySelectorAll('#hc-cal-grille [data-jour]')];
     const disabled=dates.filter(b=>Number(b.dataset.jour)<8).every(b=>b.disabled);
     const sameEnabled=!dates.find(b=>b.dataset.jour==='8').disabled;
     _hcFermerCalendrier();
     val('veh-0-pc-heure','');val('veh-0-liv-heure','');
     const noHours=!verifierChronologieVehicule(0)&&!_chronologieVehiculeOk(0);
     val('veh-0-liv-date','2027-10-08');
     document.querySelector('input[name="veh-0-pc-heure-type"][value="precise"]')?.click();
     document.querySelector('input[name="veh-0-liv-heure-type"][value="precise"]')?.click();
     val('veh-0-pc-heure','15:30');val('veh-0-liv-heure','15:00');
     const timeRejected=!verifierChronologieVehicule(0);
     val('veh-0-liv-heure','16:00');const laterAllowed=verifierChronologieVehicule(0);
     document.querySelector('input[name="veh-0-restit-active"][value="oui"]').checked=true;basculerRestitVehicule(0);
     val('veh-0-restit-consignes','OHHHH <img src=x onerror=alert(1)>');
     construireRecap();const recap=document.getElementById('recap-demande');
     return {disabled,sameEnabled,noHours,timeRejected,laterAllowed,notes:recap.textContent.includes('OHHHH'),escaped:!recap.querySelector('img'),payload:_lireFichesVehicules()[0].restit_contraintes.includes('OHHHH')};
    },n);
    for(const [k,v] of Object.entries(r))L.check(width+'px '+n+' véhicule(s) : '+k,v);
   }
   const s=await p.evaluate(()=>{
    const radio=(name,v)=>document.querySelector('input[name="'+name+'"][value="'+v+'"]').checked=true;
    radio('type-service','stockage');radio('stock-acheminement','helixcar');radio('stock-sortie','recuperation_client');
    document.getElementById('stock-debut').value='2027-10-08';document.getElementById('stock-fin').value='2027-10-13';document.getElementById('stock-heure-sortie').value='16:30';
    rendreFichesVehicules();
    const b=document.getElementById('veh-0-sous-livraison');
    const title=b.querySelector('button').textContent;
    const text=b.textContent;
    const note=document.getElementById('veh-0-pc-date-origine-date');
    const r={recovery:title.includes('Récupération après stockage'),date:text.includes('13/10/2027'),hour:text.includes('16:30'),address:text.includes('Noisy-le-Grand')&&text.includes('L’adresse exacte vous sera communiquée'),noDeliveryInputs:!b.querySelector('input[id*="-liv-"]'),locked:document.getElementById('veh-0-pc-date').disabled&&note.textContent.includes('08/10/2027')};
    return r;
   });
   // Attendre l'état observable depuis le pilote : une longue Promise
   // conservée uniquement dans evaluate était parfois collectée par Chromium.
   const change=async(id,value)=>p.evaluate(({id,value})=>{const el=document.getElementById(id);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));},{id,value});
   await change('stock-fin','2027-10-14');await change('stock-heure-sortie','17:00');
   await p.waitForFunction(()=>{const b=document.getElementById('veh-0-sous-livraison');return b.textContent.includes('14/10/2027')&&b.textContent.includes('17:00');});
   s.recoveryUpdated=true;
   await change('stock-heure-sortie','');
   await p.waitForFunction(()=>!_hcEtapeVehiculeComplete(document.getElementById('veh-0-sous-livraison')));
   s.missingHourIncomplete=true;
   await change('stock-heure-sortie','17:00');
   await p.waitForFunction(()=>_hcEtapeVehiculeComplete(document.getElementById('veh-0-sous-livraison')));
   s.recoveryComplete=true;
   Object.assign(s,await p.evaluate(()=>{
    const r={};
    const radio=(name,v)=>document.querySelector('input[name="'+name+'"][value="'+v+'"]').checked=true;
    radio('stock-sortie','helixcar');rendreFichesVehicules();r.deliveryRestored=!!document.getElementById('veh-0-liv-active-group');
    radio('stock-sortie','recuperation_client');radio('stock-acheminement','depot_client');rendreFichesVehicules();r.selfServiceUnchanged=!document.getElementById('veh-0-sous-livraison');
    radio('type-service','convoyage');rendreFichesVehicules();r.unlocked=!document.getElementById('veh-0-pc-date').disabled&&!document.getElementById('veh-0-pc-date-origine-date');
    return r;
   }));
   for(const [k,v] of Object.entries(s))L.check(width+'px stockage : '+k,v);
   await p.close();
  }
  const p=await browser.newPage();
  const stub=fs.readFileSync(require.resolve('./t_devis.js'),'utf8').match(/const STUB = `([\s\S]*?)`;/)[1];
  await p.addInitScript(stub+`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},order:async()=>({data:window.__vs||[],error:null})})})};`);await p.goto(urlFichier('dashboard.html'));
  const r=await p.evaluate(async()=>{
   const v={position:1,marque_modele:'Peugeot',immatriculation:'QA-001',restitution_concernee:true,restit_contraintes:'OHHHH <img src=x onerror=alert(1)>'};
   const c={id:'qa',type_service:'convoyage',nb_vehicules:1,_vehicules:[v]};
   const devis={reference:'DEV-QA',prix:100};
   _construirePdfDevis(c,devis,{recapitulatif:true});const pdf=!__pdfTextes.join(' ').includes('OHHHH')&&!__pdfTextes.join(' ').includes('Consignes de restitution');
   _construirePdfDevis(c,devis);const quoteUnchanged=!__pdfTextes.join(' ').includes('OHHHH');
   const admin=_detailVehicule(c,v,0);const box=document.createElement('div');box.innerHTML=admin;
   window._currentClient={demandes:[c]};_sbAuthPret=()=>true;
   window.__vs=[v];
   _construirePdfDevis=()=>{throw Error('PDF indisponible simulé');};await ouvrirApercuDemandeClient('qa');
   const fallback=document.getElementById('hc-apercu-contenu');
   return {pdf,quoteUnchanged,admin:box.textContent.includes('OHHHH')&&!box.querySelector('img'),clientFallback:fallback.textContent.includes('OHHHH')&&!fallback.querySelector('img')};
  });
  for(const [k,v] of Object.entries(r))L.check('Récapitulatifs : '+k,v);
 }finally{await browser.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
