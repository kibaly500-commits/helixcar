const L=require('./lib');
(async()=>{
 const b=process.env.HC_TEST_WEBKIT==='1'?await require('playwright').webkit.launch({headless:true}):await L.launch();
 try{
  const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await ctx.route('**/*',route=>/^(file:|data:|about:)/.test(route.request().url())?route.continue():route.abort());
  const p=await ctx.newPage();await p.goto(require('./env').urlFichier('index.html'));
  await p.evaluate(()=>openModal('client'));await p.waitForTimeout(400);
  let r=await p.evaluate(()=>{const m=document.getElementById('modal-client'),box=m.getBoundingClientRect();return {left:box.left,right:box.right,height:box.height,locked:document.documentElement.classList.contains('hc-client-mobile-open'),width:innerWidth};});
  L.check('Mobile : formulaire couvre la largeur visible',r.left===0&&r.right===r.width);
  L.check('Mobile : page derrière immobilisée',r.locked);
  L.check('Étape 1 particulière : tient dans 390 × 844',await p.locator('#modal-client').evaluate(e=>e.scrollHeight<=e.clientHeight+2));
  // Une visualViewport réduite reproduit la géométrie clavier, sans clavier système.
  await p.evaluate(()=>{window.__vv=window.visualViewport;Object.defineProperty(window,'visualViewport',{configurable:true,value:{height:390,offsetTop:24}});window.dispatchEvent(new Event('resize'));});
  await p.waitForTimeout(80);
  r=await p.locator('#modal-client').evaluate(e=>({top:e.getBoundingClientRect().top,height:e.getBoundingClientRect().height,scroll:e.scrollHeight}));
  L.check('Clavier : cadre suit la hauteur et le décalage visibles',r.top===24&&r.height===390,JSON.stringify(r));
  L.check('Clavier : contenu reste défilable',r.scroll>r.height);
  await p.evaluate(()=>{Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__vv});window.dispatchEvent(new Event('resize'));});
  await L.fillStep1(p,'particulier');await L.chooseService(p,'convoyage');
  await p.evaluate(()=>{
   document.getElementById('nb-vehicules').value='1';rendreFichesVehicules();
   const field=document.getElementById('veh-0-liv-date');
   _formStepState.client=Number(field.closest('.form-step').dataset.step);_renderFormStep('client');
   let node=field.parentElement;while(node&&node.id!=='modal-client'){if(node.classList.contains('veh-accordeon')||node.classList.contains('veh-sous-accordeon'))node.classList.add('ouvert');node=node.parentElement;}
   document.querySelectorAll('#veh-contenu-0').forEach(e=>e.style.display='block');
   window.__nativeFocus=0;document.addEventListener('focusin',e=>{if(e.target.matches('input[type="date"],input[type="time"]'))__nativeFocus++;},true);
  });
  await p.waitForTimeout(100);
  for(const [id,overlay] of [['veh-0-liv-date','.hc-cal-overlay'],['veh-0-liv-heure','.hp-overlay']]){
   await p.locator('[data-field="'+id+'"]').tap();
   L.check(id+' : toucher ouvre HelixCar',await p.locator(overlay).evaluate(e=>e.classList.contains('open')));
   L.check(id+' : aucun focus sur le champ natif',await p.evaluate(()=>__nativeFocus===0));
   await p.evaluate(()=>{_hcFermerCalendrier();_hpFermerPicker();});
   await p.locator('[data-field="'+id+'"]').focus();await p.keyboard.press('Enter');
   L.check(id+' : accès clavier au sélecteur',await p.locator(overlay).evaluate(e=>e.classList.contains('open')));
   await p.evaluate(()=>{_hcFermerCalendrier();_hpFermerPicker();});
  }
  L.check('Intitulé du véhicule récupéré',await p.locator('#veh-restit-0').evaluate(e=>e.textContent.includes('Informations du véhicule à récupérer')));
  await p.evaluate(()=>{
   document.querySelector('[name="type-service"][value="stockage"]').checked=true;
   document.querySelector('[name="stock-sortie"][value="helixcar"]').checked=true;
   document.getElementById('stock-fin').value='2027-10-23';rendreFichesVehicules();
  });await p.waitForTimeout(80);
  L.check('Stockage : rappel explicite de l’étape précédente',await p.locator('[data-hc-stock-fin-rappel]').first().textContent().then(t=>t.includes('étape précédente : 23/10/2027')));
  await p.evaluate(()=>{document.getElementById('stock-fin').value='2027-10-24';document.getElementById('stock-fin').dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForTimeout(80);
  L.check('Stockage : rappel actualisé',await p.locator('[data-hc-stock-fin-rappel]').first().textContent().then(t=>t.includes('24/10/2027')));
  await p.evaluate(()=>closeModal('client'));await p.waitForTimeout(80);
  L.check('Fermeture : page déverrouillée',await p.evaluate(()=>!document.documentElement.classList.contains('hc-client-mobile-open')));
  await ctx.close();
 }finally{await b.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
