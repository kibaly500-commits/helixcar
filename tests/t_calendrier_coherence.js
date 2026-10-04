const L=require('./lib');
(async()=>{const browser=await L.launch();try{
 for(const width of [390,1280]){
 const page=await L.newPage(browser);await page.setViewportSize({width,height:1000});await L.fillStep1(page,'particulier');await L.chooseService(page,'convoyage');
 for(const service of ['convoyage','stockage','convoyage_stockage']){
 const r=await page.evaluate(service=>{
 const v=(id,x)=>{document.getElementById(id).value=x;};
 const radio=(n,x)=>{const el=document.querySelector('input[name="'+n+'"][value="'+x+'"]');if(el)el.checked=true;};
 radio('type-service',service);radio('stock-acheminement','helixcar');radio('stock-sortie','helixcar');v('stock-debut','2027-10-07');v('stock-fin','2027-10-21');v('nb-vehicules','2');rendreFichesVehicules();
 radio('veh-0-liv-active','oui');radio('veh-0-restit-active','oui');basculerRestitVehicule(0);
 ['pc','liv','restit'].forEach((x,i)=>{v('veh-0-'+x+'-date','2027-10-'+['07','21','23'][i]);v('veh-0-'+x+'-heure','');});
 function open(id){_hcFermerCalendrier();_hcOuvrirCalendrier(document.getElementById(id));_hcCalAnneeAffichee=2027;_hcCalMoisAffiche=9;_hcRendreCalendrier();}
 function colors(){return [...document.querySelectorAll('#hc-cal-grille [data-jour]')].map(b=>getComputedStyle(b).backgroundColor+getComputedStyle(b).backgroundImage).join('|');}
 open('veh-0-liv-date');const color=colors();const r={};
 r.maximum=document.querySelector('[data-jour="24"]').disabled;
 r.earlierAllowed=[8,9,10].every(n=>!document.querySelector('[data-jour="'+n+'"]').disabled);
 r.message=document.getElementById('hc-cal-chrono-note').textContent.includes('23/10/2027');
 _hcSelectionnerJour(25);r.blocked=valueOf('veh-0-liv-date')==='2027-10-21';
 function valueOf(id){return document.getElementById(id).value;}
 open('veh-0-restit-date');r.sameColors=colors()===color;r.min=document.querySelector('[data-jour="20"]').disabled;
 open('veh-0-pc-date');r.sameColorsPickup=colors()===color;
 open('veh-0-liv-date');_hcSelectionnerJour(9);r.modified=valueOf('veh-0-liv-date')==='2027-10-09'&&valueOf('veh-0-restit-date')==='2027-10-23'&&valueOf('veh-0-pc-date')==='2027-10-07';
 v('veh-0-liv-date','2027-10-25');r.validation=!verifierChronologieVehicule(0)&&!_chronologieVehiculeOk(0);
 v('veh-0-liv-date','2027-10-23');v('veh-0-liv-heure','14:00');v('veh-0-restit-heure','15:00');
 _hpOuvrirPicker(document.getElementById('veh-0-liv-heure'));_hpAjuster('veh-0-liv-heure','h',1);
 r.hourBlocked=valueOf('veh-0-liv-heure')==='14:00'&&document.getElementById('hp-chrono-note').textContent.includes('Horaires incompatibles');
 _hpAjuster('veh-0-liv-heure','min',1);r.hourAllowed=valueOf('veh-0-liv-heure')==='14:15';_hpFermerPicker();
 v('veh-0-liv-date','2027-10-22');v('veh-0-liv-heure','16:00');
 open('veh-0-liv-date');_hcSelectionnerJour(23);r.sameDayDateBlocked=valueOf('veh-0-liv-date')==='2027-10-22';
 v('veh-0-liv-heure','14:30');open('veh-0-liv-date');_hcSelectionnerJour(23);r.sameDayDateAllowed=valueOf('veh-0-liv-date')==='2027-10-23';
 radio('veh-0-liv-htype','creneau');v('veh-0-liv-cdeb','14:00');v('veh-0-liv-cfin','14:30');
 _hpOuvrirPicker(document.getElementById('veh-0-liv-cfin'));_hpAjuster('veh-0-liv-cfin','h',1);
 r.rangeBlocked=valueOf('veh-0-liv-cfin')==='14:30'&&valueOf('veh-0-liv-cdeb')==='14:00';_hpFermerPicker();
 radio('veh-0-liv-htype','precise');
 // Another vehicle must never constrain this vehicle.
 v('veh-1-liv-date','2027-10-08');open('veh-0-liv-date');r.vehicleIsolation=!document.querySelector('[data-jour="10"]').disabled;
 return r;
 },service);for(const [k,v] of Object.entries(r))L.check(width+' '+service+' '+k,v);
 }
 const periods=await page.evaluate(()=>{
 const result={};for(const pair of [['stock-debut','stock-fin'],['nett-date','nett-date-fin'],['pro-date-debut','pro-date-fin']]){
 document.getElementById(pair[0]).value='2027-10-07';document.getElementById(pair[1]).value='2027-10-23';
 _hcFermerCalendrier();_hcOuvrirCalendrier(document.getElementById(pair[0]));_hcCalAnneeAffichee=2027;_hcCalMoisAffiche=9;_hcRendreCalendrier();
 _hcSelectionnerJour(25);result[pair[0]+' blocked']=document.getElementById(pair[0]).value==='2027-10-07'&&document.getElementById(pair[1]).value==='2027-10-23';
 _hcSelectionnerJour(9);result[pair[0]+' allowed']=document.getElementById(pair[0]).value==='2027-10-09'&&document.getElementById(pair[1]).value==='2027-10-23';
 _hcSelectionnerJour(8);result[pair[1]+' blocked']=document.getElementById(pair[1]).value==='2027-10-23';
 }return result;});for(const [k,v] of Object.entries(periods))L.check(width+' '+k,v);
 await page.screenshot({path:'/tmp/calendrier-coherence-'+width+'.png'});
 L.check(width+' no JS exceptions',!page.jsErrors.some(e=>e.startsWith('PAGEERROR')),page.jsErrors.join('\n'));await page.close();
 }
 }finally{await browser.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
