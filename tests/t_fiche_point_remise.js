const L=require('./lib');const {urlFichier}=require('./env');
(async()=>{const browser=await L.launch();try{
 for(const assigned of [false,true])for(const [entree,sortie] of [[true,false],[false,true],[true,true]]){
  const p=await browser.newPage();await p.route('https://**/*',r=>r.abort());
  await p.addInitScript(({assigned,entree,sortie})=>{
   window.__headers=[];window.__rpc=0;
   window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'AUTH-QA',user:{id:'qa-user',email:'qa@example.test'}}}})},from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null})};return q;},rpc:async()=>{window.__rpc++;return {data:{adresse:'ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand',arriveeAvantStockage:entree,departApresStockage:sortie}};}})};
   window.fetch=async(url,opts)=>{window.__headers.push(opts.headers.Authorization);return Response.json(url.includes('/convoyeurs?')?[{id:'qa-conv'}]:url.includes('/missions?')?[{id:'qa-mission',reference:'QA',convoyeur_id:assigned?'qa-conv':null,adresse_depart:'Adresse client départ',adresse_arrivee:'Adresse client arrivée'}]:[]);};
  },{assigned,entree,sortie});
  await p.goto(urlFichier('fiche-mission.html')+'?mission=QA');
  await p.waitForFunction(()=>document.getElementById('stockage-remise-section').style.display==='block'||document.getElementById('access-denied').style.display==='block');
  const r=await p.evaluate(()=>({visible:document.getElementById('stockage-remise-section').style.display==='block',text:document.getElementById('stockage-remise-mouvements').textContent,auth:__headers.every(h=>h==='Bearer AUTH-QA'),rpc:__rpc,depart:document.getElementById('f-ville-depart').textContent}));
  L.check('Attribution '+assigned+' '+entree+'/'+sortie+' : visibilité',r.visible===assigned);
  L.check('Accès avec session authentifiée',r.auth);
  if(assigned){L.check('Sens des mouvements correct',r.text.includes('Avant stockage')===entree&&r.text.includes('Après stockage')===sortie);L.check('Adresse client conservée',r.depart==='Adresse client départ');}
  else L.check('Sans attribution : adresse jamais demandée',r.rpc===0);
  await p.close();
 }
}finally{await browser.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
