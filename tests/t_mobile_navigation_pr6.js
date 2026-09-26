// UI locale isolée : aucune session ni demande distante.
const L = require('./lib');
const {urlFichier} = require('./env');
(async () => {
 const http = require('http'), fs = require('fs'), path = require('path');
 const racine = path.resolve(__dirname, '..');
 const server = http.createServer((req,res) => {
  const fichier = path.join(racine, new URL(req.url,'http://localhost').pathname);
  if (!fichier.startsWith(racine + path.sep)) {res.writeHead(403);res.end();return;}
  fs.readFile(fichier,(err,data)=>{if(err){res.writeHead(404);res.end();return;}
   if(fichier.endsWith('.html')) res.setHeader('Content-Type','text/html; charset=utf-8');
   res.end(data);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origine='http://127.0.0.1:'+server.address().port;
 const browser = await L.launch();
 try {
  const page = await L.newPage(browser);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(() => { openModal('client'); });
  await page.mouse.move(190,450);
  await page.mouse.wheel(0,2500);
  await page.waitForTimeout(250);
  const bas = await page.locator('#modal-client').evaluate(e=>e.scrollTop);
  await page.mouse.wheel(0,-4000);
  await page.waitForTimeout(250);
  L.check('Formulaire public mobile : descente puis retour en haut', bas>0 && await page.locator('#modal-client').evaluate(e=>e.scrollTop)<5);
  await page.evaluate(() => {
   closeModal('client');
   history.replaceState(null,'',location.pathname+'?nouvelle-demande=1');
   _hcModeIntegre=()=>true;
   _hcChargerSessionClient=()=>new Promise(resolve=>{
    window.qaProfilPret=()=>{
     _hcSessionClient={userId:'TEST-QA',email:'qa@example.invalid'};
     _hcProfilConnecte={prenom:'TEST',nom:'QA',type_client:'particulier'};
     resolve(_hcSessionClient);
    };
   });
   window.qaDemarrage=_hcDemarrerDepuisEspaceClient();
  });
  await page.waitForTimeout(100);
  L.check('Chargement du profil : aucun formulaire inscription visible',await page.locator('#modal-client').evaluate(e=>getComputedStyle(e).display==='none'));
  await page.evaluate(async()=>{qaProfilPret();await qaDemarrage;});
  L.check('Profil prêt : formulaire connecté ouvert directement à étape 2',await page.evaluate(()=>document.body.classList.contains('hc-sans-identite') && _formStepState.client===2 && getComputedStyle(document.getElementById('modal-client')).display!=='none'));
  await page.goto(urlFichier('dashboard.html'));
  await page.evaluate(() => {
   // Les chargeurs distants sont hors du périmètre de ce test de navigation.
   for (const nom of ['verifierAccesPartenaireEnCours','loadDemandesClient','loadFideliteCarte','loadMissionsResumeClient','loadProfilClient','loadMissionsClient','chargerAccueilAdmin','loadParametresAdmin','loadDashboardMissionsPreview','loadMissionsConvoyeur']) window[nom]=()=>{};
   document.getElementById('login-screen').style.display='none';
   document.getElementById('app').style.display='flex';
  });
  for (const [accueil,section] of [['client-dashboard','client-profil'],['admin-dashboard','admin-parametres'],['convoyeur-dashboard','convoyeur-missions']]) {
   await page.evaluate(([a,b])=>{showPage(a);showPage(b);},[accueil,section]);
   await page.goBack();
   L.check('Retour interne : '+accueil, await page.locator('#page-'+accueil).evaluate(e=>e.classList.contains('active')));
   await page.goForward();
   L.check('Avancer : '+section, await page.locator('#page-'+section).evaluate(e=>e.classList.contains('active')));
  }
  await page.evaluate(() => {
   showPage('client-nouvelle-demande');
   const cadre=document.getElementById('client-demande-cadre');
   cadre.style.height='2400px';
   cadre.srcdoc='<body style="margin:0;height:2350px;background:linear-gradient(white,gray)">TEST QA</body>';
  });
  await page.waitForTimeout(100);
  L.check('Demande mobile : cadre non plafonné',await page.locator('#client-demande-cadre').evaluate(e=>e.getBoundingClientRect().height>=2400));
  await page.mouse.move(190,450);
  await page.mouse.wheel(0,1600);
  await page.waitForTimeout(250);
  const basDashboard=await page.evaluate(()=>scrollY);
  await page.mouse.wheel(0,-4000);
  await page.waitForTimeout(250);
  L.check('Dashboard mobile : défilement sur le cadre puis remontée complète',basDashboard>500 && await page.evaluate(()=>scrollY)<5);
  await page.goto(origine+'/dashboard.html');
  await page.evaluate(() => {
   document.getElementById('login-screen').style.display='none';
   document.getElementById('app').style.display='flex';
   document.querySelectorAll('.page').forEach(e=>e.classList.remove('active'));
   document.getElementById('page-client-nouvelle-demande').classList.add('active');
   _hcCadreMode='demande';
   document.getElementById('client-demande-cadre').src='index.html?integre=1';
  });
  const cadre = await (await page.locator('#client-demande-cadre').elementHandle()).contentFrame();
  await cadre.waitForFunction(()=>typeof _hcActiverModeIntegre==='function');
  await cadre.evaluate(() => {
   document.body.classList.add('hc-mode-demande');
   _hcActiverModeIntegre();
   document.querySelector('#modal-client .modal').style.minHeight='3000px';
   _hcTransmettreHauteur();
  });
  await page.waitForFunction(()=>document.getElementById('client-demande-cadre').offsetHeight>=3000);
  await page.evaluate(()=>scrollTo(0,1000));
  await cadre.evaluate(() => {
   const overlay=_hcConstruireDupliquerOverlay();
   overlay.style.display='flex';
   _hcAdapterOverlaysIntegres();
  });
  const position=await cadre.locator('#hc-dupliquer-overlay > div').boundingBox();
  L.check('Cadre long : fenêtre de duplication dans écran visible',position.y>=0 && position.y+position.height<=844);
  await cadre.evaluate(() => {
   _hcConstruireDupliquerOverlay().style.display='none';
   const champ=document.createElement('input');
   champ.type='date';champ.id='qa-date';
   champ.style.cssText='position:absolute;left:20px;top:'+(_hcBornesCadreVisibles().haut+100)+'px';
   document.querySelector('#modal-client .modal').appendChild(champ);
   _hcOuvrirCalendrier(champ);
  });
  await page.waitForTimeout(100);
  const calendrier=await cadre.locator('.hc-cal-overlay.open .hc-cal').boundingBox();
  L.check('Cadre long : calendrier dans écran visible',calendrier && calendrier.y>=0 && calendrier.y+calendrier.height<=844);
  await cadre.evaluate(() => {
   document.querySelector('.hc-cal-overlay').classList.remove('open');
   document.getElementById('qa-date').remove();
   document.querySelector('#modal-client .modal').style.minHeight='600px';
   _hcTransmettreHauteur();
  });
  await page.waitForTimeout(100);
  L.check('Cadre : hauteur redescend après réduction du formulaire',await page.locator('#client-demande-cadre').evaluate(e=>e.offsetHeight<1500));
 } finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
