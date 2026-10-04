const L=require('./lib');
(async()=>{const browser=await L.launch();try{
 for(const width of [390,1280]){
 const p=await L.newPage(browser);await p.setViewportSize({width,height:1000});await L.fillStep1(p,'particulier');await L.chooseService(p,'convoyage');
 const r=await p.evaluate(()=>{
 const val=(id,x)=>document.getElementById(id).value=x;
 const radio=(name,x)=>document.querySelector('input[name="'+name+'"][value="'+x+'"]').checked=true;
 function open(id){_hcFermerCalendrier();_hcOuvrirCalendrier(document.getElementById(id));_hcCalAnneeAffichee=2027;_hcCalMoisAffiche=9;_hcRendreCalendrier();}
 const r={};window.confirm=()=>true;
 for(const service of ['convoyage','stockage'])for(const count of [1,2]){
 radio('type-service',service);radio('stock-acheminement','helixcar');radio('stock-sortie','helixcar');val('stock-debut','2027-10-07');val('stock-fin','2027-10-21');val('nb-vehicules',String(count));rendreFichesVehicules();
 radio('veh-0-restit-active','oui');basculerRestitVehicule(0);val('veh-0-pc-date','2027-10-07');val('veh-0-liv-date','2027-10-21');val('veh-0-restit-date','2027-10-23');
 const key=service+' '+count;
 open('veh-0-liv-date');r[key+' no lower reminder']=!document.getElementById('hc-cal-chrono-note').textContent.includes('prise en charge');
 r[key+' upper reminder']=document.getElementById('hc-cal-chrono-note').textContent.includes('23/10/2027');
 const note=document.getElementById('hc-cal-chrono-note').textContent;_hcSelectionnerJour(5);
 r[key+' lower blocked silently']=document.getElementById('veh-0-liv-date').value==='2027-10-21'&&document.getElementById('hc-cal-chrono-note').textContent===note;
 document.querySelector('#hc-cal-grille [data-jour="9"]').click();
 r[key+' remains open']=_hcCalOverlay.classList.contains('open')&&document.getElementById('veh-0-liv-date').value==='2027-10-09';
 document.querySelector('#hc-cal-grille [data-jour="10"]').click();
 r[key+' can revise']=document.getElementById('veh-0-liv-date').value==='2027-10-10';
 document.getElementById('hc-cal-ok').click();r[key+' OK closes']=!_hcCalOverlay.classList.contains('open');
 val('veh-0-marque','QA');effacerVehicule(0);
 r[key+' identity cleared']=document.getElementById('veh-0-marque').value==='';
 r[key+' full reset date']=document.getElementById('veh-0-pc-date').value===(service==='stockage'?'2027-10-07':'');
 val('veh-0-pc-date','2027-10-07');val('veh-0-pc-heure','10:00');
 // Resolve the actual subsection containing the pickup field.
 const block=document.getElementById('veh-0-pc-date').closest('.veh-sous-accordeon');
 _hcEffacerSousVeh(0,block.id.replace('veh-0-sous-',''));
 r[key+' subsection reset date']=document.getElementById('veh-0-pc-date').value===(service==='stockage'?'2027-10-07':'');
 r[key+' hour cleared']=document.getElementById('veh-0-pc-heure').value==='';
 r[key+' source untouched']=document.getElementById('stock-debut').value==='2027-10-07';
 }
 return r;
 });for(const [k,v]of Object.entries(r))L.check(width+' '+k,v);
 L.check(width+' no JS error',!p.jsErrors.some(e=>e.startsWith('PAGEERROR')),p.jsErrors.join('\n'));await p.close();
 }
 }finally{await browser.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
