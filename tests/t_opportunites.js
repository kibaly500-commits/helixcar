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
    check('A4 : seules les missions publiées sont listées', !html.includes('TEST-QA-CLAUDE-HELIXCAR-M1') && html.includes('TEST-QA-CLAUDE-HELIXCAR-M2'));
    check('A5 : 6 retenus sur 9 reste À pourvoir', /6 professionnels retenus sur 9/.test(html) && /À pourvoir/.test(html) && !/partiellement/i.test(html));
    check('A6 : aucun brouillon dans la liste', !/Brouillon/.test(html));
    await page.evaluate(() => ouvrirOpportuniteAdmin('TEST-QA-CLAUDE-HELIXCAR-brouillon'));
    check('B1 : formulaire prérempli depuis la mission', await page.locator('#opp-intitule').inputValue() === 'TEST-QA-CLAUDE-HELIXCAR Nettoyage');
    check('B2 : aperçu sans publication implicite', !(await page.evaluate(()=>__journal.some(x=>x.rpc==='publier_opportunite'))));
    await page.locator('#opp-description').fill('TEST-QA-CLAUDE-HELIXCAR Description corrigée');
    check('B3 : aperçu suit la saisie', (await page.locator('#opp-apercu').textContent()).includes('Description corrigée'));
    await page.evaluate(() => enregistrerOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon'));
    check('B4 : enregistrement serveur invoqué avec la bonne identité', await page.evaluate(()=>__journal.some(x=>x.rpc==='modifier_opportunite' && x.params.p_id==='TEST-QA-CLAUDE-HELIXCAR-brouillon' && x.params.p_champs.description_publique.includes('Description corrigée'))));
    await page.evaluate(() => loadOpportunitesAdmin());
    check('B4bis : enregistrer ne fait pas apparaître la mission', !(await page.locator('#opportunites-table').innerHTML()).includes('TEST-QA-CLAUDE-HELIXCAR-M1'));
    check('B5 : confirmation après réponse serveur', (await page.locator('#opportunite-message').textContent()).includes('Brouillon enregistré'));
    await page.evaluate(async () => {__erreur=true;await enregistrerOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon');__erreur=false;});
    let message = await page.locator('#opportunite-message').textContent();
    check('B6 : erreur réseau sans SQL ni faux succès', /pas pu être enregistré/.test(message) && !/SQL|23514|Brouillon enregistré/.test(message));
    await page.evaluate(async () => {__confirmer=false;await publierOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon');__confirmer=true;});
    check('B7 : annuler la confirmation ne publie rien', !(await page.evaluate(()=>__journal.some(x=>x.rpc==='publier_opportunite'))));
    await page.evaluate(() => publierOpportunite('TEST-QA-CLAUDE-HELIXCAR-brouillon'));
    check('B8 : publication relue, formulaire de brouillon retiré', await page.locator('#opportunite-form').count() === 0 && (await page.locator('#opportunite-titre').textContent()).includes('À pourvoir'));
    await page.evaluate(() => loadOpportunitesAdmin());
    check('B8bis : publication fait apparaître la mission', (await page.locator('#opportunites-table').innerHTML()).includes('TEST-QA-CLAUDE-HELIXCAR-M1'));
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
    check('D3a : le bouton classique conserve son action et son identifiant',
      await page.locator('#opp-postuler-TEST-QA-CLAUDE-HELIXCAR-ouverte').getAttribute('data-hc-action') === 'postulerOpportunite'
      && await page.locator('#opp-postuler-TEST-QA-CLAUDE-HELIXCAR-ouverte').getAttribute('data-hc-a0') === 'TEST-QA-CLAUDE-HELIXCAR-ouverte');
    check('D3b : une ancienne opportunité directe exige aussi une candidature', await page.evaluate(()=>{
      const host=document.createElement('div');
      host.innerHTML=_oppCarteHtml({...__partenaire[0],acceptation_directe:true},{partenaire:true});
      const b=host.querySelector('button');
      return b.dataset.hcAction==='postulerOpportunite' && b.dataset.hcA0===__partenaire[0].id;
    }));
    check('Présélection interne : affichage partenaire inchangé', await page.evaluate(()=>{
      const carte=etat=>_oppCarteHtml({...__partenaire[0],ma_candidature_etat:etat},{partenaire:true});
      return carte('a_etudier')===carte('preselectionne') && carte('preselectionne').includes('Candidature envoyée');
    }));
    check('Présélection reste visible pour admin',await page.evaluate(()=>_libEtatCandidature('preselectionne',{})==='Présélectionné'));
    check('Décisions finales visibles au professionnel',await page.evaluate(()=>_libEtatCandidaturePartenaire('retenu',{})==='Retenu'&&_libEtatCandidaturePartenaire('non_retenu',{})==='Non retenu'));
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
    check('D12 : erreur de lecture distincte d’une liste vide', (await page.locator('#convoyeur-opportunites-liste').textContent()).includes('Les opportunités sont momentanément indisponibles. Utilisez Actualiser pour reprendre.'));
    for (const width of [1280,390]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(async()=>{
        window._currentConvoyeur={id:'test-pro'};
        window.__missions=['acceptee','en_cours','edl_termine','fini','terminee','annulee'].map((statut,i)=>({id:'m'+i,convoyeur_id:'test-pro',reference:'REF-'+i,statut,type_mission:'convoyage',ville_depart:'Paris',ville_arrivee:'Lyon'}));
        __missions.push({id:'intrus',convoyeur_id:'autre',statut:'en_cours',ville_depart:'SECRET-AUTRE'}, {id:'libre',convoyeur_id:null,statut:'en_attente',ville_depart:'NON-ATTRIBUEE'});
        sbFetchToutePage=async()=>__missions;
        currentRole='convoyeur';buildNav('convoyeur');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.getElementById('page-convoyeur-missions').classList.add('active');
        await loadMissionsConvoyeur();await loadDashboardMissionsPreview();
      });
      const texte=await page.locator('#conv-missions-table').innerText();
      check('Mes missions : groupes en cours, réalisées et historique '+width,['À réaliser et en cours','Réalisées — en attente','Historique — missions terminées'].every(t=>texte.includes(t)));
      check('Mes missions : aucun autre compte ni mission libre '+width,!/SECRET-AUTRE|NON-ATTRIBUEE/.test(texte));
      check('Mes missions : aucune acceptation ni candidature '+width,!/Postuler|Accepter/.test(texte));
      check('Mes missions : actions opérationnelles conservées '+width,texte.includes('État des lieux départ')&&texte.includes('Envoyer la lettre signée'));
      check('Mes missions : six missions attribuées '+width,await page.locator('#conv-missions-table tr:not(.mes-missions-section)').count()===6);
      check('Mes missions : navigation unifiée '+width,await page.evaluate(()=>NAVS.convoyeur.some(x=>x.label==='Mes missions')&&!NAVS.convoyeur.some(x=>x.id==='convoyeur-historique')));
      check('Accueil : uniquement missions encore à réaliser '+width,await page.locator('#conv-dashboard-missions-preview .mission-card').count()===3);
      check('Mes missions : aucun débordement '+width,await page.locator('#conv-missions-table').evaluate(el=>el.closest('.table-wrap').scrollWidth<=el.closest('.table-wrap').clientWidth+1));
      await page.evaluate(async()=>{__missions=[];await loadMissionsConvoyeur()});
      check('Mes missions : état vide '+width,(await page.locator('#conv-missions-table').innerText()).includes('Aucune mission attribuée'));
    }
    for (const width of [1280,390]) {
      await page.setViewportSize({width,height:844});
      await page.evaluate(async()=>{
        window._currentConvoyeur={id:'test-pro'};
        window.__missions=['professionnel','nettoyage'].map((type_mission,i)=>({id:'inter'+i,reference:'INT-'+i,convoyeur_id:'test-pro',type_mission,statut:i?'en_cours':'acceptee',prestation:i?'Nettoyage flotte':'Diagnostic',adresse_intervention:'12 rue du Test',ville_intervention:'Noisy',date_intervention:'2026-11-01',date_fin_intervention:'2026-11-10',heure_debut_intervention:'08:30',heure_fin_intervention:'17:30',nb_vehicules:30,consignes:'Contrôler la flotte',remuneration_prevue:300,devis_source_id:'source'}));
        sbFetchToutePage=async path=>path.startsWith('missions?')?__missions:[];
        await loadMissionsConvoyeur();
      });
      let t=await page.locator('#conv-interventions-table').innerText();
      check('Interventions : détails et rémunération '+width,['Diagnostic','Nettoyage flotte','Noisy','08:30','17:30','300 €'].every(x=>t.includes(x)));
      check('Interventions : aucun clic de suivi obligatoire '+width,!/Commencer|Intervention terminée|photo|lieux départ|Lettre de voiture/i.test(t));
      check('Interventions : consignes masquées dans la liste '+width,!t.includes('Contrôler la flotte'));
      await page.locator('#conv-interventions-table summary').first().click();
      check('Interventions : détails accessibles '+width,(await page.locator('#conv-interventions-table').innerText()).includes('Contrôler la flotte'));
      await page.locator('#conv-interventions-table summary').first().click();
      check('Interventions : colonnes transport masquées '+width,!(await page.locator('#conv-missions-table').isVisible()));
      check('Interventions : largeur mobile '+width,await page.locator('#conv-interventions-table').evaluate(el=>el.closest('.table-wrap').scrollWidth<=el.closest('.table-wrap').clientWidth+1));
      await page.evaluate(async()=>{
        currentRole='admin';buildNav('admin');document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.getElementById('page-admin-autres-missions').classList.add('active');await loadMissions();
      });
      t=await page.locator('#interventions-table').innerText();
      check('Admin interventions : détails sans documents transport '+width,t.includes('Diagnostic')&&t.includes('Nettoyage flotte')&&!/Lettre|EDL|Photos/.test(t));
      check('Admin interventions : colonnes transport masquées '+width,!(await page.locator('#missions-table').isVisible()));
      await page.evaluate(async()=>{
        __missions.push({id:'conv',reference:'CONVOYAGE',type_mission:'convoyage',statut:'acceptee',convoyeur_id:'test-pro',ville_depart:'Paris',ville_arrivee:'Lyon'});await loadMissions();
      });
      check('Admin mixte : deux pages distinctes '+width,!(await page.locator('#missions-table').isVisible())&&await page.locator('#interventions-table').isVisible()&&await page.locator('#page-admin-missions #missions-table').count()===1);
      await page.evaluate(async()=>{__missions=[];await loadMissions()});
      check('Admin : état vide autres missions '+width,(await page.locator('#interventions-table').innerText()).includes('Aucune mission correspondant à cette vue'));
      await page.evaluate(()=>{currentRole='convoyeur';document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.getElementById('page-convoyeur-missions').classList.add('active')});
    }
    await page.evaluate(async()=>{
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.getElementById('page-admin-autres-missions').classList.add('active');
      __missions=[{id:'active',type_mission:'professionnel',reference:'M-active',reference_courte:'HC-2026-0001',statut:'en_cours'},{id:'archive',type_mission:'professionnel',reference:'M-old-longue',reference_courte:'HC-2026-0002',statut:'terminee'}];await loadMissions();
    });
    check('Actives : terminées retirées',!(await page.locator('#interventions-table').innerText()).includes('HC-2026-0002'));
    await page.locator('#missions-archives-autres').click();await page.waitForTimeout(250);
    check('Bouton Archives : terminées retrouvées',(await page.locator('#interventions-table').innerText()).includes('HC-2026-0002')&&!(await page.locator('#interventions-table').innerText()).includes('HC-2026-0001'));
    await page.locator('#missions-recherche-autres').fill('hc-2026-0002');await page.waitForTimeout(350);
    check('Recherche nouvelle référence',(await page.locator('#interventions-table').innerText()).includes('HC-2026-0002'));
    await page.locator('#missions-recherche-autres').fill('M-old-longue');await page.waitForTimeout(350);
    check('Recherche ancienne référence',(await page.locator('#interventions-table').innerText()).includes('HC-2026-0002'));
    await page.locator('#missions-recherche-autres').fill('introuvable');await page.waitForTimeout(350);
    check('Recherche sans résultat',(await page.locator('#interventions-table').innerText()).includes('Aucune mission correspondant'));
    const calendrier=await page.evaluate(()=>{
      const m={id:'date',convoyeur_id:'test-pro',statut:'acceptee',date_intervention:'2026-10-27',date_fin_intervention:'2026-10-28',heure_debut_intervention:'08:30',heure_fin_intervention:'17:30'};
      return ['2026-10-27T07:29:00Z','2026-10-27T07:30:00Z','2026-10-28T16:31:00Z'].map(t=>statutIntervention(m,new Date(t)).cle).concat(statutIntervention({...m,statut:'terminee'}).cle,statutIntervention({...m,convoyeur_id:null}).cle);
    });
    check('Calendrier Paris : avant, début, après, terminé et non attribué',JSON.stringify(calendrier)===JSON.stringify(['a_venir','en_cours','a_confirmer','terminee','acceptee']));
    const suivi=await page.evaluate(async()=>{
      const original=sbAuth.from, reload=loadMissionsConvoyeur, alerte=window.alert;
      let refresh=0, alerts=0, query, erreur=false;
      loadMissionsConvoyeur=async()=>{refresh++};window.alert=()=>{alerts++};
      sbAuth.from=()=>{query={};const q={update(v){query.update=v;return q},eq(k,v){query[k]=v;return q},in(k,v){query[k]=v;return q},select(){return q},single:async()=>erreur?{error:{message:'Refus'}}:{data:{id:'inter',statut:query.update.statut}}};return q};
      await avancerIntervention('inter','en_cours');const debut={...query};
      await avancerIntervention('inter','fini');const fin={...query};
      erreur=true;await avancerIntervention('inter','fini');
      sbAuth.from=original;loadMissionsConvoyeur=reload;window.alert=alerte;
      return {debut,fin,refresh,alerts};
    });
    check('Suivi : écriture bornée au professionnel, au type et au statut',suivi.debut.convoyeur_id==='test-pro'&&suivi.debut.statut==='acceptee'&&suivi.fin.statut==='en_cours'&&suivi.debut.type_mission.includes('nettoyage'));
    check('Suivi : aucun faux succès après refus serveur',suivi.refresh===2&&suivi.alerts===1);
    check('E1 : aucune exception JavaScript', erreurs.length===0, erreurs.join('; '));
  } finally { await browser.close(); }
  console.log('=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  process.exitCode = fail ? 1 : 0;
})().catch(e=>{console.error(e);process.exitCode=1;});
