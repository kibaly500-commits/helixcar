// Interface réelle, session et transport doublés. Jamais de service réel.
const {lancerNavigateur,urlFichier}=require('./env.js');
const assert=require('node:assert/strict');
let pass=0,fail=0;async function cas(n,f){try{await f();console.log('PASS - '+n);pass++;}catch(e){console.log('FAIL - '+n+': '+e.message);fail++;}}
const ID='11111111-1111-4111-8111-111111111111';
const INIT=`window.__session={access_token:'TEST-QA-CLAUDE-HELIXCAR-jwt'};window.__appels=[];window.__devis={reference:'TEST-QA-CLAUDE-HELIXCAR',statut:'envoye',prix:450,pdf_disponible:false};window.__retard=0;
window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:window.__session}}),onAuthStateChange:cb=>{window.__auth=cb;return{data:{subscription:{unsubscribe(){}}}};}}})};
window.fetch=async(url,opt)=>{const b=JSON.parse(opt.body);window.__appels.push({body:b,authorization:opt.headers.Authorization});await new Promise(r=>setTimeout(r,window.__retard));if(b.action==='accept')Object.assign(window.__devis,{statut:'accepte',paiement_statut:'en_attente'});if(b.action==='refuse')window.__devis.statut='refuse';return new Response(JSON.stringify({ok:true,devis:window.__devis}));};`;
(async()=>{const browser=await lancerNavigateur();
try{
 for(const width of [320,390,768,1280,1440])await cas('Consultation depuis Dashboard par ID — '+width+' px émulés',async()=>{
   const page=await browser.newPage({viewport:{width,height:900}});await page.addInitScript(INIT);await page.goto(urlFichier('devis.html')+'?id='+ID);
   await page.waitForSelector('#bouton-accepter-devis',{timeout:2000});const a=await page.evaluate(()=>window.__appels[0]);assert.equal(a.body.devis_id,ID);assert.equal(a.authorization,'Bearer TEST-QA-CLAUDE-HELIXCAR-jwt');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 });
 await cas('Devis visible sur mobile avec snapshot et logo blanc',async()=>{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.addInitScript(INIT+`window.__devis.pdf_disponible=true;window.__devis.pdf_url='https://zsetmqnmmupqbkgqbjbo.supabase.co/storage/v1/object/sign/devis/test.pdf';window.__devis.snapshot={client:{nom_complet:'Client test'}};`);
   await page.goto(urlFichier('devis.html')+'?id='+ID);
   await page.waitForSelector('.pdf-cadre iframe');
   assert.ok(await page.locator('.pdf-cadre iframe').isVisible());
   assert.ok(await page.locator('.bouton-pdf').isVisible());
   assert.equal(await page.locator('.logo-image').getAttribute('src'),'assets/logo-helixcar-blanc.png');
   assert.equal(await page.locator('.logo-image').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
   await page.screenshot({path:'/tmp/hc-devis-mobile-fix.png',fullPage:true});
   await page.close();
 });
 await cas('Le devis mobile prévoit toutes les pages ajustées avec repli natif',async()=>{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   await page.addInitScript(INIT+`window.pdfjsLib={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve({numPages:2,getPage:async()=>({getViewport:({scale})=>({width:595*scale,height:842*scale}),render:()=>({promise:Promise.resolve()})})})})};window.__devis.pdf_disponible=true;window.__devis.pdf_url='https://zsetmqnmmupqbkgqbjbo.supabase.co/storage/v1/object/sign/devis/test.pdf';`);
   await page.goto(urlFichier('devis.html')+'?id='+ID);
   await page.waitForSelector('.pdf-cadre.pdf-rendu-mobile');
   assert.equal(await page.locator('.pdf-mobile-pages').getAttribute('aria-label'),'Pages du devis');
   assert.equal(await page.locator('.pdf-mobile-page').count(),2);
   assert.equal(await page.locator('.pdf-mobile-page figcaption').allTextContents().then(v=>v.join('|')),'Page 1 sur 2|Page 2 sur 2');
   assert.ok(await page.locator('.pdf-cadre iframe').isHidden());
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.close();
 });
 await cas('Refus depuis Dashboard sans token : décision persistée puis relue',async()=>{
   const page=await browser.newPage();await page.addInitScript(INIT);await page.goto(urlFichier('devis.html')+'?id='+ID);await page.click('#bouton-refuser-devis',{timeout:2000});await page.click('#modal-bouton-confirmer');await page.waitForFunction(()=>document.getElementById('zone-contenu').textContent.includes('Devis refusé'),{timeout:2000});assert.equal(await page.evaluate(()=>window.__appels.filter(a=>a.body.action==='refuse').length),1);await page.close();
 });
 await cas('Lien anonyme : aucune donnée privée et retour à la connexion intégrée',async()=>{
   const page=await browser.newPage();await page.addInitScript(INIT+'window.__session=null;');await page.goto(urlFichier('devis.html')+'#token='+'t'.repeat(64));await page.waitForSelector('a.bouton',{timeout:2000});assert.equal(await page.evaluate(()=>window.__appels.length),0);assert.ok((await page.locator('a.bouton').getAttribute('href')).startsWith('index.html?connexion=1#devis='));await page.close();
 });
 await cas('Une réponse retardée ne réaffiche pas le devis après déconnexion',async()=>{
   const page=await browser.newPage();await page.addInitScript(INIT+'window.__retard=300;');await page.goto(urlFichier('devis.html')+'#token='+'t'.repeat(64));await page.evaluate(()=>{window.__session=null;window.__auth('SIGNED_OUT');});await page.waitForTimeout(400);assert.equal(await page.locator('#bouton-accepter-devis').count(),0);assert.ok((await page.locator('#zone-contenu').textContent()).includes('Connectez-vous'));await page.close();
 });
 await cas('Modal clavier : focus contenu, boucle Tab et retour Escape',async()=>{
   const page=await browser.newPage();await page.addInitScript(INIT);await page.goto(urlFichier('devis.html')+'?id='+ID);await page.click('#bouton-refuser-devis');assert.equal(await page.evaluate(()=>document.activeElement.id),'modal-champ-motif');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'modal-bouton-confirmer');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'modal-champ-motif');await page.keyboard.press('Escape');assert.ok(await page.locator('#voile-modal').isHidden());assert.equal(await page.evaluate(()=>document.activeElement.id),'bouton-refuser-devis');await page.close();
 });
 await cas('Acceptation double clic : une décision, état serveur relu',async()=>{
   const page=await browser.newPage();await page.addInitScript(INIT);await page.goto(urlFichier('devis.html')+'#token='+'t'.repeat(64));await page.click('#bouton-accepter-devis');await page.evaluate(()=>{document.getElementById('modal-bouton-confirmer').click();document.getElementById('modal-bouton-confirmer').click();});await page.waitForFunction(()=>window.__devis.statut==='accepte');assert.equal(await page.evaluate(()=>window.__appels.filter(a=>a.body.action==='accept').length),1);await page.close();
 });
}finally{await browser.close();}console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
