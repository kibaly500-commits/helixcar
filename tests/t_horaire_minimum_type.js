const L=require('./lib');
(async()=>{const b=await L.launch();try{for(const width of [390,1280]){
 const p=await L.newPage(b);await p.setViewportSize({width,height:1000});await L.fillStep1(p,'particulier');await L.chooseService(p,'convoyage');
 for(const service of ['convoyage','stockage','convoyage_stockage']){
 const r=await p.evaluate(async service=>{
 const set=(id,v)=>document.getElementById(id).value=v;
 const radio=(n,v)=>{const e=document.querySelector('input[name="'+n+'"][value="'+v+'"]');if(e)e.checked=true;};
 radio('type-service',service);radio('stock-acheminement','helixcar');radio('stock-sortie','helixcar');set('stock-debut','2027-10-07');set('stock-fin','2027-10-21');set('nb-vehicules','2');rendreFichesVehicules();
 radio('veh-0-liv-active','oui');radio('veh-0-restit-active','oui');basculerRestitVehicule(0);
 for(const key of ['pc','liv','restit']){set('veh-0-'+key+'-date','2027-10-21');radio('veh-0-'+key+'-htype','precise');}
 set('veh-0-pc-heure','10:00');set('veh-0-liv-heure','16:00');set('veh-0-restit-heure','');
 const e=document.getElementById('veh-0-restit-heure');_hpOuvrirPicker(e);
 const r={};r.suggestsMinimum=_hpLireHeureMinute(e.id).h===16&&_hpLireHeureMinute(e.id).min===15;
 r.openDoesNotWrite=e.value==='';r.explainsDelivery=document.getElementById('hp-chrono-note').textContent.includes('16:00')&&document.getElementById('hp-chrono-note').textContent.includes('16:15');
 r.earlierDisabled=[...document.querySelectorAll('.hp-step-btn[data-hp-delta="-1"]')].every(b=>b.disabled);
 document.querySelector('.hp-step-btn[data-hp-type="m"][data-hp-delta="1"]').click();r.canAdjust=e.value==='16:30';
 document.getElementById('hp-ok').click();r.okCloses=!_hpOverlay.classList.contains('open')&&e.value==='16:30';
 set(e.id,'');_hpOuvrirPicker(e);document.getElementById('hp-ok').click();r.okAcceptsSuggestion=e.value==='16:15';
 radio('veh-0-restit-htype','creneau');set('veh-0-restit-cdeb','');set('veh-0-restit-cfin','');_hpOuvrirPicker(document.getElementById('veh-0-restit-cdeb'));document.getElementById('hp-ok').click();r.rangeMinimum=document.getElementById('veh-0-restit-cdeb').value==='16:15'&&document.getElementById('veh-0-restit-cfin').value==='16:30';
 radio('veh-0-restit-htype','precise');set('veh-0-liv-heure','23:50');set(e.id,'');_hpOuvrirPicker(e);r.noSlotExplained=document.getElementById('hp-chrono-note').textContent.includes('Aucun horaire');document.getElementById('hp-ok').click();r.noSlotCanClose=!_hpOverlay.classList.contains('open')&&e.value==='';
 await new Promise(resolve=>setTimeout(resolve,150));
 const sel=document.getElementById('veh-0-restit-vtype');sel.value='berline';sel.dispatchEvent(new Event('change',{bubbles:true}));_showFieldError(sel.id,'Ce champ est obligatoire.');clearStaleRequired();r.selectedTypeHasNoError=!sel.classList.contains('field-error');
 _viderRestitutionVehicule(0);r.resetRealType=sel.value==='';r.resetVisibleType=!sel.closest('.hc-select-wrap').querySelector('.hc-select-btn').textContent.includes('Berline');
 return r;
 },service);for(const [k,v] of Object.entries(r))L.check(width+' '+service+' '+k,v);
 }await p.close();
 }}finally{await b.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
