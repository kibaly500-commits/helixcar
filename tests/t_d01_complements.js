// D01 — sauvegarde progressive par véhicule, sur l'UI réelle et un
// double Supabase local. Ni persistance distante ni RLS prouvée ici.
const {lancerNavigateur,urlFichier}=require('./env.js');
const capturerQA=require('./preuves-qa.js');
let pass=0,fail=0;
const check=(n,ok)=>{console.log((ok?'PASS':'FAIL')+' - '+n);ok?pass++:fail++;};
const INIT=`
window.__lignes=[];window.__appels=[];window.__panne=false;window.__zero=false;window.__panneRelecture=false;
window.supabase={createClient(){return {
 auth:{getSession:async()=>({data:{session:{user:{id:'TEST-QA-CLAUDE-HELIXCAR-A',email:'test@example.invalid'}}}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};}},
 from(){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},then(r){return Promise.resolve({data:[],error:null}).then(r);}};return q;},
 rpc:async function(n,p){
  if(n==='informations_demande')return __panneRelecture?{error:{message:'SQL interne'}}:{data:__lignes.map(l=>({...l})),error:null};
  if(n==='repondre_informations_demande'){
   __appels.push(p);await new Promise(r=>setTimeout(r,25));
   if(__panne)return {error:{message:'SQL interne'}};
   if(__zero)return {data:0,error:null};
   let count=0;for(const l of __lignes){if(p.p_reponses[l.cle]&&l.statut==='attendue'){l.valeur=p.p_reponses[l.cle];l.statut='transmise';count++;}}
   return {data:count,error:null};
  }
  return {data:[],error:null};
 }
};}};
`;
(async()=>{
 const browser=await lancerNavigateur();
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('index.html'),{waitUntil:'load'});
  async function ouvrir(n){await page.evaluate(async n=>{
   __lignes=[];__appels=[];__panne=false;__zero=false;__panneRelecture=false;
   for(let i=1;i<=n;i++)__lignes.push(
    {cle:'vehicule_'+i+'_marque_modele',libelle:'Marque et modèle',statut:'fournie',valeur:'TEST-QA-CLAUDE-HELIXCAR véhicule '+i},
    {cle:'vehicule_'+i+'_immatriculation',libelle:'immatriculation',statut:'attendue',valeur:null});
   await ouvrirCompleterInformations('TEST-QA-CLAUDE-HELIXCAR-D'+n);
  },n);}
  for(const n of [1,2,3,5]){
   await ouvrir(n);
   check(n+' véhicules : un bouton et une identité par fiche',await page.locator('[data-enregistrer-groupe]').count()===n && await page.locator('.completer-groupe').count()===n);
   check(n+' véhicules : seules les immatriculations manquantes sont éditables',await page.locator('#completer-rubriques input').count()===n && await page.locator('label[for="completer-champ-vehicule_1_immatriculation"]').textContent()==='Véhicule 1 — immatriculation manquante *');
   await page.locator('#completer-champ-vehicule_1_immatriculation').fill('TEST-QA-CLAUDE-HELIXCAR plaque1');
   if(n>1)await page.locator('#completer-champ-vehicule_2_immatriculation').fill('TEST-QA-CLAUDE-HELIXCAR pas encore envoyé');
   await page.locator('[data-enregistrer-groupe="vehicule_1"]').click();
   await page.waitForFunction(()=>!_completerEnvoiEnCours);
   check(n+' véhicules : seule la bonne fiche est transmise',await page.evaluate(()=>__appels.length===1 && Object.keys(__appels[0].p_reponses).join()==='vehicule_1_immatriculation'));
   if(n>1){
    check(n+' véhicules : autre saisie conservée sans être annoncée enregistrée',await page.locator('#completer-champ-vehicule_2_immatriculation').inputValue()==='TEST-QA-CLAUDE-HELIXCAR pas encore envoyé' && await page.evaluate(()=>__lignes.find(l=>l.cle==='vehicule_2_immatriculation').valeur===null));
    check(n+' véhicules : état Complet de la fiche enregistrée',await page.locator('[data-groupe="vehicule_1"] .completer-etat').textContent()==='Complet');
    if(n===2)await capturerQA(page,'d01-complements-mobile','#modal-completer .modal');
   }else check('1 véhicule : dossier complet seulement après relecture',(await page.locator('#completer-complet').textContent()).includes('Aucune information ne manque'));
  }
  await ouvrir(2);
  await page.locator('#completer-champ-vehicule_1_immatriculation').fill('TEST-QA-CLAUDE-HELIXCAR plaque');
  await page.evaluate(async()=>{__panne=true;await envoyerInformationsCompletees('vehicule_1');__panne=false;});
  check('Panne : saisie conservée, bouton réactivé, aucun faux succès',await page.locator('#completer-champ-vehicule_1_immatriculation').inputValue()==='TEST-QA-CLAUDE-HELIXCAR plaque' && await page.locator('[data-enregistrer-groupe="vehicule_1"]').isEnabled() && (await page.locator('#completer-message').textContent()).includes("n'a pas abouti"));
  await page.evaluate(async()=>{__zero=true;await envoyerInformationsCompletees('vehicule_1');__zero=false;});
  check('Zéro écriture : jamais un succès malgré HTTP 200',(await page.locator('#completer-message').textContent()).includes('Aucune nouvelle information enregistrée'));
  await page.evaluate(async()=>{__panneRelecture=true;await envoyerInformationsCompletees('vehicule_1');__panneRelecture=false;});
  check('Relecture impossible : confirmation limitée, pas de dossier Complet',(await page.locator('#completer-message').textContent()).includes('ne peut pas être relu') && await page.locator('#completer-complet').count()===0);
  await page.evaluate(()=>ouvrirCompleterInformations('TEST-QA-CLAUDE-HELIXCAR-D2'));
  check('Réouverture : champ réellement transmis non redemandé',await page.locator('#completer-champ-vehicule_1_immatriculation').count()===0 && await page.locator('#completer-champ-vehicule_2_immatriculation').count()===1);
  await ouvrir(2);
  await page.locator('#completer-champ-vehicule_1_immatriculation').fill('TEST-QA-CLAUDE-HELIXCAR plaque');
  await page.evaluate(async()=>{await Promise.all([envoyerInformationsCompletees('vehicule_1'),envoyerInformationsCompletees('vehicule_1')]);});
  check('Double clic : une seule demande de sauvegarde',await page.evaluate(()=>__appels.length===1));
  check('Mobile : libellés et actions restent dans la largeur visible',await page.locator('[data-enregistrer-groupe]').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().right<=window.innerWidth+1)));
  check('Aucune exception JavaScript',errors.length===0);
 }finally{await browser.close();}
 console.log('=== '+pass+' PASS / '+fail+' FAIL ===');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
