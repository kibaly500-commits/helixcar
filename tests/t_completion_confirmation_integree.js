const fs=require('fs');
const L=require('./lib');
const {urlFichier}=require('./env');
const source=fs.readFileSync(__dirname+'/t_infos.js','utf8');
const init=source.split('const INIT = `')[1].split('`;')[0];
(async()=>{const browser=await L.launch();try{
 for(const width of [1280,390]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addInitScript(init);
  const page=await context.newPage();await page.goto(urlFichier('dashboard.html'));
  await page.evaluate(async()=>{const r=await sbAuth.auth.signInWithPassword({email:'clientA@helixcar.test',password:'x'});const uid=r.data.user.id;await finaliserSessionClient('clientA@helixcar.test',null,uid);await _hcPreparerRoles('client','clientA@helixcar.test',uid);ouvrirCompletionDemande('dem-conv');});
  const frame=page.frameLocator('#client-demande-cadre');
  await frame.locator('#completer-champ-contact_pc_nom').fill('TEST-QA Contact');
  await frame.locator('#completer-champ-contact_pc_tel').fill('06 55 55 55 55');
  await frame.locator('#completer-envoyer').click();
  await frame.locator('.hc-completion-confirm').waitFor({state:'visible',timeout:3000});
  L.check(width+' : confirmation visible dans le Dashboard',await frame.locator('.hc-completion-confirm [data-confirm]').isVisible());
  const geometry=await frame.locator('.hc-completion-confirm').evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight};});
  L.check(width+' : confirmation centrée et contenue',Math.abs(geometry.x+geometry.w/2-geometry.vw/2)<2&&Math.abs(geometry.y+geometry.h/2-geometry.vh/2)<2&&geometry.x>=0&&geometry.y>=0&&geometry.y+geometry.h<=geometry.vh);
  await frame.locator('.hc-completion-confirm [data-cancel]').click();
  L.check(width+' : annulation conserve la saisie',await frame.locator('#completer-champ-contact_pc_nom').inputValue()==='TEST-QA Contact');
  await frame.locator('#completer-envoyer').click();
  await frame.locator('.hc-completion-confirm [data-confirm]').click();
  const child=page.frames().find(f=>f.url().includes('completer=dem-conv'));
  await child.waitForFunction(()=>!_completerEnvoiEnCours&&!_completerConfirmationEnCours);
  const count=await child.evaluate(()=>window.__journal.filter(j=>j.op==='rpc'&&j.nom==='repondre_informations_demande').length);
  L.check(width+' : confirmation transmet une seule fois',count===1);
  await context.close();
 }
 }finally{await browser.close();}process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1});
