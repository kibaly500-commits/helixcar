// Fiche écrite uniquement, serveur simulé et réseau externe bloqué par env.js.
const assert=require('assert');
const {lancerNavigateur,urlFichier}=require('./env.js');
(async()=>{
 const browser=await lancerNavigateur();
 try {
  const p=await browser.newPage();
  await p.goto(urlFichier('dashboard.html'));
  await p.evaluate(()=>{
   window.__client={id:'QA-RECAP',prenom:'TEST',nom:'Récapitulatif',type_service:'convoyage',type_client:'part',nb_vehicules:2,trajet_commun:false};
   window.__vehicles=[1,2].map(i=>({position:i,marque_modele:'Modèle '+i,immatriculation:'QA-'+i,vin:'VIN-'+i,date_prise_en_charge:'2026-10-01',date_livraison:'2026-10-02',pc_contact_nom:'Départ '+i,pc_contact_tel:'061000000'+i,liv_contact_nom:'Livraison '+i,liv_contact_tel:'062000000'+i,restitution_concernee:true,restit_contact_nom:'Retour '+i,restit_contact_tel:'063000000'+i,restit_vin:'RETOUR-VIN-'+i,restit_immatriculation:'RETOUR-'+i}));
   window.__infos=[];window.__erreur=false;window.__delay=0;
   _demandesDevisListe=[{...__client,_vehicules:[]}];_devisParClient={};
   sbFetch=async function(path){await new Promise(r=>setTimeout(r,__delay));if(__erreur)throw Error('Réseau');return path.startsWith('clients?')?[JSON.parse(JSON.stringify(__client))]:[];};
   sbFetchToutePage=async()=>JSON.parse(JSON.stringify(__vehicles));
   chargerInfosDemandeAdmin=async()=>__infos;
   _marquerDemandeVue=()=>{};rendreInfosDemandeAdmin=async()=>{};_afficherJournalEnvois=()=>{};
  });
  await p.evaluate(()=>ouvrirFicheDemande('QA-RECAP'));
  let contenu=await p.locator('#fiche-demande-corps').textContent();
  for(const i of [1,2])for(const prefix of ['061000000','062000000','063000000','VIN-','RETOUR-VIN-'])assert(contenu.includes(prefix+i),'Information absente : '+prefix+i);
  console.log('PASS contacts, téléphones et VIN de chaque véhicule dans la fiche');
  await p.evaluate(async()=>{
   deciderInformation=async()=>{__vehicles[0].pc_contact_tel='0699999999';__infos=[{cle:'stockage_ville',libelle:'Ville de stockage',valeur:'Ville validée',statut:'validee'}];return true;};
   await changerDecisionInformation('QA-RECAP','vehicule_1_contact_pc_tel','validee');
  });
  contenu=await p.locator('#fiche-demande-corps').textContent();
  assert(contenu.includes('0699999999')&&!contenu.includes('0610000001'));
  assert(contenu.includes('Ville validée'));
  assert(await p.evaluate(()=>_demandesDevisListe[0]._vehicules.length===0),'La source des PDF a été modifiée');
  console.log('PASS validation actualisée sans modifier la source des PDF');
  await p.evaluate(async()=>{__erreur=true;await ouvrirFicheDemande('QA-RECAP');});
  assert((await p.locator('#fiche-demande-corps').textContent()).includes('Impossible de charger'));
  assert(!(await p.locator('#fiche-demande-corps').textContent()).includes('0699999999'));
  console.log('PASS échec de relecture sans récapitulatif ancien présenté comme actualisé');
  await p.evaluate(async()=>{__erreur=false;__delay=80;const attente=ouvrirFicheDemande('QA-RECAP');closeModal('fiche-demande');await attente;});
  assert(!await p.locator('#modal-fiche-demande').evaluate(el=>el.classList.contains('open')));
  console.log('PASS fermeture pendant le chargement respectée');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
