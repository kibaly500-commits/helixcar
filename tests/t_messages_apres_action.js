const L=require('./lib');
(async()=>{const browser=await L.launch();try{for(const width of [390,1280]){
 const p=await L.newPage(browser);await p.setViewportSize({width,height:1000});await L.fillStep1(p,'particulier');await L.chooseService(p,'convoyage');
 await p.evaluate(()=>{
 document.getElementById('nb-vehicules').value='1';rendreFichesVehicules();
 document.querySelector('input[name="veh-0-restit-active"][value="oui"]').checked=true;basculerRestitVehicule(0);
 document.getElementById('veh-0-pc-date').value='2027-10-06';document.getElementById('veh-0-liv-date').value='2027-10-16';
 _hcOuvrirCalendrier(document.getElementById('veh-0-restit-date'));_hcCalAnneeAffichee=2027;_hcCalMoisAffiche=9;_hcRendreCalendrier();
 });
 L.check(width+' no message on opening',await p.locator('#hc-cal-chrono-note').isHidden());
 // Real pointer hit, not direct invocation: disabled day can explain without selecting.
 const hit=p.locator('#hc-cal-grille [data-jour="15"]').locator('..');const box=await hit.boundingBox();await p.mouse.click(box.x+box.width/2,box.y+box.height/2);
 L.check(width+' explanation after blocked attempt',(await p.locator('#hc-cal-chrono-note').textContent()).includes('16/10/2027'));
 L.check(width+' blocked date not written',await p.locator('#veh-0-restit-date').inputValue()==='');
 await p.screenshot({path:'/tmp/cal-attempt-'+width+'.png'});
 await p.locator('#hc-cal-grille [data-jour="24"]').click();await p.locator('#hc-cal-ok').click();
 L.check(width+' empty hour no premature error',await p.locator('#veh-0-restit-heure').evaluate(e=>!e.classList.contains('field-error')));
 await p.evaluate(()=>_hcOkSousVeh(0,'livraison'));
 L.check(width+' section validation requires hour',await p.locator('#veh-0-restit-heure').evaluate(e=>e.classList.contains('field-error')));
 await p.evaluate(()=>{const el=document.getElementById('veh-0-restit-heure');el.value='14:00';el.dispatchEvent(new Event('change',{bubbles:true}));});
 L.check(width+' filled hour clears error',await p.locator('#veh-0-restit-heure').evaluate(e=>!e.classList.contains('field-error')));
 await p.evaluate(()=>{_hcFermerCalendrier();_hcOuvrirCalendrier(document.getElementById('veh-0-restit-date'));});
 L.check(width+' reopened calendar quiet again',await p.locator('#hc-cal-chrono-note').isHidden());
 await p.close();
 }}finally{await browser.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
