// INFORMATIONS À COMPLÉTER — CÔTÉ CLIENT ET CÔTÉ ADMINISTRATEUR
// Exécute le vrai code des deux pages contre un double Supabase.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}
const RACINE = '/home/user/helixcar';

// Le double reproduit le contrat des fonctions serveur :
// informations_demande renvoie les rubriques REQUISES avec leur statut
// dérivé ; repondre_informations_demande n'accepte que les rubriques
// requises et ne touche jamais une rubrique déjà validée.
const INIT = `
window.__journal = [];
window.__emails = [];
window.__reseauCoupe = false;
window.__session = { access_token: 'jwt', user: { id: 'client-a', email: 'clientA@helixcar.test' } };

window.__demandes = [
  { id: 'dem-conv', numero_client: 'TEST-QA-C1', type_service: 'convoyage', statut: 'nouveau',
    prenom: 'TEST-QA', nom: 'ClientA', email: 'clientA@helixcar.test', telephone: '+33600000010',
    type_client: 'part', created_at: '2026-09-01T10:00:00Z' },
  { id: 'dem-nett', numero_client: 'TEST-QA-C2', type_service: 'nettoyage', statut: 'nouveau',
    prenom: 'TEST-QA', nom: 'ClientA', email: 'clientA@helixcar.test', telephone: '+33600000010',
    type_client: 'part', created_at: '2026-09-02T10:00:00Z' },
  { id: 'dem-ok', numero_client: 'TEST-QA-C3', type_service: 'stockage', statut: 'nouveau',
    prenom: 'TEST-QA', nom: 'ClientA', email: 'clientA@helixcar.test', telephone: '+33600000010',
    type_client: 'part', created_at: '2026-09-03T10:00:00Z' }
];

// État serveur des rubriques, par demande. PERSISTÉ dans localStorage :
// sans cela, chaque rechargement de page réinitialiserait la « base » et
// les tests de F5 ne prouveraient rien.
window.__infosDefaut = {
  'dem-conv': [
    { cle: 'immatriculation', libelle: 'Immatriculation du véhicule', statut: 'fournie', valeur: null, commentaire: null },
    { cle: 'marque_modele', libelle: 'Marque et modèle', statut: 'fournie', valeur: null, commentaire: null },
    { cle: 'date_prise_en_charge', libelle: 'Date de prise en charge', statut: 'fournie', valeur: null, commentaire: null },
    { cle: 'contact_pc_nom', libelle: 'Nom du contact sur place au départ', statut: 'attendue', valeur: null, commentaire: null },
    { cle: 'contact_pc_tel', libelle: 'Téléphone du contact sur place au départ', statut: 'a_corriger', valeur: '06', commentaire: 'Numéro incomplet' },
    { cle: 'adresse_arrivee_rue', libelle: 'Adresse de livraison', statut: 'validee', valeur: '2 rue B', commentaire: null }
  ],
  'dem-nett': [
    { cle: 'nettoyage_details', libelle: 'Détail de la prestation de nettoyage', statut: 'fournie', valeur: null, commentaire: null },
    { cle: 'contact_pc_nom', libelle: 'Nom du contact sur place', statut: 'attendue', valeur: null, commentaire: null },
    { cle: 'contact_pc_tel', libelle: 'Téléphone du contact sur place', statut: 'transmise', valeur: '+33600000012', commentaire: null }
  ],
  'dem-ok': [
    { cle: 'stockage_ville', libelle: 'Ville de stockage', statut: 'fournie', valeur: null, commentaire: null },
    { cle: 'stockage_date_debut', libelle: 'Date de début de stockage', statut: 'validee', valeur: '2026-11-01', commentaire: null },
    { cle: 'immatriculation', libelle: 'Immatriculation du véhicule', statut: 'fournie', valeur: null, commentaire: null }
  ]
};

try {
  const sauve = localStorage.getItem('__infosParDemande');
  window.__infosParDemande = sauve ? JSON.parse(sauve) : window.__infosDefaut;
} catch (e) { window.__infosParDemande = window.__infosDefaut; }
window.__persister = function () {
  try { localStorage.setItem('__infosParDemande', JSON.stringify(window.__infosParDemande)); } catch (e) {}
};

function _table(nom) {
  const req = { filtres: {} };
  const api = {
    select() { return api; }, eq(c, v) { req.filtres[c] = v; return api; },
    order() { return api; }, limit() { return api; },
    then(r) {
      if (window.__reseauCoupe) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } }).then(r);
      return Promise.resolve({ data: nom === 'v_mes_demandes' ? window.__demandes.slice() : [], error: null }).then(r);
    },
    update(valeurs) {
      const maj = {
        eq(c, v) { req.filtres[c] = v; return maj; },
        then(r) {
          if (window.__reseauCoupe) {
            return Promise.resolve({ error: { message: 'Failed to fetch' } }).then(r);
          }
          window.__journal.push({ op: 'update', nom, valeurs, filtres: Object.assign({}, req.filtres) });
          // Applique la décision administrateur sur l'état serveur.
          const lignes = window.__infosParDemande[req.filtres.client_id] || [];
          lignes.forEach(function (l) {
            if (l.cle === req.filtres.cle) {
              l.statut = valeurs.statut;
              l.commentaire = ('commentaire' in valeurs) ? valeurs.commentaire : l.commentaire;
            }
          });
          window.__persister();
          return Promise.resolve({ error: null }).then(r);
        }
      };
      return maj;
    }
  };
  return api;
}

window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: window.__session } }; },
    signInWithPassword: async function () { return { data: { session: window.__session, user: window.__session.user }, error: null }; },
    signOut: async function () { return {}; }
  },
  from: _table,
  rpc: async function (nom, params) {
    if (window.__reseauCoupe) return { data: null, error: { message: 'Failed to fetch' } };
    window.__journal.push({ op: 'rpc', nom, params });
    if (nom === 'informations_demande') {
      return { data: (window.__infosParDemande[params.p_client_id] || []).map(l => Object.assign({}, l)), error: null };
    }
    if (nom === 'repondre_informations_demande') {
      const lignes = window.__infosParDemande[params.p_client_id] || [];
      let n = 0;
      Object.keys(params.p_reponses || {}).forEach(function (cle) {
        const l = lignes.filter(x => x.cle === cle)[0];
        if (!l) return;                       // rubrique non requise : ignorée
        if (l.statut === 'validee') return;   // déjà validée : conservée
        l.statut = 'transmise';
        l.valeur = params.p_reponses[cle];
        l.commentaire = null;
        n++;
      });
      window.__persister();
      return { data: n, error: null };
    }
    return { data: null, error: null };
  },
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: null }; } }; } }
}; } };

window.emailjs = { init: function () {},
  send: function () { window.__emails.push(Array.from(arguments)); return Promise.resolve(); },
  sendForm: function () { window.__emails.push(['f']); return Promise.resolve(); } };
`;

(async () => {
  const navigateur = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await navigateur.newPage({ viewport: { width: 1280, height: 1100 } });
  const erreursJs = [];
  page.on('pageerror', e => erreursJs.push(e.message));
  await page.addInitScript(INIT);
  // L'état du double est persisté dans localStorage : on repart propre
  // pour que la suite soit reproductible d'une exécution à l'autre.
  await page.goto('file://' + path.resolve(RACINE, 'dashboard.html'), { waitUntil: 'load' });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });

  // ── A. ONGLET « INFORMATIONS À COMPLÉTER » ──
  await page.goto('file://' + path.resolve(RACINE, 'dashboard.html'), { waitUntil: 'load' });
  page.on('dialog', d => d.accept());
  await page.evaluate(async () => {
    loginRole = 'client';
    document.getElementById('login-email').value = 'clientA@helixcar.test';
    document.getElementById('login-pw').value = 'x';
    await doLogin();
    showPage('client-infos');
  });
  await page.waitForTimeout(600);
  const onglet = await page.evaluate(() => (document.getElementById('client-infos-liste') || {}).innerHTML || '');

  check('A1 : seules les demandes nécessitant réellement quelque chose apparaissent',
    /TEST-QA-C1/.test(onglet) && /TEST-QA-C2/.test(onglet) && !/TEST-QA-C3/.test(onglet),
    onglet.slice(0, 200));
  check('A2 : la référence et le service sont affichés',
    /TEST-QA-C1/.test(onglet) && /Convoyage automobile/.test(onglet));
  check('A3 : le statut de la demande est affiché', /badge/.test(onglet) && /nouveau/.test(onglet));
  check('A4 : la progression est calculée sur les rubriques réellement requises',
    /4 informations sur 6/.test(onglet), (onglet.match(/\d+ informations? sur \d+/g) || []).join(' | '));
  check('A5 : une autre progression pour un autre service',
    /2 informations sur 3/.test(onglet), (onglet.match(/\d+ informations? sur \d+/g) || []).join(' | '));
  check('A6 : les informations déjà reçues sont listées',
    /Déjà reçues/.test(onglet) && /Adresse de livraison/.test(onglet));
  check('A7 : les informations encore attendues sont listées',
    /Encore attendues/.test(onglet) && /Nom du contact sur place au départ/.test(onglet));
  check('A8 : le motif de correction est visible pour le client',
    /Numéro incomplet/.test(onglet));
  check('A9 : le bouton « Compléter mes informations » est proposé',
    /Compléter mes informations/.test(onglet));
  check('A10 : aucune donnée interne n\'est affichée',
    !/prix|remuneration|rémunération|convoyeur_id|marge/i.test(onglet), onglet.slice(0, 120));

  // ── B. ÉCRAN DE COMPLÉTION ──
  await page.goto('file://' + path.resolve(RACINE, 'index.html') + '?completer=dem-conv', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const ecran = await page.evaluate(() => ({
    ouvert: document.getElementById('modal-completer').classList.contains('open'),
    html: (document.getElementById('completer-rubriques') || {}).innerHTML || '',
    progression: (document.getElementById('completer-progression') || {}).textContent || '',
    champs: Array.from(document.querySelectorAll('#completer-rubriques input')).map(i => i.id),
    valeurs: Array.from(document.querySelectorAll('#completer-rubriques input')).map(i => i.value)
  }));
  check('B1 : l\'écran de complétion s\'ouvre', ecran.ouvert);
  check('B2 : SEULES les rubriques manquantes ou à corriger sont affichées',
    ecran.champs.length === 2
    && ecran.champs.includes('completer-champ-contact_pc_nom')
    && ecran.champs.includes('completer-champ-contact_pc_tel'), JSON.stringify(ecran.champs));
  check('B3 : une information déjà validée n\'est JAMAIS redemandée',
    !ecran.champs.includes('completer-champ-adresse_arrivee_rue'));
  check('B4 : une information déjà fournie n\'est pas redemandée',
    !ecran.champs.includes('completer-champ-immatriculation'));
  check('B5 : la valeur existante est préremplie',
    ecran.valeurs.includes('06'), JSON.stringify(ecran.valeurs));
  check('B6 : le motif de correction est rappelé', /Numéro incomplet/.test(ecran.html));
  check('B7 : la progression est rappelée', /4 information/.test(ecran.progression), ecran.progression);
  check('B8 : les composants du formulaire sont réutilisés',
    /modal-form-group/.test(ecran.html) && /field-required/.test(ecran.html));

  // Enregistrement + double clic
  const envoi = await page.evaluate(async () => {
    document.getElementById('completer-champ-contact_pc_nom').value = 'TEST-QA Dupont';
    document.getElementById('completer-champ-contact_pc_tel').value = '+33600000099';
    window.__journal = [];
    envoyerInformationsCompletees();
    envoyerInformationsCompletees();   // double clic réel
    await new Promise(r => setTimeout(r, 600));
    return {
      appels: window.__journal.filter(j => j.op === 'rpc' && j.nom === 'repondre_informations_demande').length,
      message: (document.getElementById('completer-message') || {}).textContent || '',
      champsRestants: Array.from(document.querySelectorAll('#completer-rubriques input')).map(i => i.id)
    };
  });
  check('B9 : un double clic n\'envoie qu\'UNE fois', envoi.appels === 1, 'appels=' + envoi.appels);
  check('B10 : une confirmation simple est affichée',
    /bien été enregistrées/.test(envoi.message), envoi.message);
  check('B11 : l\'écran est relu depuis le serveur après enregistrement',
    envoi.champsRestants.length === 0, JSON.stringify(envoi.champsRestants));

  // F5 : l'état vient du serveur, pas du navigateur
  await page.goto('file://' + path.resolve(RACINE, 'index.html') + '?completer=dem-conv', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const apresF5 = await page.evaluate(() => ({
    champs: Array.from(document.querySelectorAll('#completer-rubriques input')).map(i => i.id),
    texte: (document.getElementById('completer-rubriques') || {}).textContent || ''
  }));
  check('B12 : après F5, les réponses transmises ne sont plus redemandées',
    apresF5.champs.length === 0 && /Aucune information ne manque/.test(apresF5.texte),
    JSON.stringify(apresF5.champs));

  // Coupure réseau : rien n'est perdu, aucun faux succès
  const coupure = await page.evaluate(async () => {
    window.__infosParDemande['dem-nett'][1].statut = 'attendue';
    return true;
  });
  await page.goto('file://' + path.resolve(RACINE, 'index.html') + '?completer=dem-nett', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const reseau = await page.evaluate(async () => {
    const champ = document.getElementById('completer-champ-contact_pc_nom');
    if (champ) champ.value = 'TEST-QA Reseau';
    window.__reseauCoupe = true;
    await envoyerInformationsCompletees();
    window.__reseauCoupe = false;
    return {
      message: (document.getElementById('completer-message') || {}).textContent || '',
      saisieConservee: (document.getElementById('completer-champ-contact_pc_nom') || {}).value
    };
  });
  check('B13 : une coupure réseau n\'annonce jamais un succès',
    !/bien été enregistrées/.test(reseau.message) && /n'a pas abouti/.test(reseau.message), reseau.message);
  check('B14 : la saisie du client est conservée après l\'échec',
    reseau.saisieConservee === 'TEST-QA Reseau', reseau.saisieConservee);

  // ── C. BLOC ADMINISTRATEUR ──
  await page.goto('file://' + path.resolve(RACINE, 'dashboard.html'), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  const bloc = await page.evaluate(async () => {
    currentRole = 'admin';
    window._currentAdmin = { id: 'admin-1' };
    window._demandesDevisListe = window.__demandes;
    window._devisParClient = { 'dem-conv': { reference: 'DEV-TEST-QA-1' } };
    await rendreInfosDemandeAdmin({ id: 'dem-conv' });
    return (document.getElementById('fiche-demande-infos') || {}).textContent || '';
  });
  check('C1 : le bloc « Informations nécessaires à la mission » existe',
    /Informations nécessaires à la mission/.test(bloc));
  check('C2 : le client concerné est indiqué', /TEST-QA ClientA/.test(bloc));
  check('C3 : la référence de la demande est indiquée', /TEST-QA-C1/.test(bloc));
  check('C4 : le devis associé est indiqué', /DEV-TEST-QA-1/.test(bloc));
  check('C5 : les informations déjà reçues sont listées', /Déjà reçues/.test(bloc));
  check('C6 : les informations manquantes sont listées', /Encore manquantes/.test(bloc));
  // À ce stade le client a répondu (section B) : les deux rubriques
  // concernées sont « Transmise », l'adresse reste « Validée » et les
  // données du dépôt initial « Reçue ».
  check('C7 : le statut de chaque information est affiché',
    /Validée/.test(bloc) && /Transmise/.test(bloc) && /Reçue/.test(bloc), bloc.slice(0, 260));

  // Valider
  const validation = await page.evaluate(async () => {
    window.__journal = [];
    await changerDecisionInformation('dem-conv', 'contact_pc_nom', 'validee');
    return {
      journal: window.__journal.filter(j => j.op === 'update'),
      etatServeur: window.__infosParDemande['dem-conv'].filter(l => l.cle === 'contact_pc_nom')[0].statut
    };
  });
  check('C8 : « Valider » écrit réellement dans Supabase',
    validation.journal.length === 1 && validation.journal[0].valeurs.statut === 'validee',
    JSON.stringify(validation.journal));
  check('C9 : la décision est persistée côté serveur', validation.etatServeur === 'validee');

  // À corriger — motif obligatoire
  await page.evaluate(() => { window.__motif = ''; });
  page.removeAllListeners('dialog');
  page.on('dialog', async d => { await d.dismiss(); });   // annulation du motif
  const sansMotif = await page.evaluate(async () => {
    window.__journal = [];
    await changerDecisionInformation('dem-conv', 'contact_pc_tel', 'a_corriger');
    return window.__journal.filter(j => j.op === 'update').length;
  });
  check('C10 : sans motif, AUCUNE correction n\'est enregistrée', sansMotif === 0, 'ecritures=' + sansMotif);

  page.removeAllListeners('dialog');
  page.on('dialog', async d => {
    if (d.type() === 'prompt') await d.accept('Numéro trop court');
    else await d.accept();
  });
  const avecMotif = await page.evaluate(async () => {
    window.__journal = [];
    await changerDecisionInformation('dem-conv', 'contact_pc_tel', 'a_corriger');
    const l = window.__infosParDemande['dem-conv'].filter(x => x.cle === 'contact_pc_tel')[0];
    return { journal: window.__journal.filter(j => j.op === 'update'), statut: l.statut, motif: l.commentaire };
  });
  check('C11 : avec motif, la correction est enregistrée',
    avecMotif.journal.length === 1 && avecMotif.statut === 'a_corriger', JSON.stringify(avecMotif));
  check('C12 : le motif court est enregistré', avecMotif.motif === 'Numéro trop court', String(avecMotif.motif));

  // Persistance : le bloc est relu depuis le serveur (équivaut à un F5)
  const relu = await page.evaluate(async () => {
    await rendreInfosDemandeAdmin({ id: 'dem-conv' });
    return (document.getElementById('fiche-demande-infos') || {}).textContent || '';
  });
  check('C13 : après rechargement, les décisions sont toujours là',
    /À corriger/.test(relu) && /Numéro trop court/.test(relu), relu.slice(-200));

  // Le client voit la correction demandée
  await page.goto('file://' + path.resolve(RACINE, 'index.html') + '?completer=dem-conv', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const cote = await page.evaluate(() => ({
    html: (document.getElementById('completer-rubriques') || {}).innerHTML || '',
    champs: Array.from(document.querySelectorAll('#completer-rubriques input')).map(i => i.id)
  }));
  check('C14 : le client voit précisément ce qu\'il doit corriger',
    cote.champs.includes('completer-champ-contact_pc_tel') && /Numéro trop court/.test(cote.html),
    JSON.stringify(cote.champs));
  check('C15 : les informations déjà validées ne lui sont pas redemandées',
    !cote.champs.includes('completer-champ-contact_pc_nom')
    && !cote.champs.includes('completer-champ-adresse_arrivee_rue'), JSON.stringify(cote.champs));

  // ── D. GARDE-FOUS ──
  const emails = await page.evaluate(() => window.__emails.length);
  check('D1 : aucun e-mail déclenché par ce workflow', emails === 0, String(emails));

  const fs = require('fs');
  const dash = fs.readFileSync(path.resolve(RACINE, 'dashboard.html'), 'utf8');
  const idx = fs.readFileSync(path.resolve(RACINE, 'index.html'), 'utf8');
  // Tranche BORNÉE au bloc ajouté par ce chantier : sans borne de fin,
  // l'analyse emporterait du code préexistant sans rapport (par exemple
  // marquerFacturePayee, qui concerne la facturation partenaire).
  const debutZone = dash.indexOf('ADMINISTRATEUR — INFORMATIONS NÉCESSAIRES');
  const finZone = dash.indexOf('ESPACE CLIENT — DEMANDES ET INFORMATIONS');
  const zoneInfos = dash.slice(debutZone, finZone > debutZone ? finZone : undefined);
  check('D2 : le workflow ne crée aucune mission', !/insert.*missions|missions.*insert/i.test(zoneInfos));
  check('D3 : aucun statut « payé » introduit par ce chantier',
    !/statut\s*[:=]\s*['"]pay/i.test(zoneInfos), (zoneInfos.match(/.*statut.*pay.*/i) || []).join(' | '));
  check('D4 : aucune trace de Stripe', !/stripe|payment_intent/i.test(zoneInfos.replace(/\/\/.*$/gm, '')));
  check('D5 : le client n\'a AUCUN chemin d\'écriture direct sur les statuts',
    !/from\('demande_informations_manquantes'\)[\s\S]{0,200}update/.test(idx),
    'index.html doit passer par repondre_informations_demande');
  check('D6 : aucune erreur JS', erreursJs.length === 0, erreursJs.join(' | '));

  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  await navigateur.close();
  process.exit(fail ? 1 : 0);
})();
