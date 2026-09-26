const L=require('./lib');
const {urlFichier}=require('./env');
(async()=>{
 const {preparerMailAccesStockage:mail,STOCKAGE_ACCES_ENVOI_ACTIF:actif}=await import('../emails/stockage-acces.mjs');
 L.check('Mail branché au worker serveur',actif===true);
 for(const [depotClient,recuperationClient] of [[true,false],[false,true],[true,true]]){
  const m=mail({reference:'HC-QA',adresse:'Adresse de test <b>\nNoisy-le-Grand',depotClient,recuperationClient,dateDepot:'08/10/2026',heureDepot:'15:30',dateRecuperation:'13/10/2026',heureRecuperation:'16:00'});
  L.check('Contenu conditionnel '+depotClient+'/'+recuperationClient,m.text.includes('Dépôt de votre véhicule')===depotClient&&m.text.includes('Récupération de votre véhicule')===recuperationClient);
  L.check('Adresse échappée et rendez-vous corrects '+depotClient+'/'+recuperationClient,m.html.includes('&lt;b&gt;')&&!m.html.includes('<b>')&&(!depotClient||m.text.includes('08/10/2026 à 15:30'))&&(!recuperationClient||m.text.includes('13/10/2026 à 16:00')));
 }
 for(const args of [{depotClient:true,adresse:''},{adresse:'Test'}]){let rejected=false;try{mail({reference:'QA',...args});}catch(e){rejected=true;}L.check('Pas de mail sans adresse ou sans déplacement client',rejected);}
 const remise=mail({reference:'QA',depotClient:true,recuperationClient:true});
 L.check('Mail : adresse fournie par défaut, remise distincte du stockage',remise.text.includes('ALDI — 12 rue de l’Université, 93160 Noisy-le-Grand')&&remise.text.includes('site distinct')&&!remise.text.includes('Adresse du lieu de stockage'));
 const browser=await L.launch();
 try{
  for(const width of [390,1280]){
   const p=await browser.newPage({viewport:{width,height:1000}});
   await p.route('https://**/*',r=>r.abort());
   await p.goto(urlFichier('dashboard.html'));
   await p.evaluate(async()=>{
    document.getElementById('login-screen').style.display='none';
    let zone=document.getElementById('client-demandes-liste');if(!zone){zone=document.createElement('div');zone.id='client-demandes-liste';document.body.append(zone);}document.body.append(zone);
    chargerDemandesClient=async()=>[{id:'a',groupe:'preparation'},{id:'b',groupe:'devis'},{id:'c',groupe:'devis-preparation'}];
    chargerDevisClient=async()=>[];chargerInformationsDemande=async()=>[];
    _presentationDemandeClient=d=>({groupe:d.groupe,message:'Test'});
    await loadDemandesClient();
   });
   for(const key of ['preparation','devis','demandes']){
    const details=p.locator('[data-groupe-demandes="'+key+'"] > details');const summary=details.locator(':scope > summary');
    L.check(width+' '+key+' : rubrique initialement ouverte',await details.evaluate(e=>e.open));
    const adjacent=await summary.evaluate(e=>{const counter=e.querySelector('.hc-demandes-compteur').getBoundingClientRect();return e.getBoundingClientRect().right-counter.right<40;});
    L.check(width+' '+key+' : chevron immédiatement après compteur',adjacent);
    await summary.click();L.check(width+' '+key+' : fermeture',!(await details.evaluate(e=>e.open)));
    await summary.focus();await p.keyboard.press('Enter');L.check(width+' '+key+' : ouverture clavier',await details.evaluate(e=>e.open));
   }
   for(const [service,statut,paiement,visible] of [['stockage','envoye','paye',false],['stockage','accepte','en_attente',false],['stockage','accepte','paye',true],['convoyage','accepte','paye',false],['stockage','refuse','paye',false]]){
    await p.evaluate(async({service,statut,paiement})=>{
     chargerDemandesClient=async()=>[{id:'stock-qa',type_service:service,groupe:'preparation'}];
     chargerDevisClient=async()=>[{client_id:'stock-qa',statut,paiement_statut:paiement}];
     await loadDemandesClient();
    },{service,statut,paiement});
    L.check(width+' adresse réservée au stockage accepté et payé : '+service+'/'+statut+'/'+paiement,(await p.locator('[data-point-remise]').count()===1)===visible);
   }
   await p.evaluate(async()=>{chargerDevisClient=async()=>{throw Error('indisponible');};await loadDemandesClient();});
   L.check(width+' pas d’adresse si paiement invérifiable',await p.locator('[data-point-remise]').count()===0);
   await p.close();
  }
 }finally{await browser.close();}
 process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
