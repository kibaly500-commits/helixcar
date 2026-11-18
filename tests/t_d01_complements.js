// Soumission globale, sur l'UI réelle et un
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
  if(n==='contexte_completion_demande')return {data:{verrouillee:false},error:null};
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
  async function transmettre(){
   await page.locator('.hc-completion-confirm [data-confirm]').click();
   await page.waitForFunction(()=>!_completerEnvoiEnCours && !_completerConfirmationEnCours);
  }
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('index.html'),{waitUntil:'load'});
  async function ouvrir(n){await page.evaluate(async n=>{
   sessionStorage.clear();__lignes=[];__appels=[];__panne=false;__zero=false;__panneRelecture=false;
   for(let i=1;i<=n;i++)__lignes.push(
    {cle:'vehicule_'+i+'_marque_modele',libelle:'Marque et modèle',statut:'fournie',valeur:'TEST-QA-CLAUDE-HELIXCAR véhicule '+i},
    {cle:'vehicule_'+i+'_immatriculation',libelle:'immatriculation',statut:'attendue',valeur:null});
   await ouvrirCompleterInformations('TEST-QA-CLAUDE-HELIXCAR-D'+n);
  },n);}
  for(const n of [1,2,3,5]){
   await ouvrir(n);
   check(n+' véhicules : première fiche ouverte et un seul envoi',await page.locator('.completion-card[open]').count()===1 && await page.locator('[data-enregistrer-groupe]').count()===0 && await page.locator('#completer-envoyer').isVisible());
   check(n+' véhicules : seules les immatriculations manquantes sont éditables',await page.locator('#completer-rubriques input').count()===n);
   await page.locator('#completer-champ-vehicule_1_immatriculation').fill('TEST-QA plaque1');
   check(n+' véhicules : libellé de validation clair',(await page.locator('#completer-envoyer').textContent())==='Valider mes informations');
   check(n+' véhicules : progression actualisée',(await page.locator('#completer-progression strong').textContent())==='1 / '+n+' véhicules complets');
   check(n+' véhicules : premier bloc prêt',(await page.locator('[data-groupe="vehicule_1"] .completer-etat').textContent())==='Complet — prêt à envoyer');
   if(n>1){
    check(n+' véhicules : envoi partiel désactivé',await page.locator('#completer-envoyer').isDisabled());
    check(n+' véhicules : autres blocs signalés',(await page.locator('#completer-guide').textContent()).includes('Véhicule 2'));
    await page.evaluate(()=>envoyerInformationsCompletees());
    check(n+' véhicules : appel direct partiel refusé',await page.evaluate(()=>__appels.length===0));
    for(let i=2;i<=n;i++){await page.locator('summary[data-groupe="vehicule_'+i+'"]').click();await page.locator('#completer-champ-vehicule_'+i+'_immatriculation').fill('TEST-QA plaque'+i);}
   }
   check(n+' véhicules : validation active seulement après complétion',await page.locator('#completer-envoyer').isEnabled() && (await page.locator('#completer-guide').textContent()).includes('Tous les blocs sont complets'));
   await page.locator('#completer-envoyer').click();
   await page.locator('.hc-completion-confirm [data-cancel]').click();
   check(n+' véhicules : confirmation annulée sans envoi',await page.evaluate(()=>__appels.length===0));
   await page.locator('#completer-envoyer').click();
   await transmettre();
   check(n+' véhicules : toutes les saisies transmises ensemble',await page.evaluate(n=>__appels.length===1 && Object.keys(__appels[0].p_reponses).length===n,n));
   check(n+' véhicules : aucun champ transmis redemandé',await page.locator('#completer-rubriques input').count()===0);
   check(n+' véhicules : confirmation après relecture',(await page.locator('#completer-complet').textContent()).includes('en attente de validation'));
  }
  await ouvrir(2);
  await page.locator('#completer-champ-vehicule_1_immatriculation').fill('TEST-QA-CLAUDE-HELIXCAR plaque');
  await page.evaluate(()=>ouvrirCompleterInformations('TEST-QA-CLAUDE-HELIXCAR-D2'));
  check('Brouillon restauré sans soumission',await page.locator('#completer-champ-vehicule_1_immatriculation').inputValue()==='TEST-QA-CLAUDE-HELIXCAR plaque' && await page.evaluate(()=>__appels.length===0));
  await page.locator('summary[data-groupe="vehicule_2"]').click();await page.locator('#completer-champ-vehicule_2_immatriculation').fill('TEST-QA plaque2');
  await page.evaluate(()=>{__panne=true;envoyerInformationsCompletees();});await transmettre();await page.evaluate(()=>{__panne=false;});
  check('Panne : saisie conservée, bouton réactivé, aucun faux succès',await page.locator('#completer-champ-vehicule_1_immatriculation').inputValue()==='TEST-QA-CLAUDE-HELIXCAR plaque' && await page.locator('#completer-envoyer').isEnabled() && (await page.locator('#completer-message').textContent()).includes("n'a pas abouti"));
  await page.evaluate(()=>{__zero=true;envoyerInformationsCompletees();});await transmettre();await page.evaluate(()=>{__zero=false;});
  check('Zéro écriture : jamais un succès malgré HTTP 200',(await page.locator('#completer-message').textContent()).includes('Aucune nouvelle information enregistrée'));
  await page.evaluate(()=>{__panneRelecture=true;envoyerInformationsCompletees();});await transmettre();await page.evaluate(()=>{__panneRelecture=false;});
  check('Relecture impossible : confirmation limitée, pas de dossier Complet',(await page.locator('#completer-message').textContent()).includes('ne peut pas être relu') && await page.locator('#completer-complet').count()===0);
  await page.evaluate(()=>ouvrirCompleterInformations('TEST-QA-CLAUDE-HELIXCAR-D2'));
  check('Réouverture : champs réellement transmis non redemandés',await page.locator('#completer-rubriques input').count()===0);
  await ouvrir(2);
  await page.locator('#completer-champ-vehicule_1_immatriculation').fill('TEST-QA-CLAUDE-HELIXCAR plaque');
  await page.locator('summary[data-groupe="vehicule_2"]').click();await page.locator('#completer-champ-vehicule_2_immatriculation').fill('TEST-QA plaque2');
  await page.evaluate(()=>{envoyerInformationsCompletees();envoyerInformationsCompletees();});await transmettre();
  check('Double clic : une seule demande de sauvegarde',await page.evaluate(()=>__appels.length===1));
  check('Mobile : libellés et actions restent dans la largeur visible',await page.locator('#completer-envoyer').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().right<=window.innerWidth+1)));
  check('Aucune exception JavaScript',errors.length===0);
  await page.evaluate(()=>document.body.classList.add('hc-integre','hc-mode-completion'));
  for(const width of [390,780,1280]){
   await page.setViewportSize({width,height:900});
   check('Complétion intégrée '+width+'px : fond blanc et largeur complète',await page.locator('#modal-completer .modal').evaluate(el=>{
    const r=el.getBoundingClientRect(),s=getComputedStyle(el);
    return s.backgroundColor==='rgb(255, 255, 255)' && r.width>=innerWidth-2 && r.right<=innerWidth+1;
   }));
   await page.screenshot({path:'/tmp/hc-completion-blanche-'+width+'.png'});
  }
 }finally{await browser.close();}
 console.log('=== '+pass+' PASS / '+fail+' FAIL ===');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
