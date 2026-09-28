const {lancerNavigateur}=require('./env.js');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await lancerNavigateur();try{
 for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}});
 await page.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:fs.readFileSync('devis.html','utf8')}):r.abort());
 await page.addInitScript(()=>{
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'qa',user:{email:'helixcarpro+stockage-part2609@gmail.com'}}}}),onAuthStateChange:()=>({})}})};
 window.fetch=async(url,opt)=>{
 if(url.includes('stripe-checkout')){window.__checkout=JSON.parse(opt.body);return Response.json({ok:false,message:'Test de transport réussi'},{status:503});}
 return Response.json({ok:true,devis:{reference:'DEV-2026-0093',statut:'accepte',paiement_statut:'en_attente',prix:450,pdf_disponible:false}});
 };
 });
 await page.goto('https://helixcar-i89b-git-codex-helix-b25bf8-kibaly500-commits-projects.vercel.app/devis.html?token=qa-test-link-1234567890&paiement=annule');
 await page.waitForSelector('#bouton-payer-stripe');
 assert.equal(await page.locator('[data-scenario]').count(),0);
 assert.match(await page.locator('#stripe-resultat').innerText(),/quitté/);
 await page.locator('#bouton-payer-stripe').click();
 await page.waitForFunction(()=>window.__checkout);
 assert.equal((await page.evaluate(()=>__checkout)).devis_id,'07bbbfa7-8e6c-437a-a99f-a48e40b18f6f');
 assert.equal(await page.locator('#bouton-payer-stripe').isEnabled(),true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 console.log('PASS Stripe test UI '+width);await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
