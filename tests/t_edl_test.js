const {lancerNavigateur,urlFichier}=require('./env.js');const assert=require('node:assert/strict');
(async()=>{const browser=await lancerNavigateur();try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('dialog',d=>d.dismiss());
 await page.addInitScript(()=>{
  window.__rpc=[];window.__uploads=[];window.__headers=[];window.__fail=false;
  const mission={id:'11111111-1111-4111-8111-111111111111',reference:'TEST-EDL',devis_source_id:'22222222-2222-4222-8222-222222222222',convoyeur_id:'c1',statut:'acceptee',marque_modele:'Peugeot 308',ville_depart:'Paris'};
  const session={access_token:'SESSION-QA',user:{id:'qa-user',email:'qa@example.test'}};
  window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session}})},storage:{from:bucket=>({upload:async(path)=>{window.__uploads.push({bucket,path});return{data:{path}};},createSignedUrl:async()=>({data:{signedUrl:'https://example.test/image'}})})},rpc:async(name,payload)=>{window.__rpc.push({name,payload});if(window.__fail)return{error:{message:'coupure'}};return{data:{ok:true}};}})};
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(url,opts)=>{if(String(url).startsWith('data:'))return nativeFetch(url,opts);window.__headers.push(opts?.headers?.Authorization);if(String(url).includes('functions/v1'))return Response.json({ok:true});return Response.json(String(url).includes('/convoyeurs?')?[{id:'c1',prenom:'TEST',nom:'QA'}]:[mission]);};
 });
 await page.goto(urlFichier('edl.html')+'?mission=TEST-EDL');await page.waitForSelector('#step-1',{state:'visible'});
 await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;canvas.getContext('2d').fillRect(0,0,4,4);const png=canvas.toDataURL();
  for(const slot of ['vin','avant','arriere','gauche','droit','avg','avd','arg','ard','pag','pad','prg','prd','tenue','parebrise','hab-av','hab-ar','tableau','coffre'])photos[slot]=png;
  document.getElementById('v-km').value='0';document.getElementById('v-obs').value='<script>TEST</script>';etat='bon';sigHas=true;sx.fillRect(0,0,10,10);
  await sauvegarderBrouillonEdl();
 });
 const submission=await page.evaluate(()=>edlSubmissionId);await page.reload();await page.waitForFunction(()=>Object.keys(photos).length===19);
 assert.equal(await page.locator('#v-km').inputValue(),'0');assert.equal(await page.evaluate(()=>edlSubmissionId),submission);assert.ok(await page.evaluate(()=>sigHas));
 console.log('PASS brouillon restauré après rechargement : photos, signature, kilométrage et identifiant');
 await page.evaluate(async()=>{window.__fail=true;await submit();});assert.ok(await page.evaluate(()=>operationBrouillonEdl('readonly',(s,k)=>s.get(k))));
 console.log('PASS panne serveur : aucun faux succès, brouillon conservé');
 await page.evaluate(async()=>{window.__fail=false;window.__rpc=[];await Promise.all([submit(),submit()]);});
 const calls=await page.evaluate(()=>window.__rpc);assert.equal(calls.length,1);assert.equal(calls[0].name,'enregistrer_edl_test');assert.equal(calls[0].payload.p_payload.km,0);
 assert.equal(await page.evaluate(()=>operationBrouillonEdl('readonly',(s,k)=>s.get(k))),undefined);
 const uploads=await page.evaluate(()=>window.__uploads);assert.ok(uploads.every(x=>x.bucket==='edl-test'&&x.path.startsWith('11111111-1111-4111-8111-111111111111/depart/'+submission+'/')));
 assert.ok((await page.evaluate(()=>window.__headers)).every(x=>x==='Bearer SESSION-QA'));
 console.log('PASS validation unique, session réelle, stockage privé rattaché à la mission, nettoyage après succès');
 await page.close();
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
