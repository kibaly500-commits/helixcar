// O01 — vrai Dashboard, contrat Supabase simulé et réseau extérieur coupé.
// Ces preuves portent sur l'UI, pas sur la RLS ni la réception d'e-mails.
// Les règles SQL sont exercées séparément par tests/rls/o01.sh.
const { lancerNavigateur, urlFichier } = require('./env.js');
const capturerQA=require('./preuves-qa.js');
let pass = 0, fail = 0;
function check(label, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' - ' + label + (!ok && detail ? ' [' + detail + ']' : ''));
  ok ? pass++ : fail++;
}

const INIT = `
window.__journal = [];
window.__erreur = false;
window.__confirmer = true;
window.__reponseCandidature = null;
window.__reponseDecision = null;
window.__opportunites = [
  {id:'TEST-QA-CLAUDE-HELIXCAR-brouillon',statut:'brouillon',intitule:'TEST-QA-CLAUDE-HELIXCAR Nettoyage',categorie:'nettoyage',badges_requis:['nettoyage'],date_debut:'2026-11-12',date_fin:'2026-11-13',duree_texte:'2 jours',zone_generale:'Lyon',description_publique:'Préparation automobile',nb_professionnels:9,nb_retenus:0,mission_reference:'TEST-QA-CLAUDE-HELIXCAR-M1'},
  {id:'TEST-QA-CLAUDE-HELIXCAR-ouverte',statut:'a_pourvoir',intitule:'TEST-QA-CLAUDE-HELIXCAR Renfort',categorie:'renfort',badges_requis:['renfort'],date_debut:'2026-11-14',date_fin:'2026-11-14',zone_generale:'Rhône',description_publique:'Accompagnement sur site',nb_professionnels:9,nb_retenus:6,nb_a_etudier:1,mission_reference:'TEST-QA-CLAUDE-HELIXCAR-M2',publiee_le:'2026-09-10T10:00:00Z',nom_client:'CLIENT_CONFIDENTIEL',email:'SECRET@helixcar.test',telephone:'0600000099',adresse_exacte:'12 RUE CONFIDENTIELLE',remuneration:9876}
];
window.__partenaire = [window.__opportunites[1]];
window.__candidatures = [{id:'TEST-QA-CLAUDE-HELIXCAR-candidature',opportunite_id:'TEST-QA-CLAUDE-HELIXCAR-ouverte',convoyeur_id:'TEST-QA-CLAUDE-HELIXCAR-partenaire',etat:'a_etudier',created_at:'2026-09-10T11:00:00Z'}];
window.confirm = function () { return window.__confirmer; };
function table(nom) {
  const filtres = {};
  const q = {
    select(){return q;}, eq(c,v){filtres[c]=v;return q;}, order(){return q;}, limit(){return q;},
    then(resolve) {
      window.__journal.push({lecture:nom});
      const lignes = nom==='v_opportunites_admin' ? window.__opportunites : nom==='v_opportunites_partenaire' ? window.__partenaire : nom==='opportunite_candidatures' ? window.__candidatures : [];
      return Promise.resolve(window.__erreur ? {data:null,error:{message:'SQL 23514 details secrets'}} : {data:lignes.filter(o=>Object.keys(filtres).every(c=>o[c]===filtres[c])).map(o=>({...o})),error:null}).then(resolve);
    }
  }; return q;
}
window.supabase = {createClient(){return {
  auth:{onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},getSession:async()=>({data:{session:{access_token:'TEST-QA-CLAUDE-HELIXCAR-token',user:{id:'TEST-QA-CLAUDE-HELIXCAR-user'}}}}),signOut:async()=>({})},
  from:table,
  rpc:async function(nom,params){
    window.__journal.push({rpc:nom,params});
    if(window.__erreur) return {data:null,error:{message:'SQL 23514 details secrets'}};
    const o=window.__opportunites.find(o=>o.id===params.p_id || o.id===params.p_opportunite_id);
    if(nom==='modifier_opportunite'){ Object.assign(o,params.p_champs); return {data:{ok:true,code:'MODIFIEE'},error:null}; }
    if(nom==='publier_opportunite'){ o.statut='a_pourvoir';o.publiee_le='2026-09-10T12:00:00Z';return {data:{ok:true,code:'PUBLIEE',notifications_a_envoyer:2},error:null}; }
    if(nom==='postuler_opportunite'){
      await new Promise(r=>setTimeout(r,40));
      const r=window.__reponseCandidature;
      if(r) return {data:r,error:null};
      o.ma_candidature_etat='a_etudier';o.ma_candidature_le='2026-09-10T12:00:00Z';
      return {data:{ok:true,code:'CANDIDATURE_ENREGISTREE'},error:null};
    }
    if(nom==='decider_candidature'){
      if(window.__reponseDecision) return {data:window.__reponseDecision,error:null};
      const c=window.__candidatures.find(c=>c.id===params.p_candidature_id);
      c.etat=params.p_etat;
      return {data:{ok:true,code:'DECIDEE',etat:c.etat,retenus:6,requis:9},error:null};
    }
    return {data:null,error:null};
  }
};}};
const vraiFetch=window.fetch;
window.fetch=function(url){
  if(String(url).includes('/rest/v1/')) return Promise.resolve({ok:true,status:200,headers:{get:()=> 'items 0-0/0'},text:async()=> '[]'});
  return vraiFetch.apply(window,arguments);
};
`;

(async () => {
  const browser = await lancerNavigateur();
  try {
    const page = await browser.newPage({viewport:{width:1280,height:1000}});
    const erreurs = [];
    page.on('pageerror', e => erreurs.push(e.message));
    await page.addInitScript(INIT);
    await page.goto(urlFichier('dashboard.html'), {waitUntil:'load'});
    await page.evaluate(() => {
      sbFetchToutePage = async () => [{id:'TEST-QA-CLAUDE-HELIXCAR-partenaire',prenom:'TEST-QA-CLAUDE-HELIXCAR',nom:'Partenaire',activites:['renfort'],statut:'actif'}];
      document.getElementById('app').classList.add('visible');
      // Précondition de cette suite composant : session déjà autorisée.
      // La connexion/RLS est testée ailleurs ; le masque ne doit pas
      // recouvrir les composants et fausser leurs captures.
      document.getElementById('login-screen').style.display='none';
    });
    const nav = await page.evaluate(() => ({admin:NAVS.admin.map(o=>o.id),client:NAVS.client.map(o=>o.id),partenaire:NAVS.convoyeur.map(o=>o.id)}));
    check('A1 : rubrique admin déclarée', nav.admin.includes('admin-opportunites'));
    check('A2 : rubrique partenaire déclarée', nav.partenaire.includes('convoyeur-opportunites'));
    check('A3 : aucune rubrique opportunités dans la navigation client', !nav.client.some(id=>id.includes('opportunites')));

    await page.evaluate(() => loadOpportunitesAdmin());
    let html = await page.locator('#opportunites-table').innerHTML();
    check('A4 : références issues de la vue admin', html.includes('TEST-QA-CLAUDE-HELIXCAR-M1') && html.includes('TEST-QA-CLAUDE-HELIXCAR-M2'));
    check('A5 : 6 retenus sur 9 reste À pourvoir', /6 professionnels retenus sur 9/.test(html) && /À pourvoir/.test(html) && !/partiellement/i.test(html));
    check('A6 : brouillon distinct des états publiés', /Brouillon/.test(html));
    await page.evaluate(() => ouvrirOpportuniteAdmin('TEST-QA-CLAUDE-HELIXCAR-brouillon'));
    check('B1 : formulaire prérempli depuis la mission', await page.locator('#opp-intitule').inputValue() === 'TEST-QA-CLAUDE-HELIXCAR Nettoyage');
    check('B2 : aperçu sans publication implicite', !(await page.evaluate(()=>__journal.some(x=>x.rpc==='publier_opportunite'))));
    await page.locator('#opp-description').fill('TEST-QA-CLAUDE-HELIXCAR Description corrigée');
    check('B3 : aperçu suit la saisie', (await page.locator('#opp-apercu').textContent()).includes('Description corrigée'));
    await page.evaluate(() => enregistrerOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon'));
    check('B4 : enregistrement serveur invoqué avec la bonne identité', await page.evaluate(()=>__journal.some(x=>x.rpc==='modifier_opportunite' && x.params.p_id==='TEST-QA-CLAUDE-HELIXCAR-brouillon' && x.params.p_champs.description_publique.includes('Description corrigée'))));
    check('B5 : confirmation après réponse serveur', (await page.locator('#opportunite-message').textContent()).includes('Brouillon enregistré'));
    await page.evaluate(async () => {__erreur=true;await enregistrerOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon');__erreur=false;});
    let message = await page.locator('#opportunite-message').textContent();
    check('B6 : erreur réseau sans SQL ni faux succès', /pas pu être enregistré/.test(message) && !/SQL|23514|Brouillon enregistré/.test(message));
    await page.evaluate(async () => {__confirmer=false;await publierOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon');__confirmer=true;});
    check('B7 : annuler la confirmation ne publie rien', !(await page.evaluate(()=>__journal.some(x=>x.rpc==='publier_opportunite'))));
    await page.evaluate(() => publierOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon'));
    check('B8 : publication relue, formulaire de brouillon retiré', await page.locator('#opportunite-form').count() === 0 && (await page.locator('#opportunite-titre').textContent()).includes('À pourvoir'));
    check('B9 : confirmation de publication reste visible après relecture', (await page.locator('#opportunite-message').textContent()).includes('visible par les partenaires'));

    await page.evaluate(() => ouvrirOpportuniteAdmin('TEST-QA-CLAUDE-HELIXCAR-ouverte'));
    check('C1 : quatre étapes de candidature', await page.locator('[data-pipeline]').count() === 4);
    check('C2 : profil partenaire accessible dans la candidature', (await page.locator('[data-candidature]').textContent()).includes('Profil'));
    await page.evaluate(() => deciderCandidature('TEST-QA-CLAUDE-HELIXCAR-candidature','preselectionne'));
    check('C3 : présélection apparaît après relecture serveur', await page.locator('[data-pipeline="preselectionne"] [data-candidature]').count() === 1);
    check('C4 : confirmation de décision reste visible après relecture', (await page.locator('#opportunite-message').textContent()).includes('Décision enregistrée'));
    await page.evaluate(async () => {__reponseDecision={ok:false,code:'PLACES_EPUISEES',retenus:9,requis:9};await deciderCandidature('TEST-QA-CLAUDE-HELIXCAR-candidature','retenu');});
    check('C5 : refus concurrent demeure lisible, sans fausse sélection', (await page.locator('#opportunite-message').textContent()).includes('Toutes les places') && await page.locator('[data-pipeline="preselectionne"] [data-candidature]').count() === 1);
    await page.evaluate(() => closeModal('opportunite'));

    await page.evaluate(async () => {
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      document.getElementById('page-convoyeur-opportunites').classList.add('active');
      await loadOpportunitesPartenaire();
    });
    html = await page.locator('#convoyeur-opportunites-liste').innerHTML();
    check('D1 : carte avec zone, badge et mission indépendante', /Rhône/.test(html) && /Renfort automobile/.test(html) && /Mission indépendante/.test(html));
    check('D2 : aucune propriété confidentielle supplémentaire rendue', !/CLIENT_CONFIDENTIEL|SECRET@|0600000099|12 RUE CONFIDENTIELLE|9876/.test(html));
    check('D3 : bouton Postuler unique', await page.locator('#convoyeur-opportunites-liste button').count() === 1);
    await capturerQA(page,'o01-opportunite-desktop','#convoyeur-opportunites-liste');
    await page.evaluate(async () => {__erreur=true;await postulerOpportunite('TEST-QA-CLAUDE-HELIXCAR-ouverte');__erreur=false;});
    message = await page.locator('#opp-msg-TEST-QA-CLAUDE-HELIXCAR-ouverte').textContent();
    check('D4 : erreur française, sans détail SQL ni succès', /pas abouti/.test(message) && !/SQL|23514|est enregistrée/.test(message));
    check('D5 : erreur transport autorise une reprise', await page.locator('#opp-postuler-TEST-QA-CLAUDE-HELIXCAR-ouverte').isEnabled());
    await page.evaluate(async () => {__reponseCandidature={ok:false,code:'CLOTUREE'};await postulerOpportunite('TEST-QA-CLAUDE-HELIXCAR-ouverte');});
    check('D6 : clôture concurrente expliquée sans fausse candidature', (await page.locator('#opp-msg-TEST-QA-CLAUDE-HELIXCAR-ouverte').textContent()).includes('plus de candidature'));
    await page.waitForTimeout(800);
    await page.evaluate(()=>{__reponseCandidature=null;__journal=[];const b=document.getElementById('opp-postuler-TEST-QA-CLAUDE-HELIXCAR-ouverte');b.click();b.click();});
    await page.waitForTimeout(100);
    check('D7 : double clic DOM ne produit qu’un appel', await page.evaluate(()=>__journal.filter(x=>x.rpc==='postuler_opportunite').length) === 1);
    check('D8 : succès affiché après confirmation serveur', (await page.locator('#opp-msg-TEST-QA-CLAUDE-HELIXCAR-ouverte').textContent()).includes('est enregistrée'));
    await page.waitForTimeout(750);
    check('D9 : état relu et nouvelle candidature impossible', await page.locator('[data-ma-candidature="a_etudier"]').count() === 1 && await page.locator('#opp-postuler-TEST-QA-CLAUDE-HELIXCAR-ouverte').count() === 0);
    await page.setViewportSize({width:390,height:844});
    check('D10 : carte partenaire visible sans débordement mobile', await page.locator('#convoyeur-opportunites-liste .opp-carte').isVisible() && await page.locator('#convoyeur-opportunites-liste .opp-carte').evaluate(el=>el.clientWidth>0 && el.scrollWidth<=el.clientWidth+1));
    await capturerQA(page,'o01-candidature-mobile','#convoyeur-opportunites-liste');
    await page.evaluate(async()=>{__partenaire=[];await loadOpportunitesPartenaire();});
    check('D11 : état vide réel', (await page.locator('#convoyeur-opportunites-liste').textContent()).includes('Aucune opportunité disponible'));
    await page.evaluate(async()=>{__erreur=true;await loadOpportunitesPartenaire();__erreur=false;});
    check('D12 : erreur de lecture distincte d’une liste vide', (await page.locator('#convoyeur-opportunites-liste').textContent()).includes('Impossible de charger'));
    check('E1 : aucune exception JavaScript', erreurs.length===0, erreurs.join('; '));
  } finally { await browser.close(); }
  console.log('=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  process.exitCode = fail ? 1 : 0;
})().catch(e=>{console.error(e);process.exitCode=1;});
