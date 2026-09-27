const fs=require('fs'),Module=require('module'),path=require('path');
const name=process.argv[2],file=path.resolve('tests/'+name+'.js');let s=fs.readFileSync(file,'utf8');
if(name==='t_devis_client')s=s.replace('window.__auth=cb;','(window.__authListeners||(window.__authListeners=[])).push(cb);window.__auth=(...args)=>window.__authListeners.forEach(f=>f(...args));');
if(name==='t_motdepasse')s=s.replace('window.__declencher = cb;','(window.__authListeners||(window.__authListeners=[])).push(cb);window.__declencher=(...args)=>window.__authListeners.forEach(f=>f(...args));');
if(name==='t_admin_infos')s=s.replace("Correction demandée : Précisez", "Correction demandée au client : Précisez");
if(name==='t_dashboard_premium')s=s.replace('const ctx={currentRole:', 'const ctx={window:{},currentRole:');
if(name==='t_devis_envoi')s=s.replace("return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(rep); } });","return Promise.resolve(new Response(JSON.stringify(rep),{status:200,headers:{'Content-Type':'application/json'}}));");
if(name==='t_d01_dashboard')s=s.replace('getSession:async()=>({data:{session:null}})','getSession:async()=>({data:{session:{access_token:"qa",user:{id:"qa-client"}}}})');
if(name==='t_mission_nettoyage')s=s.replace("const ficheKo = await page.evaluate", "const ficheKo = await page.evaluate").replace("check('B15 : et dit ce qui manque',", "console.log('DIAGNOSTIC FICHE',ficheKo);check('B15 : et dit ce qui manque',");
if(name==='t_pro')s=s.replace("L.check('A6 : aucune mention", "console.log('DIAGNOSTIC TEXTE',texte);L.check('A6 : aucune mention");

if(name==='t_lots_de')s=s.replace("const rendu = await page.evaluate(() => {\n      const jours =", "await page.locator('#hc-cal-suiv').click();const rendu = await page.evaluate(() => {\n      const jours =");
if(name==='t_mission_nettoyage')s=s.replace("order(){ return api; }, limit(){ return api; },","order(){ return api; }, limit(){ return api; }, range(){ return api; },");
if(name==='t_devis_envoi'){
 s=s.replace("return Promise.resolve({ ok: true, status: 200, headers: { get: function(){ return 'items 0-0/0'; } }, text: function(){ return Promise.resolve(JSON.stringify(lignes)); } });", "return Promise.resolve(new Response(JSON.stringify(lignes),{status:200,headers:{'Content-Type':'application/json','Content-Range':'items 0-0/0'}}));");
 s=s.replace("const errs = [];", "const errs = [];page.on('console',m=>{if(m.type()==='error')console.log('BROWSER ERROR',m.text())});");
 s=s.replace("check('A5 :", "console.log('DIAG A5',JSON.stringify(await fiche()),await page.evaluate(()=>window.__alertes));check('A5 :");
 s=s.replace("check('A10 :", "console.log('DIAG A10',JSON.stringify(await fiche()),await page.evaluate(()=>window.__alertes));check('A10 :");
}

const mod=new Module(file,module);mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));mod._compile(s,file);
