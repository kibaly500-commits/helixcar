const assert=require('assert'),fs=require('fs'),L=require('./lib');
const authSource=fs.readFileSync(__dirname+'/t_rattachement.js','utf8');
const init=new Function(authSource.slice(authSource.indexOf('function init('),authSource.indexOf('async function deposerCompteSeul'))+';return init;')();
(async()=>{
 const browser=await L.launch();
 try {
  for(const width of [390,1280]) {
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   let mock=init(false,false,false).replace("if (nom !== 'creer_demande_avec_vehicules')", "if (nom === 'lire_numero_client_inscription') { const inscription=window.__journal.find(j=>j.op==='signUp'); return {data:params.p_preuve===inscription.data.hc_client_reclamation?'CLI-A7K9P':null,error:null}; }\n    if (nom !== 'creer_demande_avec_vehicules')");
   await page.addInitScript(mock);await page.goto(L.urlFichier('index.html'));
   await L.fillStep1(page,'particulier');await L.chooseService(page,'compte');
   await page.evaluate(()=>submitClientForm());
   await page.locator('#modal-client .hc-succes-compte strong').waitFor();
   assert.equal(await page.locator('#modal-client .hc-succes-compte strong').innerText(),'CLI-A7K9P');
   assert.match(await page.locator('#modal-client .hc-succes-num').innerText(),/^HC-/);
   assert.match(await page.locator('#modal-client').innerText(),/activer|activation/i);
   assert.equal(await page.evaluate(()=>window.__session),null);
   const calls=await page.evaluate(()=>window.__journal.filter(j=>j.op==='rpc'&&j.nom==='creer_demande_avec_vehicules'));
   assert.equal(calls.length,1);assert.equal(calls[0].session,null);
   await page.screenshot({path:'/tmp/hc-inscription-numero-'+width+'.png',fullPage:false});
   assert.deepEqual(errors,[]);console.log('PASS numéro et référence distincts avant activation '+width);await page.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.addInitScript(()=>{window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select(){return this},eq(){return this},maybeSingle:async()=>({data:{numero:'CLI-A7K9P'}})})})};});
  await page.goto(L.urlFichier('dashboard.html'));
  await page.evaluate(async()=>{document.getElementById('login-screen').style.display='none';document.getElementById('app').classList.add('visible');currentRole='client';window._currentClient={authUserId:'client-qa'};await chargerNumeroClient('client-qa');showPage('client-dashboard');});
  const card=page.locator('#client-numero-permanent');await card.waitFor();
  assert.equal(await card.locator('strong').innerText(),'CLI-A7K9P');
  assert.equal(await card.locator('strong').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),14);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await card.screenshot({path:'/tmp/hc-numero-client-discret.png'});
  console.log('PASS référence client compacte et sans débordement');
  await page.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
