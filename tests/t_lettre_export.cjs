// Real browser renderer with local, fictitious mission responses; no live requests.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
(async()=>{
 const server=require('http').createServer((req,res)=>{const file=path.join(process.cwd(),decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(process.cwd()+path.sep)){res.writeHead(403);return res.end();}fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.js')?'application/javascript':file.endsWith('.png')?'image/png':'text/html');res.end(data);});});
 await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
 const page=await browser.newPage();
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='127.0.0.1')return route.continue();
  if(u.pathname.includes('html2canvas'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(require.resolve('html2canvas/dist/html2canvas.min.js'),'utf8')});
  if(u.pathname.includes('jspdf'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(path.dirname(require.resolve('jspdf')),'jspdf.umd.min.js'),'utf8')});
  if(u.pathname.includes('supabase-js'))return route.fulfill({contentType:'application/javascript',body:`window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'TEST',user:{id:'test'}}}})}})};`});
  if(u.hostname.endsWith('.supabase.co')){
   let data=[];
   if(u.pathname.endsWith('/missions'))data=[{id:'m',reference_courte:'HC-TEST-0019',convoyeur_id:'p',restitution:true,marque_modele:'Véhicule aller TEST',immatriculation:'AA-000-AA',vin:'VF1AB12CD34E56789',restit_marque_modele:'Véhicule restitution TEST',restit_immatriculation:'BB-000-BB',restit_vin:'VF2AB12CD34E56789',adresse_depart:'12 avenue de la Gare, Le Mans',adresse_arrivee:'24 rue de la République, Xertigny',adresse_restitution:'12 avenue de la Gare, Le Mans',contact_depart_nom:'Contact départ TEST',contact_arrivee_nom:'Contact arrivée TEST',restit_contact_nom:'Contact retour TEST'}];
   if(u.pathname.endsWith('/convoyeurs'))data=[{id:'p',nom:'RECETTE',prenom:'Partenaire'}];
   if(u.pathname.endsWith('/etats_des_lieux'))data=[{phase:'depart',km:10000,created_at:'2026-11-01T12:34:00Z'},{phase:'arrivee',km:10100,created_at:'2026-11-01T14:22:00Z'},{phase:'restitution_depart',km:5000,created_at:'2026-11-01T14:30:00Z'},{phase:'restitution_arrivee',km:5100,created_at:'2026-11-01T16:33:00Z'}];
   return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  }
  return route.abort();
 });
 fs.mkdirSync('/tmp/helix-review',{recursive:true});
 for(const width of [1363,390])for(const trajet of ['aller','restitution']){
  await page.setViewportSize({width,height:936});
  await page.goto('http://127.0.0.1:8765/lettre-voiture.html?mission=HC-TEST-0019&trajet='+trajet);
  await page.waitForFunction(()=>!document.getElementById('pdf-btn').disabled);
  assert.equal(await page.locator('#f-date-depart').textContent(),'01/11/2026');
  assert.equal(await page.locator('.heure-manuelle').count(),2);
  await page.evaluate(()=>window.scrollTo(0,400));
  const b64=await page.evaluate(async()=>{const blob=await creerPdfLettre(document.querySelector('.page'));return await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(blob);});});
  fs.writeFileSync(`/tmp/helix-review/${trajet}-${width}.pdf`,Buffer.from(b64,'base64'));
  console.log('PASS export '+trajet+' largeur '+width+' : heures vides, rendu réel depuis page défilée');
 }
 await page.setViewportSize({width:1150,height:900});
 await page.goto('http://127.0.0.1:8765/guide-exemples-edl.html');
 await page.screenshot({path:'/tmp/helix-review/exemples.png',fullPage:true});
 } finally {await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
