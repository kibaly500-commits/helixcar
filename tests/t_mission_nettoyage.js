// NETTOYAGE DANS LE DASHBOARD ET MISSIONS DE NETTOYAGE (§14)
// ------------------------------------------------------------------
// Une demande de nettoyage pouvait être reçue, chiffrée et devisée, mais
// jamais TRANSFORMÉE EN MISSION : public.missions ne décrivait qu'un
// convoyage. Un nettoyeur n'avait donc rien à accepter, et
// l'administrateur aucun moyen de lui confier une intervention.
//
// Ce fichier suit le parcours complet sur le VRAI Dashboard : fiche de
// la demande, création de la mission, visibilité côté partenaire, photos
// avant et après, fin d'intervention, validation par HelixCar.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 220) + ']' : '')); fail++; echecs.push(l); }
}

const DEMANDE = {
  id: 'qa-nett', numero_client: 'HC-QA-NETT', prenom: 'TEST-QA', nom: 'Nettoyage',
  email: 'nett@example.invalid', telephone: '+33600000010', type_client: 'pro',
  societe: 'TEST-QA Flotte SAS', type_service: 'nettoyage', statut: 'nouveau',
  created_at: '2026-09-01T09:00:00Z',
  nettoyage_details: {
    schema_version: 2, type_nettoyage: 'interieur_exterieur', lieu: 'parc_client',
    nombre_vehicules_approx: 12, date_souhaitee: '2026-11-02',
    dispo_type: 'precise', heure_precise: '09:00',
    adresse_rue: '3 rue des Lilas', adresse_cp: '69003', adresse_ville: 'Lyon',
    repartition_categories: [{ categorie: 'citadine', quantite: 12, precision: null }],
    contact_sur_place: { type: 'autre', nom: 'TEST-QA Martin', telephone: '+33600000020' },
    conditions: { professionnel: true, emplacement_adapte: true, eau_electricite: true },
    delai: 'standard'
  }
};

// Demande incomplète : elle ne doit PAS pouvoir devenir une mission.
const INCOMPLETE = Object.assign({}, DEMANDE, {
  id: 'qa-nett-ko', numero_client: 'HC-QA-NETT-KO',
  nettoyage_details: Object.assign({}, DEMANDE.nettoyage_details, {
    date_souhaitee: null, contact_sur_place: null
  })
});

const INIT = `
window.__db = { missions: [], mission_photos: [], objets: [] };
window.__ecritures = [];
window.__signatures = [];
window.__emails = [];
window.emailjs = { init:function(){}, send:function(){ window.__emails.push(1); return Promise.resolve(); },
                   sendForm:function(){ window.__emails.push(1); return Promise.resolve(); } };
window.__alertes = [];
window.alert = function (m) { window.__alertes.push(String(m)); };
window.confirm = function () { return true; };

function _table(nom) {
  const req = { filtres: {} };
  const api = {
    select(){ return api; }, eq(c,v){ req.filtres[c]=v; return api; },
    order(){ return api; }, limit(){ return api; },
    _lignes(){ return (window.__db[nom]||[]).filter(l => Object.entries(req.filtres).every(([k,v]) => String(l[k])===String(v))); },
    then(r){ return Promise.resolve({ data: api._lignes(), error: null }).then(r); },
    insert(v){
      return { then(r){
        const lignes = Array.isArray(v) ? v : [v];
        lignes.forEach(l => {
          const ligne = Object.assign({ id: nom.slice(0,3) + '-' + (window.__db[nom].length + 1) }, l);
          window.__db[nom].push(ligne);
          window.__ecritures.push({ table: nom, op: 'insert', ligne: ligne });
        });
        return Promise.resolve({ error: null }).then(r);
      } };
    },
    update(v){
      const maj = { eq(c,val){ req.filtres[c]=val; return maj; },
        then(r){
          api._lignes().forEach(l => Object.assign(l, v));
          window.__ecritures.push({ table: nom, op: 'update', valeurs: v });
          return Promise.resolve({ error: null }).then(r);
        } };
      return maj;
    },
  };
  return api;
}
window.supabase = { createClient: function(){ return {
  auth: { onAuthStateChange:function(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
          getSession: async function(){ return { data:{ session:{ access_token:'jwt-test' } } }; } },
  from: _table,
  storage: { from: function(b){ return {
    upload: async function(chemin, fichier, opts){
      window.__db.objets.push({ bucket: b, chemin: chemin, type: (opts||{}).contentType });
      window.__ecritures.push({ table: 'storage:' + b, op: 'upload', chemin: chemin });
      return { data: { path: chemin }, error: null };
    },
    createSignedUrl: async function(){ return { data: null, error: { message: 'non teste ici' } }; },
    // Une URL SIGNÉE, temporaire : c'est le seul chemin de lecture d'un
    // bucket privé. On enregistre l'appel pour vérifier ce qui est
    // demandé, et pour combien de temps.
    createSignedUrls: async function(chemins, secondes){
      window.__signatures.push({ bucket: b, chemins: chemins.slice(), secondes: secondes });
      return { data: chemins.map(function(c){
        return { path: c, signedUrl: 'https://exemple.invalid/signee/' + encodeURIComponent(c) + '?exp=' + secondes, error: null };
      }), error: null };
    }
  }; } },
}; } };
const _f = window.fetch;
window.fetch = function(u, o){
  u = String(u);
  const i = u.indexOf('/rest/v1/');
  if (i === -1) return _f.apply(window, arguments);
  const req = u.slice(i + 9);
  const chemin = req.split('?')[0];
  const params = new URLSearchParams(req.split('?')[1] || '');
  const methode = ((o||{}).method || 'GET').toUpperCase();
  if (methode === 'PATCH') {
    const corps = JSON.parse((o||{}).body || '{}');
    let cibles = (window.__db[chemin] || []);
    params.forEach(function(v,k){
      if (v.indexOf('eq.') === 0) cibles = cibles.filter(l => String(l[k]) === decodeURIComponent(v.slice(3)));
    });
    cibles.forEach(l => Object.assign(l, corps));
    window.__ecritures.push({ table: chemin, op: 'patch', valeurs: corps });
    return Promise.resolve({ ok:true, status:204, headers:{get:()=>null}, text:()=>Promise.resolve('') });
  }
  let lignes = (window.__db[chemin] || []).slice();
  params.forEach(function(v,k){
    if (['select','order','limit','offset'].indexOf(k) !== -1 || k.charAt(0) === '$') return;
    if (v.indexOf('eq.') === 0) lignes = lignes.filter(l => String(l[k]) === decodeURIComponent(v.slice(3)));
    else if (v.indexOf('in.(') === 0) {
      const vals = decodeURIComponent(v.slice(4,-1)).split(',');
      lignes = lignes.filter(l => vals.indexOf(String(l[k])) !== -1);
    }
    else if (v === 'not.is.null') lignes = lignes.filter(l => l[k] !== null && l[k] !== undefined);
    else if (v === 'is.null') lignes = lignes.filter(l => l[k] === null || l[k] === undefined);
  });
  const total = lignes.length;
  if (params.get('limit') === '0') lignes = [];
  return Promise.resolve({ ok:true, status:200,
    headers:{ get:(h)=> h.toLowerCase()==='content-range' ? ('items 0-'+total+'/'+total) : null },
    text:()=>Promise.resolve(JSON.stringify(lignes)) });
};
`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(INIT);
  await page.goto('file://' + path.resolve('/home/user/helixcar/dashboard.html'), { waitUntil: 'load' });
  await page.evaluate(() => {
    currentRole = 'admin';
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    if (typeof buildNav === 'function') buildNav('admin');
  });

  await page.evaluate(([d, ko]) => {
    _demandesDevisListe = [d, ko];
    _devisParClient = { 'qa-nett': { reference: 'DEV-QA-N', client_id: 'qa-nett', prix: 480, statut: 'accepte' } };
    _missionsParDemande = {};
  }, [DEMANDE, INCOMPLETE]);

  // ══ A. LA FICHE DIT TOUT CE QU'IL FAUT SAVOIR ══
  await page.evaluate(() => ouvrirFicheDemande('qa-nett'));
  await page.waitForTimeout(300);
  const fiche = await page.evaluate(() => (document.getElementById('fiche-demande-corps') || {}).textContent || '');

  const ATTENDU = [
    ['A1', 'la prestation demandée', /intérieur et extérieur/i],
    ['A2', 'les options confirmées', /Emplacement adapté/i],
    ['A3', 'le parc de véhicules', /12 véhicule/i],
    ['A4', "la date d'intervention", /02\/11\/2026/],
    ['A5', "le lieu d'intervention", /parc automobile/i],
    ['A6', "qu'un partenaire est nécessaire", /Partenaire nécessaire/i],
    ['A7', 'le prix client', /480/],
    ['A8', 'la rémunération du partenaire', /Rémunération du partenaire/i],
    ['A9', 'le statut de la demande', /Statut de la demande/i],
    ['A10', 'le contact sur place', /TEST-QA Martin/],
  ];
  ATTENDU.forEach(([n, quoi, re]) => {
    check(n + ' : la fiche affiche ' + quoi, re.test(fiche), fiche.slice(0, 120));
  });
  check('A11 : la rémunération est bien la moitié du prix client',
    /240/.test(fiche), fiche.slice(fiche.indexOf('Rémunération'), fiche.indexOf('Rémunération') + 60));
  check('A12 : et le devis est proposé comme pour les autres services',
    /Créer le devis/.test(fiche));

  // ══ B. CRÉATION DE LA MISSION ══
  check('B1 : la fiche propose de créer la mission de nettoyage',
    /Créer la mission de nettoyage/.test(fiche));
  await page.evaluate(() => creerMissionNettoyage('qa-nett'));
  await page.waitForTimeout(400);
  const mission = await page.evaluate(() => (window.__db.missions || [])[0] || null);
  check('B2 : une mission est réellement écrite', !!mission, JSON.stringify(mission));
  check('B3 : elle relève du métier nettoyage',
    mission && mission.type_mission === 'nettoyage', mission && mission.type_mission);
  check('B4 : sa référence lui est propre',
    mission && /^HC-NET-\d{4}-\d{4}$/.test(mission.reference), mission && mission.reference);
  check('B5 : elle reprend l\'adresse de la demande',
    mission && mission.adresse_intervention === '3 rue des Lilas'
    && mission.ville_intervention === 'Lyon', JSON.stringify(mission && mission.adresse_intervention));
  check('B6 : le contact sur place',
    mission && mission.contact_nom === 'TEST-QA Martin' && mission.contact_tel === '+33600000020');
  check('B7 : la date et l\'horaire',
    mission && mission.date_intervention === '2026-11-02' && mission.heure_intervention === '09:00',
    JSON.stringify(mission && [mission.date_intervention, mission.heure_intervention]));
  check('B8 : la prestation attendue',
    mission && /intérieur et extérieur/i.test(mission.prestation || ''), mission && mission.prestation);
  check('B9 : le nombre de véhicules',
    mission && mission.nb_vehicules === 12, String(mission && mission.nb_vehicules));
  check('B10 : le prix issu du devis réellement établi',
    mission && Number(mission.prix_ttc) === 480, String(mission && mission.prix_ttc));
  check('B11 : elle part en attente d\'un partenaire, jamais attribuée d\'office',
    mission && mission.statut === 'en_attente' && !mission.convoyeur_id, JSON.stringify(mission && mission.statut));
  check('B12 : AUCUN e-mail n\'est envoyé', (await page.evaluate(() => window.__emails.length)) === 0);
  check('B13 : elle est rattachée à la demande', mission && mission.client_id === 'qa-nett');

  // Une demande incomplète ne peut pas devenir une mission.
  await page.evaluate(() => ouvrirFicheDemande('qa-nett-ko'));
  await page.waitForTimeout(250);
  const ficheKo = await page.evaluate(() => (document.getElementById('fiche-demande-corps') || {}).textContent || '');
  check('B14 : une demande incomplète ne propose PAS la création',
    !/Créer la mission de nettoyage/.test(ficheKo));
  check('B15 : et dit ce qui manque',
    /informations d'intervention/i.test(ficheKo), ficheKo.slice(0, 150));

  // Deuxième création impossible.
  await page.evaluate(() => ouvrirFicheDemande('qa-nett'));
  await page.waitForTimeout(300);
  const ficheApres = await page.evaluate(() => (document.getElementById('fiche-demande-corps') || {}).textContent || '');
  check('B16 : une fois créée, la mission est annoncée dans la fiche',
    /Mission HC-NET-/.test(ficheApres), ficheApres.slice(0, 150));
  check('B17 : et la création n\'est plus proposée',
    !/Créer la mission de nettoyage/.test(ficheApres));

  // ══ C. LE PARTENAIRE NE VOIT QUE SES MÉTIERS ══
  await page.evaluate(() => {
    currentRole = 'convoyeur';
    _currentConvoyeur = { id: 'p-nett', prenom: 'TEST-QA', nom: 'Nettoyeur', activites: ['nettoyage'] };
    window.__db.missions.push({
      id: 'm-conv', reference: 'HC-2026-0001', type_mission: 'convoyage', statut: 'en_attente',
      convoyeur_id: null, ville_depart: 'Paris', ville_arrivee: 'Lyon', prix_ttc: 400
    });
    showPage('convoyeur-missions');
  });
  await page.waitForTimeout(500);
  const dispo = await page.evaluate(() => (document.getElementById('conv-missions-table') || {}).textContent || '');
  check('C1 : un nettoyeur voit la mission de nettoyage', /Lilas|Lyon/.test(dispo), dispo.slice(0, 200));
  check('C2 : et PAS la mission de convoyage',
    !/HC-2026-0001/.test(dispo) && !/Paris → Lyon/.test(dispo), dispo.slice(0, 200));
  check('C3 : la rémunération affichée est la sienne, pas le prix client',
    /240 €/.test(dispo) && !/480 €/.test(dispo), dispo.slice(0, 250));

  await page.evaluate(() => {
    _currentConvoyeur = { id: 'p-conv', prenom: 'TEST-QA', nom: 'Convoyeur', activites: ['convoyage'] };
    loadMissionsConvoyeur();
  });
  await page.waitForTimeout(400);
  const dispoConv = await page.evaluate(() => (document.getElementById('conv-missions-table') || {}).textContent || '');
  check('C4 : à l\'inverse, un convoyeur ne voit pas le nettoyage',
    !/Lilas/.test(dispoConv), dispoConv.slice(0, 200));

  // ══ D. PHOTOS AVANT ET APRÈS ══
  await page.evaluate(() => {
    _currentConvoyeur = { id: 'p-nett', prenom: 'TEST-QA', nom: 'Nettoyeur', activites: ['nettoyage'] };
    const m = window.__db.missions.filter(x => x.type_mission === 'nettoyage')[0];
    m.convoyeur_id = 'p-nett';
    m.statut = 'acceptee';
    showPage('convoyeur-historique');
  });
  await page.waitForTimeout(500);
  let histo = await page.evaluate(() => (document.getElementById('conv-historique-table') || {}).textContent || '');
  check('D1 : la mission acceptée apparaît dans son historique', /Lilas/.test(histo), histo.slice(0, 200));
  check('D2 : avec ses consignes d\'intervention', /Contact/.test(histo), histo.slice(0, 250));
  check('D3 : deux boutons photo sont proposés', /Avant \(0\)/.test(histo) && /Après \(0\)/.test(histo), histo.slice(0, 250));
  check('D4 : et « Intervention terminée » est REFUSÉ sans photo',
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#conv-historique-table button'))
        .filter(x => /Intervention terminée/.test(x.textContent))[0];
      return !!b && b.disabled === true;
    }));

  const missionId = await page.evaluate(() =>
    window.__db.missions.filter(x => x.type_mission === 'nettoyage')[0].id);
  async function deposer(etape) {
    await page.evaluate(([id, e]) => {
      const champ = document.getElementById('photo-mission-input');
      champ.setAttribute('data-mission', id);
      champ.setAttribute('data-etape', e);
      // Un vrai fichier image, construit dans la page.
      const f = new File([new Uint8Array([255, 216, 255, 224, 0, 16])], e + '.jpg', { type: 'image/jpeg' });
      Object.defineProperty(champ, 'files', { value: [f], configurable: true });
      return envoyerPhotoMission(champ);
    }, [missionId, etape]);
    await page.waitForTimeout(350);
  }
  await deposer('avant');
  const objets = await page.evaluate(() => window.__db.objets.slice());
  check('D5 : la photo part dans le bucket des photos de mission',
    objets.length === 1 && objets[0].bucket === 'missions-photos', JSON.stringify(objets));
  check('D6 : son chemin désigne la mission, et elle seule',
    objets[0] && objets[0].chemin.indexOf('missions/' + missionId + '/') === 0, objets[0] && objets[0].chemin);
  check('D7 : et l\'étape est inscrite dans le nom du fichier',
    /avant-/.test(objets[0].chemin), objets[0].chemin);
  const traces = await page.evaluate(() => window.__db.mission_photos.slice());
  check('D8 : une trace est enregistrée en base', traces.length === 1 && traces[0].etape === 'avant',
    JSON.stringify(traces));

  await deposer('apres');
  await page.waitForTimeout(300);
  histo = await page.evaluate(() => (document.getElementById('conv-historique-table') || {}).textContent || '');
  check('D9 : les compteurs suivent', /Avant \(1\)/.test(histo) && /Après \(1\)/.test(histo), histo.slice(0, 250));
  check('D10 : « Intervention terminée » devient alors possible',
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('#conv-historique-table button'))
        .filter(x => /Intervention terminée/.test(x.textContent))[0];
      return !!b && b.disabled === false;
    }));

  // Un format refusé ne part pas.
  await page.evaluate(() => { window.__alertes = []; });
  await page.evaluate(([id]) => {
    const champ = document.getElementById('photo-mission-input');
    champ.setAttribute('data-mission', id);
    champ.setAttribute('data-etape', 'avant');
    const f = new File([new Uint8Array([1, 2, 3])], 'doc.pdf', { type: 'application/pdf' });
    Object.defineProperty(champ, 'files', { value: [f], configurable: true });
    return envoyerPhotoMission(champ);
  }, [missionId]);
  await page.waitForTimeout(250);
  const apresPdf = await page.evaluate(() => ({
    objets: window.__db.objets.length, alertes: window.__alertes.slice()
  }));
  check('D11 : un fichier qui n\'est pas une photo est refusé',
    apresPdf.objets === 2 && /Format non pris en charge/.test(apresPdf.alertes[0] || ''),
    JSON.stringify(apresPdf));

  // ══ E. FIN D'INTERVENTION ET VALIDATION ══
  await page.evaluate(() => terminerMissionNettoyage(
    window.__db.missions.filter(x => x.type_mission === 'nettoyage')[0].id));
  await page.waitForTimeout(400);
  let m = await page.evaluate(() => window.__db.missions.filter(x => x.type_mission === 'nettoyage')[0]);
  check('E1 : le partenaire déclare l\'intervention terminée', m.statut === 'fini', m.statut);
  check('E2 : mais il ne la VALIDE pas lui-même',
    !m.prestation_validee_le, JSON.stringify(m.prestation_validee_le));

  await page.evaluate(() => {
    currentRole = 'admin';
    validerPrestationNettoyage(window.__db.missions.filter(x => x.type_mission === 'nettoyage')[0].id);
  });
  await page.waitForTimeout(400);
  m = await page.evaluate(() => window.__db.missions.filter(x => x.type_mission === 'nettoyage')[0]);
  check('E3 : seul l\'administrateur valide la prestation', m.statut === 'terminee', m.statut);
  check('E4 : et la validation est datée', !!m.prestation_validee_le, JSON.stringify(m.prestation_validee_le));
  check('E5 : toujours aucun e-mail', (await page.evaluate(() => window.__emails.length)) === 0);

  // ══ G. RELIRE LES PHOTOS — PAR URL SIGNÉE, JAMAIS PUBLIQUE ══
  // Valider une prestation sans voir les photos reviendrait à valider à
  // l'aveugle : la lecture doit exister, et rester privée.

  // Une photo appartenant à une AUTRE mission : elle ne doit jamais
  // apparaître dans la fenêtre de celle-ci.
  await page.evaluate(() => {
    window.__db.mission_photos.push({
      id: 'pho-autre', mission_id: 'mission-etrangere',
      etape: 'avant', chemin: 'missions/mission-etrangere/avant-1.jpg',
      created_at: '2026-01-01T10:00:00Z'
    });
    window.__signatures = [];
  });

  await page.evaluate(id => voirPhotosMission(id, 'HC-NET-2026-0001'), missionId);
  await page.waitForTimeout(350);

  const vue = await page.evaluate(() => {
    const zone = document.getElementById('photos-mission-contenu');
    return {
      ouvert: (document.getElementById('modal-photos-mission') || {}).classList
                ? document.getElementById('modal-photos-mission').classList.contains('open') : false,
      titre: (document.getElementById('photos-mission-titre') || {}).textContent || '',
      html: zone ? zone.innerHTML : '',
      images: zone ? Array.from(zone.querySelectorAll('img')).map(i => i.getAttribute('src')) : [],
      signatures: window.__signatures.slice()
    };
  });

  check('G1 : la fenêtre des photos s\'ouvre', vue.ouvert);
  check('G2 : elle nomme la mission concernée', /HC-NET-2026-0001/.test(vue.titre), vue.titre);
  check('G3 : les deux étapes sont présentées',
    /Avant intervention \(1\)/.test(vue.html) && /Après intervention \(1\)/.test(vue.html),
    vue.html.slice(0, 200));
  check('G4 : deux images sont réellement affichées', vue.images.length === 2, String(vue.images.length));
  check('G5 : la lecture passe par le bucket privé des photos',
    vue.signatures.length === 1 && vue.signatures[0].bucket === 'missions-photos',
    JSON.stringify(vue.signatures));
  check('G6 : seules les photos de CETTE mission sont demandées',
    vue.signatures[0] && vue.signatures[0].chemins.every(c => c.indexOf('missions/' + missionId + '/') === 0),
    JSON.stringify(vue.signatures[0] && vue.signatures[0].chemins));
  check('G7 : la photo d\'une autre mission n\'apparaît jamais',
    !/mission-etrangere/.test(vue.html));
  check('G8 : le lien de lecture est temporaire',
    vue.signatures[0] && vue.signatures[0].secondes > 0 && vue.signatures[0].secondes <= 900,
    String(vue.signatures[0] && vue.signatures[0].secondes));
  check('G9 : aucune URL publique n\'est construite',
    vue.images.every(u => u.indexOf('/object/public/') === -1), vue.images.join(' | '));

  // Fermer doit détacher les images : une URL signée ne doit pas
  // survivre dans le document après la fermeture.
  await page.evaluate(() => fermerPhotosMission());
  await page.waitForTimeout(120);
  const apresFermeture = await page.evaluate(() => ({
    vide: (document.getElementById('photos-mission-contenu') || {}).innerHTML === '',
    ferme: !document.getElementById('modal-photos-mission').classList.contains('open')
  }));
  check('G10 : la fenêtre se ferme', apresFermeture.ferme);
  check('G11 : et aucune URL signée ne reste dans la page', apresFermeture.vide);

  // Une mission sans photo le dit, au lieu d'afficher une zone vide.
  await page.evaluate(() => voirPhotosMission('mission-sans-photo', 'HC-NET-2026-0002'));
  await page.waitForTimeout(300);
  const vide = await page.evaluate(() => ({
    etat: (document.getElementById('photos-mission-etat') || {}).textContent || '',
    html: (document.getElementById('photos-mission-contenu') || {}).innerHTML || ''
  }));
  check('G12 : une mission sans photo l\'annonce clairement',
    /aucune photo/i.test(vide.etat) && vide.html === '', vide.etat);
  await page.evaluate(() => fermerPhotosMission());

  // ══ F. LE SYSTÈME DE MISSIONS EXISTANT EST RÉUTILISÉ ══
  const src = fs.readFileSync('/home/user/helixcar/dashboard.html', 'utf8');
  const mig = fs.readFileSync('/home/user/helixcar/migrations/96_missions_nettoyage.sql', 'utf8');
  check('F1 : aucune seconde table de missions n\'est créée',
    !/create table[^;]*missions_nettoyage/i.test(mig));
  check('F2 : la même table missions porte les deux métiers',
    /alter table public\.missions/.test(mig) && /type_mission/.test(mig));
  check('F3 : une seule liste de missions côté administrateur',
    (src.match(/function loadMissions\(/g) || []).length === 1);
  check('F4 : une seule liste côté partenaire',
    (src.match(/function loadMissionsConvoyeur\(/g) || []).length === 1);
  check('F5 : le bucket des photos n\'est jamais public',
    /'missions-photos'[\s\S]{0,200}false/.test(mig) && !/missions-photos[^;]*public = true/.test(mig));
  check('F6 : aucune politique de ce bucket n\'est ouverte à anon',
    !/photos mission[\s\S]{0,300}to anon/.test(mig));
  check('F7 : le droit du partenaire passe par un helper SECURITY DEFINER',
    /function public\.est_partenaire_de_mission/.test(mig) && /security definer/.test(mig));
  check('F8 : un partenaire bloqué perd ce droit',
    /coalesce\(c\.bloque, false\) = false/.test(mig));
  check('F9 : la relecture des photos réutilise le mécanisme des vidéos',
    /createSignedUrls?\(/.test(src) && !/missions-photos[\s\S]{0,120}getPublicUrl/.test(src));
  check('F10 : l\'administrateur peut voir les photos avant de valider',
    /voirPhotosMission\(/.test(src) && /Valider la prestation/.test(src));

  check('Z1 : aucune erreur JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
