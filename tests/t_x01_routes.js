const {lancerNavigateur,urlFichier}=require('./env.js');
const assert=require('node:assert/strict');
const fs=require('node:fs');
let pass=0,fail=0;
(async()=>{const browser=await lancerNavigateur();try{
for(const f of ['helixcar-cgv-client.html','helixcar-contrat-convoyeur.html','helixcar-emails.html']){
try{const contenu=fs.readFileSync(f,'utf8');assert.ok(!/signCGV|signContrat|success-screen|email-card/.test(contenu));const page=await browser.newPage();await page.goto(urlFichier(f));await page.waitForURL(/index\.html$/,{timeout:3000});assert.equal(await page.locator('#success-screen').count(),0);await page.close();console.log('PASS - '+f+' : ancienne page retirée, retour vitrine');pass++;}catch(e){console.log('FAIL - '+f+' : '+e.message);fail++;}
}
}finally{await browser.close();}console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);process.exitCode=fail?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
