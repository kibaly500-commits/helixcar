// D01/X01 — véritable UI, stockage de recette simulé uniquement.
// Ne prouve ni Supabase distant, ni RLS, ni e-mail réellement reçu.
const {lancerNavigateur,urlFichier}=require('./env.js');
let pass=0,fail=0;
const check=(nom,ok)=>{console.log((ok?'PASS':'FAIL')+' - '+nom);ok?pass++:fail++;};
const INIT=`
window.__erreur=false;window.__appels=[];
window.__etat=JSON.parse(localStorage.getItem('TEST-QA-CLAUDE-HELIXCAR-eval')||'null')||{
 missions:[{id:'TEST-QA-CLAUDE-HELIXCAR-M1',reference:'TEST-QA-CLAUDE-HELIXCAR-M1',statut:'terminee',type_mission:'nettoyage',ville_intervention:'Lyon',prestation:'Préparation complète',convoyeur_prenom:'TEST-QA-CLAUDE-HELIXCAR Partenaire',evaluee:false},{id:'TEST-QA-CLAUDE-HELIXCAR-M2',reference:'TEST-QA-CLAUDE-HELIXCAR-M2',statut:'en_cours',type_mission:'convoyage',ville_depart:'Lyon',ville_arrivee:'Paris',evaluee:false}],evaluations:[]};
window.supabase={createClient(){return {
 auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},getSession:async()=>({data:{session:null}})},
 from(nom){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},then(r){return Promise.resolve(__erreur?{error:{message:'SQL 23514 details secrets'}}:{data:nom==='v_mes_missions'?__etat.missions:nom==='evaluations'?__etat.evaluations:[],error:null}).then(r);}};return q;},
 rpc:async function(nom,p){__appels.push({nom,p});await new Promise(r=>setTimeout(r,20));if(__erreur)return {error:{message:'SQL 23514 details secrets'}};
 const m=__etat.missions.find(m=>m.id===p.p_mission_id);
 if(!m||m.statut!=='terminee')return {data:{ok:false,code:'MISSION_NON_TERMINEE'}};
 if(m.evaluee)return {data:{ok:false,code:'DEJA_EVALUEE'}};
 m.evaluee=true;m.evaluation_note=20;__etat.evaluations.push({id:'TEST-QA-CLAUDE-HELIXCAR-E1',mission_id:m.id,note_totale:20,commentaire:p.p_commentaire,created_at:'2026-09-10T12:00:00Z'});
 localStorage.setItem('TEST-QA-CLAUDE-HELIXCAR-eval',JSON.stringify(__etat));return {data:{ok:true,code:'ENREGISTREE',note_totale:20}};
 }
};}};
`;
(async()=>{
 const browser=await lancerNavigateur();
 try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}});
  const erreurs=[];page.on('pageerror',e=>erreurs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto(urlFichier('dashboard.html'),{waitUntil:'load'});
  await page.evaluate(async()=>{await loadMissionsClient();await loadMissionsResumeClient();await loadEvaluationsClient();});
  check('A1 : liste de missions issue du serveur',await page.locator('#client-missions-table [data-mission]').count()===2);
  check('A2 : compteurs réels et exacts',await page.locator('#client-resume-en-cours').textContent()==='1' && await page.locator('#client-resume-terminees').textContent()==='1');
  check('A3 : seule la mission terminée attend une évaluation',await page.locator('#client-evaluations-a-faire [data-mission]').count()===1);
  check('A4 : historique réellement vide au départ',await page.locator('#client-evaluations-historique-vide').count()===1);
  await page.evaluate(()=>evaluerMissionClient('TEST-QA-CLAUDE-HELIXCAR-M1'));
  check('B1 : barème incomplet empêche tout envoi',await page.evaluate(()=>__appels.length===0));
  await page.evaluate(()=>EVALUATION_CRITERES.forEach(c=>choisirNoteEvaluation('TEST-QA-CLAUDE-HELIXCAR-M1',c.cle,c.max)));
  await page.locator('#eval-com-TEST-QA-CLAUDE-HELIXCAR-M1').evaluate(el=>{el.value='TEST-QA-CLAUDE-HELIXCAR <script>commentaire</script>';});
  await page.evaluate(async()=>{__erreur=true;await evaluerMissionClient('TEST-QA-CLAUDE-HELIXCAR-M1');__erreur=false;});
  let m=await page.locator('#eval-msg-TEST-QA-CLAUDE-HELIXCAR-M1').textContent();
  check('B2 : erreur sans faux succès ni SQL brut',m.includes('pas abouti')&&!/SQL|23514|est enregistrée/.test(m));
  check('B3 : saisie et notes conservées après échec',await page.locator('#eval-com-TEST-QA-CLAUDE-HELIXCAR-M1').inputValue()==='TEST-QA-CLAUDE-HELIXCAR <script>commentaire</script>' && await page.evaluate(()=>Object.keys(_evalNotes['TEST-QA-CLAUDE-HELIXCAR-M1']).length===6));
  await page.evaluate(async()=>{__appels=[];await Promise.all([evaluerMissionClient('TEST-QA-CLAUDE-HELIXCAR-M1'),evaluerMissionClient('TEST-QA-CLAUDE-HELIXCAR-M1')]);});
  check('B4 : double appel dédupliqué côté UI',await page.evaluate(()=>__appels.length===1 && __etat.evaluations.length===1));
  check('B5 : confirmation après réponse métier positive',(await page.locator('#eval-msg-TEST-QA-CLAUDE-HELIXCAR-M1').textContent()).includes('est enregistrée'));
  await page.waitForTimeout(1000);
  check('B6 : mission retirée de À évaluer après relecture',await page.locator('#client-evaluations-a-faire [data-mission]').count()===0);
  check('B7 : texte Aucune évaluation en cours',(await page.locator('#client-evaluations-a-faire').textContent()).includes('Aucune évaluation en cours'));
  check('B8 : historique lié à la référence de mission',(await page.locator('#client-evaluations-historique').textContent()).includes('TEST-QA-CLAUDE-HELIXCAR-M1'));
  check('B9 : commentaire échappé, aucun script injecté',await page.locator('#client-evaluations-historique script').count()===0 && (await page.locator('#client-evaluations-historique').textContent()).includes('<script>commentaire</script>'));
  await page.reload({waitUntil:'load'});
  await page.evaluate(()=>loadEvaluationsClient());
  check('C1 : rechargement relit la persistance du double',await page.locator('#client-evaluations-a-faire [data-mission]').count()===0 && (await page.locator('#client-evaluations-historique').textContent()).includes('20/20'));
  await page.evaluate(async()=>{__erreur=true;await loadEvaluationsClient();});
  check('C2 : lecture en erreur ne prétend pas que tout est vide',(await page.locator('#client-evaluations-a-faire').textContent()).includes('Impossible de charger'));
  await page.evaluate(()=>{sbFetchToutePage=async()=>[];loadRecontacts();});
  await page.waitForTimeout(50);
  check('X1 : recontacts sans données → état vide réel',(await page.locator('#recontacts-table').textContent()).includes('Aucune demande de recontact'));
  await page.evaluate(()=>{sbFetchToutePage=async()=>{throw new Error('SQL details');};loadRecontacts();});
  await page.waitForTimeout(50);
  check('X2 : refus de lecture signalé sans données de démonstration',(await page.locator('#recontacts-table').textContent()).includes('Impossible de charger'));
  check('X3 : aucune exception JavaScript',erreurs.length===0);
 }finally{await browser.close();}
 console.log('=== '+pass+' PASS / '+fail+' FAIL ===');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
