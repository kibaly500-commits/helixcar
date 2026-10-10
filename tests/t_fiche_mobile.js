// Fiche détaillée longue : recette locale, sans compte ni donnée distante.
const L = require('./lib');
const {urlFichier} = require('./env');
(async()=>{
 const webkit = process.env.HC_TEST_WEBKIT === '1';
 const browser = webkit ? await require('playwright').webkit.launch({headless:true}) : await L.launch();
 try {
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
  await context.route('**/*',route=>/^(file:|data:|about:)/.test(route.request().url())?route.continue():route.abort());
  const page=await context.newPage();
  await page.goto(urlFichier('dashboard.html'));
  await page.evaluate(()=>{
   document.getElementById('login-screen').style.display='none';
   document.getElementById('app').style.display='flex';
   document.getElementById('fiche-demande-corps').innerHTML=Array.from({length:45},(_,i)=>'<div class="detail-row"><span class="detail-label">Information '+i+'</span><span class="detail-val">TEST-QA Fiche mobile</span></div>').join('');
   openModal('fiche-demande');
  });
  const overlay=page.locator('#modal-fiche-demande');
  L.check('Fiche : une seule surface défilante',await overlay.evaluate(e=>e.scrollHeight>e.clientHeight && getComputedStyle(e.querySelector('.modal')).overflowY==='visible'));
  await page.mouse.move(180,420);
  for(let cycle=0;cycle<3;cycle++) {
   await page.mouse.wheel(0,10000);await page.waitForTimeout(350);
   L.check('Fiche : bas accessible, cycle '+cycle,await overlay.evaluate(e=>e.scrollTop>0 && e.scrollHeight-e.clientHeight-e.scrollTop<5));
   await page.mouse.wheel(0,-10000);await page.waitForTimeout(350);
   L.check('Fiche : retour complet en haut, cycle '+cycle,await overlay.evaluate(e=>e.scrollTop<5));
  }
  if(!webkit) {
   const cdp=await context.newCDPSession(page);
   async function glisser(debut,fin) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:debut}]});
    for(let i=1;i<=10;i++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:debut+(fin-debut)*i/10}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(350);
   }
   await glisser(700,180);
   const apresDescente=await overlay.evaluate(e=>e.scrollTop);
   await glisser(180,700);
   L.check('Fiche : inversion du geste tactile',apresDescente>0 && await overlay.evaluate(e=>e.scrollTop)<apresDescente);
  }
  await page.evaluate(()=>{openModal('apercu-devis');closeModal('apercu-devis');});
  L.check('Aperçu fermé : fiche ouverte et fond toujours verrouillé',await page.evaluate(()=>document.body.classList.contains('scroll-verrouille') && document.getElementById('modal-fiche-demande').classList.contains('open')));
  await page.evaluate(()=>{document.getElementById('modal-fiche-demande').scrollTop=1000;closeModal('fiche-demande');openModal('fiche-demande');});
  L.check('Réouverture de la fiche en haut',await overlay.evaluate(e=>e.scrollTop===0));
  await page.evaluate(()=>closeModal('fiche-demande'));
  L.check('Fermeture : aucune couche invisible ni verrou résiduel',await overlay.evaluate(e=>getComputedStyle(e).display==='none') && await page.evaluate(()=>!document.body.classList.contains('scroll-verrouille')));
  await page.evaluate(()=>{
   document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
   document.getElementById('page-client-nouvelle-demande').classList.add('active');
  });
  await page.setViewportSize({width:1200,height:900});
  await page.locator('#client-cadre-titre').click({clickCount:3});
  L.check('Triple clic sur le titre : pas de sélection du cadre',await page.evaluate(()=>getSelection().toString()===''));
  L.check('Cadre exclu de la sélection du document parent',await page.locator('#client-demande-cadre').evaluate(e=>getComputedStyle(e).userSelect==='none' || getComputedStyle(e).webkitUserSelect==='none'));
  await page.goto(urlFichier('index.html'));
  await page.evaluate(()=>openModal('client'));
  await page.locator('#client-prenom').fill('TEST-QA sélection');
  L.check('Le texte des champs reste sélectionnable',await page.locator('#client-prenom').evaluate(e=>{e.select();return e.selectionEnd-e.selectionStart===e.value.length;}));
  await context.close();
 } finally {await browser.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
