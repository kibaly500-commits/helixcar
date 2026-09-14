const L=require('./lib');const {urlFichier}=require('./env');
(async()=>{
 const webkit=process.env.HC_TEST_WEBKIT==='1';
 const browser=webkit?await require('playwright').webkit.launch({headless:true}):await L.launch();
 try{
  for(const role of ['client','convoyeur','admin']){
   const ctx=await browser.newContext({viewport:{width:390,height:844}});
   await ctx.route('**/*',r=>/^(file:|data:|about:)/.test(r.request().url())?r.continue():r.abort());
   const page=await ctx.newPage();await page.goto(urlFichier('index.html'));await page.goto(urlFichier('dashboard.html'));
   await page.evaluate(role=>{
    for(const m of showPage.toString().matchAll(/\b((?:load|charger|verifierAcces)\w+)\(/g))window[m[1]]=()=>{};
    document.getElementById('login-screen').style.display='none';document.getElementById('app').style.display='flex';
    showPage(role+'-dashboard');
   },role);
   const longueur=await page.evaluate(()=>history.length);
   await page.reload();
   await page.evaluate(role=>{
    for(const m of showPage.toString().matchAll(/\b((?:load|charger|verifierAcces)\w+)\(/g))window[m[1]]=()=>{};
    document.getElementById('login-screen').style.display='none';document.getElementById('app').style.display='flex';
    showPage(role+'-dashboard');
   },role);
   L.check(role+' : actualiser ne multiplie pas les étapes de sortie',await page.evaluate(()=>history.length)===longueur);
   await page.evaluate(role=>showPage(role==='admin'?'admin-parametres':role+'-profil'),role);
   await page.goBack();
   L.check(role+' : retour interne sans confirmation',await page.locator('#modal-quitter-espace').evaluate(e=>!e.classList.contains('open')));
   await page.evaluate(()=>openModal('fiche-demande'));
   await page.goBack();
   L.check(role+' : Retour ferme la fiche avant de proposer la sortie',await page.evaluate(()=>!document.querySelector('.modal-overlay.open')));
   await page.goBack();
   L.check(role+' : confirmation avant sortie',await page.locator('#modal-quitter-espace').evaluate(e=>e.classList.contains('open')));
   await page.getByRole('button',{name:'Rester sur mon espace'}).click();
   L.check(role+' : rester conserve le Dashboard et libère le défilement',await page.evaluate(()=>!document.body.classList.contains('scroll-verrouille'))&&page.url().includes('dashboard.html'));
   await page.goBack();
   L.check(role+' : nouvelle tentative propose encore la confirmation',await page.locator('#modal-quitter-espace').evaluate(e=>e.classList.contains('open')));
   await page.getByRole('button',{name:'Quitter cet espace',exact:true}).click();
   await page.waitForURL(urlFichier('index.html'));
   L.check(role+' : sortie confirmée rejoint réellement la page précédente',page.url()===urlFichier('index.html'));
   await ctx.close();
  }
 }finally{await browser.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
