// Matrice UI isolée : vrais écrans et commandes, chargeurs de données neutralisés.
// Le contenu long synthétique teste le défilement, pas les opérations métier.
const L=require('./lib');const {urlFichier}=require('./env');
(async()=>{
 const webkit=process.env.HC_TEST_WEBKIT==='1';
 const browser=webkit?await require('playwright').webkit.launch({headless:true}):await L.launch();
 try{
  const ctx=await browser.newContext();
  await ctx.route('**/*',r=>/^(file:|about:|data:)/.test(r.request().url())?r.continue():r.abort());
  const page=await ctx.newPage();await page.goto(urlFichier('dashboard.html'));
  const inventaire=await page.evaluate(()=>{
   for(const m of showPage.toString().matchAll(/\b((?:load|charger|verifierAcces)\w+)\(/g))window[m[1]]=()=>{};
   document.getElementById('login-screen').style.display='none';document.getElementById('app').style.display='flex';
   document.getElementById('mobile-bottom-nav').style.display='flex';
   window.qaLong=()=>{const d=document.createElement('div');d.className='qa-long';d.style.height='1800px';d.textContent='TEST QA — contenu long';return d;};
   return {pages:[...document.querySelectorAll('.page')].map(e=>e.id.slice(5)),modals:[...document.querySelectorAll('.modal-overlay')].map(e=>e.id.slice(6))};
  });
  console.log('INVENTAIRE '+JSON.stringify(inventaire));
  for(const [w,h] of [[375,812],[390,844],[430,932],[844,390],[1280,900]]){
   await page.setViewportSize({width:w,height:h});
   for(const id of inventaire.pages){
    // WebKit limite les mutations d'historique à 100 par dix secondes.
    // Garder les mêmes actions, à un rythme de navigation humain.
    await page.waitForTimeout(300);
    const role=id.split('-')[0];
    const menuIndex=await page.evaluate(({role,id,w})=>{
     currentRole=role;buildNav(role);showPage(role+'-dashboard');
     const index=NAVS[role].findIndex(item=>item.id===id);
     if(w<=768&&index>=0){openMobileMenu();return index;}
     const b=document.getElementById('nav-'+id);if(b)b.click();else showPage(id);return -1;
    },{role,id,w});
    if(menuIndex>=0)await page.locator('#mobile-menu-items > button').nth(menuIndex).click();
    await page.evaluate(id=>document.getElementById('page-'+id).appendChild(qaLong()),id);
    L.check(w+' '+id+' : visible et sans débordement document',await page.evaluate(id=>document.getElementById('page-'+id).getBoundingClientRect().width>0 && document.documentElement.scrollWidth<=innerWidth+2,id));
    const scroll=await page.evaluate(({id,w})=>{
     let e=w<=768?document.scrollingElement:document.querySelector('.main');
     if(id==='client-nouvelle-demande'&&w>768)e=document.getElementById('page-'+id);
     e.scrollTop=e.scrollHeight;const bas=e.scrollTop;e.scrollTop=0;return bas>0&&e.scrollTop===0;
    },{id,w});
    L.check(w+' '+id+' : étendue du défilement',scroll);
    await page.evaluate(id=>document.getElementById('page-'+id).querySelector('.qa-long').remove(),id);
    if(id!==role+'-dashboard'){
     await page.goBack();
     const retour=await page.locator('#page-'+role+'-dashboard').evaluate(e=>e.classList.contains('active'));
     await page.goForward();
     L.check(w+' '+id+' : Retour puis Avancer',retour&&await page.locator('#page-'+id).evaluate(e=>e.classList.contains('active')));
    }
   }
   for(const id of inventaire.modals){
    await page.evaluate(id=>{const m=document.querySelector('#modal-'+id+' .modal');if(id!=='apercu-devis')m.appendChild(qaLong());openModal(id);},id);
    L.check(w+' fenêtre '+id+' : accessible',await page.locator('#modal-'+id).evaluate(e=>e.getBoundingClientRect().width>0&&getComputedStyle(e).pointerEvents!=='none'));
    if(id!=='apercu-devis')L.check(w+' fenêtre '+id+' : défilement complet',await page.locator('#modal-'+id).evaluate((e,w)=>{const s=w<=768?e:e.querySelector('.modal');s.scrollTop=s.scrollHeight;const bas=s.scrollTop;s.scrollTop=0;return bas>0&&s.scrollTop===0;},w));
    else L.check(w+' PDF : panneau tient dans écran',await page.locator('#modal-'+id+' .modal').evaluate(e=>e.getBoundingClientRect().height<=innerHeight+2));
    await page.evaluate(id=>{closeModal(id);document.querySelector('#modal-'+id+' .qa-long')?.remove();},id);
    L.check(w+' fenêtre '+id+' : verrou libéré',await page.evaluate(()=>!document.body.classList.contains('scroll-verrouille')));
   }
   if(w<=768)for(const role of ['client','convoyeur','admin']){
    await page.evaluate(role=>{currentRole=role;buildNav(role);openMobileMenu();},role);
    const boutons=await page.locator('#mobile-menu-items > button').count();
    await page.locator('#mobile-menu-items > button').last().click();
    L.check(w+' menu '+role+' : navigation et déverrouillage',boutons>0&&await page.evaluate(()=>!document.body.classList.contains('scroll-verrouille')&&document.getElementById('mobile-menu-overlay').style.display==='none'));
   }
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{
   showPage('client-dashboard');window._currentClient={demandes:[{id:'qa',numero_client:'TEST-QA',type_service:'stockage'}]};
   await ouvrirApercuDemandeClient('qa');
  });
  L.check('Récapitulatif client : fond verrouillé',await page.evaluate(()=>document.body.classList.contains('scroll-verrouille')));
  await page.evaluate(()=>fermerApercuDemandeClient());
  L.check('Récapitulatif client : verrou libéré',await page.evaluate(()=>!document.body.classList.contains('scroll-verrouille')));
  await page.evaluate(()=>{showPage('client-dashboard');showPage('client-profil');openModal('fiche-demande');});
  await page.goBack();
  L.check('Retour navigateur depuis une fiche : aucune fenêtre orpheline',await page.evaluate(()=>!document.querySelector('.modal-overlay.open') || document.getElementById('page-client-profil').classList.contains('active')));
  await ctx.close();
 }finally{await browser.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
