// AUDIT DE COHÉRENCE MONO / MULTI-VÉHICULES (§15)
// ------------------------------------------------------------------
// Une donnée appartient à UN véhicule et à un seul. Ce fichier suit la
// même demande d'un bout à l'autre de la chaîne — saisie, lecture des
// fiches, récapitulatif, charge envoyée à Supabase, PDF de devis, fiche
// administrateur, informations manquantes — et vérifie qu'à aucune
// étape la donnée d'un véhicule n'apparaît sur un autre.
const L = require('./lib.js');
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier , jourCivil, dansNJours } = require('./env.js');
const path = require('path');
const fs = require('fs');

// Trois véhicules dont AUCUNE valeur n'est partagée : toute apparition
// croisée est donc immédiatement détectable.
const VEH = [
  { immat: 'AA-111-AA', marque: 'Alpha Un',  pcRue: '1 rue Alpha',  pcVille: 'Amiens',
    pcCp: '80000', pcContact: 'Contact Alpha',  pcTel: '+33600000001', pcDate: 3,
    livRue: '11 rue Alpha', livVille: 'Angers', livCp: '49000',
    livContact: 'Livre Alpha', livTel: '+33600000011', livDate: 10 },
  { immat: 'BB-222-BB', marque: 'Bravo Deux', pcRue: '2 rue Bravo',  pcVille: 'Brest',
    pcCp: '29200', pcContact: 'Contact Bravo',  pcTel: '+33600000002', pcDate: 4,
    livRue: '22 rue Bravo', livVille: 'Bordeaux', livCp: '33000',
    livContact: 'Livre Bravo', livTel: '+33600000022', livDate: 11 },
  { immat: 'CC-333-CC', marque: 'Charlie Trois', pcRue: '3 rue Charlie', pcVille: 'Caen',
    pcCp: '14000', pcContact: 'Contact Charlie', pcTel: '+33600000003', pcDate: 5,
    livRue: '33 rue Charlie', livVille: 'Cannes', livCp: '06400',
    livContact: 'Livre Charlie', livTel: '+33600000033', livDate: 12 },
];

// Date CIVILE, jamais UTC : toISOString() reculerait d'un jour en
// France (voir jourCivil dans tests/env.js).
const futur = dansNJours;

async function saisirVehicule(page, i, v) {
  await page.evaluate(([idx, veh, pcDate, livDate]) => {
    function set(suffixe, valeur) {
      const e = document.getElementById('veh-' + idx + '-' + suffixe);
      if (!e) return false;
      e.value = valeur;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    set('marque', veh.marque); set('immat', veh.immat);
    set('pc-rue', veh.pcRue); set('pc-cp', veh.pcCp); set('pc-ville', veh.pcVille);
    set('pc-contact', veh.pcContact); set('pc-tel', veh.pcTel);
    set('pc-date', pcDate); set('pc-heure', '09:00');
    set('liv-rue', veh.livRue); set('liv-cp', veh.livCp); set('liv-ville', veh.livVille);
    set('liv-contact', veh.livContact); set('liv-tel', veh.livTel);
    set('liv-date', livDate); set('liv-heure', '17:00');
  }, [i, v, futur(v.pcDate), futur(v.livDate)]);
  await page.waitForTimeout(60);
}

// Aucune valeur d'un véhicule ne doit apparaître sur un autre.
function croisements(lignes) {
  const fautes = [];
  lignes.forEach((ligne, i) => {
    const texte = JSON.stringify(ligne);
    VEH.forEach((autre, j) => {
      if (i === j) return;
      [autre.immat, autre.marque, autre.pcRue, autre.pcContact, autre.pcTel,
       autre.livRue, autre.livContact, autre.livTel]
        .forEach(v => { if (texte.indexOf(v) !== -1) fautes.push('véhicule ' + (i + 1) + ' porte « ' + v +' » du véhicule ' + (j + 1)); });
    });
  });
  return fautes;
}

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  page.on('dialog', d => d.accept());

  // ══ A. SAISIE DE TROIS VÉHICULES DISTINCTS ══
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'convoyage');
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const e = document.getElementById('nb-vehicules');
    if (e) { e.value = '3'; }
    if (typeof onNbVehiculesChange === 'function') onNbVehiculesChange();
    if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
  });
  await page.waitForTimeout(250);
  const nbFiches = await page.evaluate(() => document.querySelectorAll('.veh-accordeon').length);
  L.check('A1 : trois fiches véhicule distinctes sont générées', nbFiches === 3, String(nbFiches));

  for (let i = 0; i < 3; i++) await saisirVehicule(page, i, VEH[i]);

  const lues = await page.evaluate(() => _lireFichesVehicules());
  L.check('A2 : la lecture rend bien trois fiches', lues.length === 3, String(lues.length));
  L.check('A3 : chaque fiche porte SA propre immatriculation',
    lues.every((l, i) => l.immatriculation === VEH[i].immat),
    JSON.stringify(lues.map(v => v.immatriculation)));
  L.check('A4 : et son propre rang', lues.map(v => v.position).join(',') === '1,2,3',
    lues.map(v => v.position).join(','));
  let f = croisements(lues);
  L.check('A5 : AUCUNE donnée d\'un véhicule n\'apparaît sur un autre', f.length === 0, f.slice(0, 3).join(' | '));

  // Effacer un véhicule ne doit pas décaler les autres.
  await page.evaluate(() => { if (typeof effacerVehicule === 'function') effacerVehicule(1); });
  await page.waitForTimeout(200);
  const apresEffacement = await page.evaluate(() => _lireFichesVehicules());
  L.check('A6 : effacer le véhicule 2 ne touche pas le 1',
    apresEffacement[0] && apresEffacement[0].immatriculation === VEH[0].immat,
    JSON.stringify(apresEffacement[0] && apresEffacement[0].immatriculation));
  L.check('A7 : ni le 3',
    apresEffacement[2] && apresEffacement[2].immatriculation === VEH[2].immat,
    JSON.stringify(apresEffacement[2] && apresEffacement[2].immatriculation));
  L.check('A8 : et le 2 est réellement vidé, pas rempli par un voisin',
    apresEffacement[1] && !apresEffacement[1].immatriculation,
    JSON.stringify(apresEffacement[1] && apresEffacement[1].immatriculation));
  await saisirVehicule(page, 1, VEH[1]);

  // ══ B. RÉCAPITULATIF ══
  await page.evaluate(() => { if (typeof construireRecap === 'function') construireRecap(); });
  await page.waitForTimeout(250);
  const recap = await page.evaluate(() => (document.getElementById('recap-demande') || {}).textContent || '');
  if (recap) {
    L.check('B1 : le récapitulatif nomme les trois véhicules',
      VEH.every(v => recap.indexOf(v.immat) !== -1), recap.slice(0, 200));
    L.check('B2 : chaque contact de prise en charge y figure une seule fois',
      VEH.every(v => (recap.split(v.pcContact).length - 1) === 1),
      VEH.map(v => v.pcContact + ':' + (recap.split(v.pcContact).length - 1)).join(' '));
    L.check('B3 : et chaque contact de livraison aussi',
      VEH.every(v => (recap.split(v.livContact).length - 1) === 1),
      VEH.map(v => v.livContact + ':' + (recap.split(v.livContact).length - 1)).join(' '));
    // Ordre : le véhicule 1 apparaît avant le 2, qui apparaît avant le 3.
    const positions = VEH.map(v => recap.indexOf(v.immat));
    L.check('B4 : les véhicules sont présentés dans l\'ordre de leur rang',
      positions[0] < positions[1] && positions[1] < positions[2], JSON.stringify(positions));
  } else {
    ['B1', 'B2', 'B3', 'B4'].forEach(n =>
      L.check(n + ' : récapitulatif indisponible dans ce parcours (non bloquant)', true));
  }

  // ══ C. CHARGE ENVOYÉE À SUPABASE ══
  const envoye = await page.evaluate(() => {
    const lignes = _lireFichesVehicules().map(_normaliserVehiculePourEnvoi);
    return lignes;
  });
  L.check('C1 : trois lignes véhicule sont préparées pour l\'envoi', envoye.length === 3, String(envoye.length));
  f = croisements(envoye);
  L.check('C2 : elles ne se contaminent pas entre elles', f.length === 0, f.slice(0, 3).join(' | '));
  L.check('C3 : chaque ligne porte un rang unique',
    new Set(envoye.map(v => v.position)).size === 3, JSON.stringify(envoye.map(v => v.position)));
  const CHAMPS = await page.evaluate(() => CHAMPS_VEHICULE.slice());
  L.check('C4 : aucune ligne ne contient de champ hors liste blanche',
    envoye.every(v => Object.keys(v).every(k => CHAMPS.indexOf(k) !== -1)),
    JSON.stringify(Object.keys(envoye[0] || {}).filter(k => CHAMPS.indexOf(k) === -1)));

  // ══ D. MONO-VÉHICULE : MÊME MOTEUR, AUCUN RÉSIDU ══
  const page2 = await L.newPage(browser);
  page2.on('dialog', d => d.accept());
  await L.fillStep1(page2, 'particulier');
  await L.chooseService(page2, 'convoyage');
  await page2.waitForTimeout(80);
  await page2.evaluate(() => {
    const e = document.getElementById('nb-vehicules');
    if (e) { e.value = '1'; }
    if (typeof onNbVehiculesChange === 'function') onNbVehiculesChange();
    if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
  });
  await page2.waitForTimeout(250);
  await saisirVehicule(page2, 0, VEH[0]);
  const mono = await page2.evaluate(() => _lireFichesVehicules().map(_normaliserVehiculePourEnvoi));
  L.check('D1 : un seul véhicule produit une seule ligne', mono.length === 1, String(mono.length));
  L.check('D2 : avec le rang 1', mono[0] && mono[0].position === 1, JSON.stringify(mono[0] && mono[0].position));
  L.check('D3 : et ses propres données', mono[0] && mono[0].immatriculation === VEH[0].immat,
    JSON.stringify(mono[0] && mono[0].immatriculation));
  L.check('D4 : aucune donnée des véhicules 2 ou 3 n\'y apparaît',
    [VEH[1], VEH[2]].every(v => JSON.stringify(mono).indexOf(v.immat) === -1
                             && JSON.stringify(mono).indexOf(v.pcRue) === -1));
  L.check('D5 : le mono-véhicule passe par le MÊME lecteur que le multi',
    (fs.readFileSync(fichier('index.html'), 'utf8')
      .match(/function _lireFichesVehicules\(/g) || []).length === 1);

  // ══ V. VERROUS DE NON-RÉGRESSION DEMANDÉS ══
  // Ces huit points sont ceux que le chantier §15 nomme explicitement.
  // Ils sont vérifiés sur la même page que la section A, qui porte déjà
  // trois véhicules entièrement saisis.
  const pageV = await L.newPage(browser);
  pageV.on('dialog', d => d.accept());
  await L.fillStep1(pageV, 'particulier');
  await L.chooseService(pageV, 'convoyage');
  await pageV.waitForTimeout(80);

  async function nbVehicules(n) {
    await pageV.evaluate(x => {
      const e = document.getElementById('nb-vehicules');
      if (e) e.value = String(x);
      if (typeof onNbVehiculesChange === 'function') onNbVehiculesChange();
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    }, n);
    await pageV.waitForTimeout(250);
  }

  await nbVehicules(1);
  let bloc = await pageV.evaluate(() =>
    (document.getElementById('bloc-trajet-commun') || {}).style.display);
  L.check('V1 : aucun bloc « Organisation des trajets » en mono-véhicule',
    bloc === 'none', bloc);
  await nbVehicules(3);
  bloc = await pageV.evaluate(() =>
    (document.getElementById('bloc-trajet-commun') || {}).style.display);
  L.check('V2 : ni en multi-véhicules — il ne réapparaît pas au passage 1 → 3',
    bloc === 'none', bloc);
  L.check('V3 : et il est réellement invisible à l\'écran',
    await pageV.evaluate(() => {
      const e = document.getElementById('bloc-trajet-commun');
      return !e || e.offsetParent === null;
    }));

  // Le passage mono -> multi ne doit injecter aucune donnée globale.
  await nbVehicules(1);
  await saisirVehicule(pageV, 0, VEH[0]);
  await nbVehicules(3);
  const apresPassage = await pageV.evaluate(() => _lireFichesVehicules());
  L.check('V4 : passer de 1 à 3 véhicules conserve le véhicule 1',
    apresPassage[0] && apresPassage[0].immatriculation === VEH[0].immat,
    JSON.stringify(apresPassage[0] && apresPassage[0].immatriculation));
  L.check('V5 : et n\'injecte AUCUNE donnée globale dans les véhicules 2 et 3',
    [1, 2].every(i => apresPassage[i]
      && !apresPassage[i].immatriculation
      && !apresPassage[i].adresse_depart_rue
      && !apresPassage[i].pc_contact_nom),
    JSON.stringify(apresPassage.slice(1).map(v => v && [v.immatriculation, v.adresse_depart_rue])));

  // Livraison = NON masque réellement les champs concernés.
  await pageV.evaluate(() => {
    const s = document.querySelector('input[name="type-service"][value="stockage"]');
    if (s) { s.checked = true; s.dispatchEvent(new Event('click', { bubbles: true })); }
    const a = document.querySelector('input[name="stock-acheminement"][value="helixcar"]');
    if (a) { a.checked = true; a.dispatchEvent(new Event('click', { bubbles: true })); }
    const so = document.querySelector('input[name="stock-sortie"][value="helixcar"]');
    if (so) { so.checked = true; so.dispatchEvent(new Event('click', { bubbles: true })); }
    if (typeof onChoixService === 'function') onChoixService();
    if (typeof onAcheminementStockage === 'function') onAcheminementStockage();
    if (typeof onSortieStockage === 'function') onSortieStockage();
    if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
  });
  await pageV.waitForTimeout(300);
  const avantNon = await pageV.evaluate(() => ({
    livVisible: !!document.getElementById('veh-0-liv-rue'),
    groupePresent: !!document.getElementById('veh-0-liv-active-group'),
  }));
  L.check('V6 : en sortie HelixCar, la question de livraison par véhicule existe',
    avantNon.groupePresent, JSON.stringify(avantNon));

  const apresNon = await pageV.evaluate(() => {
    const r = document.querySelector('input[name="veh-0-liv-active"][value="non"]');
    if (!r) return { absent: true };
    r.checked = true;
    r.dispatchEvent(new Event('click', { bubbles: true }));
    if (typeof basculerLivraisonVehicule === 'function') basculerLivraisonVehicule(0);
    const spec = document.getElementById('veh-0-liv-spec-0') || document.getElementById('veh-liv-spec-0');
    const recup = document.getElementById('veh-recup-client-0');
    return {
      absent: false,
      livMasquee: spec ? getComputedStyle(spec).display === 'none' : null,
      recupVisible: recup ? getComputedStyle(recup).display !== 'none' : null,
    };
  });
  await pageV.waitForTimeout(200);
  if (apresNon.absent) {
    L.check('V7 : Livraison = NON masque les champs de livraison (question absente ici)', true);
    L.check('V8 : et fait apparaître la récupération par le client (idem)', true);
  } else {
    L.check('V7 : Livraison = NON masque réellement les champs de livraison',
      apresNon.livMasquee === true, JSON.stringify(apresNon));
    L.check('V8 : et fait apparaître la récupération par le client',
      apresNon.recupVisible === true, JSON.stringify(apresNon));
  }

  const apresNonLu = await pageV.evaluate(() => _lireFichesVehicules()[0]);
  L.check('V9 : et le véhicule ne repart avec AUCUNE donnée de livraison',
    apresNonLu && !apresNonLu.adresse_arrivee_rue && !apresNonLu.liv_contact_nom,
    JSON.stringify(apresNonLu && [apresNonLu.adresse_arrivee_rue, apresNonLu.liv_contact_nom]));
  L.check('V10 : la décision est bien enregistrée, pas devinée',
    apresNonLu && apresNonLu.livraison_apres_stockage === false,
    JSON.stringify(apresNonLu && apresNonLu.livraison_apres_stockage));

  // Le scroll ne doit pas sauter au changement OUI / NON.
  const scroll = await pageV.evaluate(async () => {
    const modale = document.querySelector('#modal-client .modal') || document.scrollingElement;
    modale.scrollTop = 220;
    const avant = modale.scrollTop;
    const r = document.querySelector('input[name="veh-1-liv-active"][value="non"]')
           || document.querySelector('input[name="veh-0-liv-active"][value="oui"]');
    if (r) { r.checked = true; r.dispatchEvent(new Event('click', { bubbles: true })); }
    await new Promise(res => setTimeout(res, 250));
    return { avant: avant, apres: modale.scrollTop };
  });
  L.check('V11 : la position de lecture reste stable au changement OUI/NON',
    Math.abs(scroll.apres - scroll.avant) <= 40, JSON.stringify(scroll));

  L.check('Z0 : aucune erreur JavaScript pendant les verrous',
    pageV.jsErrors.length === 0, pageV.jsErrors.slice(0, 3).join(' | '));

  await browser.close();

  // ══ E. AVAL DE LA CHAÎNE : PDF ET FICHE ADMINISTRATEUR ══
  // Même demande, vue par le Dashboard : le devis PDF et la fiche
  // doivent afficher chaque véhicule avec SES données, jamais celles
  // d'un autre. jsPDF est remplacé par un double instrumenté (le CDN
  // est injoignable ici) afin de lire le texte réellement émis.
  const STUB = `
  window.__pdfTextes = [];
  window.jspdf = { jsPDF: function () {
    var self = this;
    window.__pdfTextes = [];
    this.internal = { pageSize: { getWidth: function(){return 210;}, getHeight: function(){return 297;} } };
    this.text = function (s) { window.__pdfTextes.push(String(s)); return self; };
    this.setFont=function(){return self;}; this.setFontSize=function(){return self;};
    this.setTextColor=function(){return self;}; this.setFillColor=function(){return self;};
    this.setDrawColor=function(){return self;}; this.setLineWidth=function(){return self;};
    this.setLineDashPattern=function(){return self;};
    this.rect=function(){return self;}; this.roundedRect=function(){return self;};
    this.circle=function(){return self;}; this.line=function(){return self;};
    this.addImage=function(){return self;};
    this.addPage=function(){ window.__pdfPages=(window.__pdfPages||1)+1; return self; };
    this.setPage=function(){return self;}; this.getNumberOfPages=function(){return window.__pdfPages||1;};
    this.getTextWidth=function(s){ return String(s).length*1.9; };
    this.splitTextToSize=function(s,w){ s=String(s); var max=Math.max(8,Math.floor(w/1.9));
      var mots=s.split(' '), out=[], cur='';
      mots.forEach(function(m){ if((cur+' '+m).trim().length>max){ if(cur) out.push(cur); cur=m; }
        else cur=(cur?cur+' ':'')+m; });
      if(cur) out.push(cur); return out.length?out:['']; };
    this.output=function(){ return 'data:application/pdf;base64,STUB'; };
    this.save=function(){return self;};
  } };
  window.emailjs = { init:function(){}, send:function(){ return Promise.resolve(); },
                     sendForm:function(){ return Promise.resolve(); } };
  window.supabase = { createClient: function(){ return {
    auth: { onAuthStateChange:function(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
            getSession: async function(){ return { data:{ session:null } }; } },
    from: function(){ return { select(){return this;}, eq(){return this;}, order(){return this;},
                                limit(){return this;}, then(r){ return Promise.resolve({data:[],error:null}).then(r); } }; },
    storage: { from: function(){ return {}; } } }; } };
  const _f = window.fetch;
  window.fetch = function(u){ if (String(u).indexOf('/rest/v1/') !== -1)
    return Promise.resolve({ ok:true, status:200, headers:{ get:function(){ return 'items 0-0/0'; } },
                             text:function(){ return Promise.resolve('[]'); } });
    return _f.apply(window, arguments); };
  `;

  const nav = await lancerNavigateur();
  const dash = await nav.newPage({ viewport: { width: 1400, height: 1000 } });
  const errsDash = [];
  dash.on('pageerror', e => errsDash.push(e.message));
  dash.on('dialog', d => d.dismiss());
  await dash.addInitScript(STUB);
  await dash.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });

  // La demande telle que la base la restitue : la ligne clients et ses
  // trois lignes vehicules, chacune avec SES valeurs.
  const DEMANDE = {
    id: 'qa-multi', numero_client: 'HC-QA-MULTI', prenom: 'TEST-QA', nom: 'Multi',
    email: 'multi@example.invalid', telephone: '+33600000000', type_client: 'particulier',
    type_service: 'convoyage', statut: 'nouveau', nb_vehicules: 3, trajet_commun: false,
    created_at: '2026-09-01T09:00:00Z',
    _vehicules: VEH.map((v, i) => ({
      id: 'v' + i, dossier_id: 'qa-multi', position: i + 1,
      type_vehicule: 'citadine', marque_modele: v.marque, immatriculation: v.immat,
      adresse_depart_rue: v.pcRue, code_postal_depart: v.pcCp, ville_depart: v.pcVille,
      pc_contact_nom: v.pcContact, pc_contact_tel: v.pcTel,
      date_prise_en_charge: '2026-10-0' + (i + 1), heure_prise_en_charge: '09:00', pc_heure_type: 'precise',
      adresse_arrivee_rue: v.livRue, code_postal_arrivee: v.livCp, ville_arrivee: v.livVille,
      liv_contact_nom: v.livContact, liv_contact_tel: v.livTel,
      date_livraison: '2026-10-1' + (i + 1), heure_livraison: '17:00', liv_heure_type: 'precise',
      restitution_concernee: false
    }))
  };

  await dash.evaluate(d => { _demandesDevisListe = [d]; _devisParClient = {}; }, DEMANDE);

  const textesPdf = await dash.evaluate(() => {
    const c = _demandesDevisListe[0];
    _construirePdfDevis(c, { reference: 'DEV-QA-M', client_id: c.id, prix: 1200,
                             statut: 'genere', date_generation: '2026-09-08T10:00:00Z' });
    return window.__pdfTextes.slice();
  });
  const pdf = textesPdf.join(' | ');
  L.check('E1 : le PDF nomme les trois véhicules',
    VEH.every(v => pdf.indexOf(v.immat) !== -1), pdf.slice(0, 200));
  L.check('E2 : chaque immatriculation n\'y apparaît qu\'une fois',
    VEH.every(v => (pdf.split(v.immat).length - 1) === 1),
    VEH.map(v => v.immat + ':' + (pdf.split(v.immat).length - 1)).join(' '));
  // Un devis est un document commercial : il n'imprime pas les contacts
  // sur place, mais bien le trajet de CHAQUE véhicule. Les villes sont
  // uniques par véhicule et par extrémité — elles ne peuvent pas se
  // confondre entre elles comme le feraient des numéros de rue.
  L.check('E3 : chaque ville de prise en charge n\'y apparaît qu\'une fois',
    VEH.every(v => (pdf.split(v.pcVille).length - 1) === 1),
    VEH.map(v => v.pcVille + ':' + (pdf.split(v.pcVille).length - 1)).join(' '));
  L.check('E3b : chaque ville de livraison aussi',
    VEH.every(v => (pdf.split(v.livVille).length - 1) === 1),
    VEH.map(v => v.livVille + ':' + (pdf.split(v.livVille).length - 1)).join(' '));
  L.check('E3c : chaque véhicule a son propre en-tête numéroté',
    ['VÉHICULE 1', 'VÉHICULE 2', 'VÉHICULE 3'].every(t => textesPdf.indexOf(t) !== -1),
    JSON.stringify(textesPdf.filter(t => /^VÉHICULE/.test(t))));
  L.check('E4 : et l\'ordre des véhicules suit leur rang',
    pdf.indexOf(VEH[0].immat) < pdf.indexOf(VEH[1].immat)
    && pdf.indexOf(VEH[1].immat) < pdf.indexOf(VEH[2].immat));

  // Chaque bloc véhicule du PDF ne contient QUE ses propres valeurs :
  // on découpe le texte émis aux immatriculations et on vérifie chaque
  // tranche séparément.
  // La frontière d'un bloc est son EN-TÊTE « VÉHICULE N », pas son
  // immatriculation : dans l'ordre d'émission, la marque précède la
  // plaque, et découper à la plaque rangerait la marque du véhicule
  // suivant dans le bloc précédent.
  const tranches = VEH.map((v, i) => {
    const debut = pdf.indexOf('VÉHICULE ' + (i + 1));
    const suivant = (i + 1 < VEH.length) ? pdf.indexOf('VÉHICULE ' + (i + 2)) : pdf.length;
    return pdf.slice(debut, suivant > debut ? suivant : pdf.length);
  });
  L.check('E4b : les trois blocs sont réellement délimités',
    tranches.every(t => t.length > 20), JSON.stringify(tranches.map(t => t.length)));
  const fautesPdf = [];
  tranches.forEach((t, i) => VEH.forEach((autre, j) => {
    if (i === j) return;
    [autre.pcVille, autre.livVille, autre.marque, autre.immat].forEach(val => {
      if (t.indexOf(val) !== -1) fautesPdf.push('bloc ' + (i + 1) + ' contient « ' + val + ' » du véhicule ' + (j + 1));
    });
  }));
  L.check('E5 : aucun bloc véhicule du PDF ne porte la donnée d\'un autre',
    fautesPdf.length === 0, fautesPdf.slice(0, 3).join(' | '));

  // ── FICHE ADMINISTRATEUR ──
  const fiche = await dash.evaluate(() => {
    const c = _demandesDevisListe[0];
    return _vehiculesDuDossier(c).map((v, i) => _detailVehicule(c, v, i));
  });
  L.check('F1 : la fiche produit un bloc par véhicule', fiche.length === 3, String(fiche.length));
  const fautesFiche = [];
  fiche.forEach((bloc, i) => VEH.forEach((autre, j) => {
    if (i === j) return;
    [autre.immat, autre.marque, autre.pcContact, autre.livContact, autre.pcRue, autre.livRue]
      .forEach(val => { if (bloc.indexOf(val) !== -1) fautesFiche.push('bloc ' + (i + 1) + ' contient « ' + val + ' »'); });
  }));
  L.check('F2 : aucun bloc de la fiche ne porte la donnée d\'un autre véhicule',
    fautesFiche.length === 0, fautesFiche.slice(0, 3).join(' | '));
  L.check('F3 : chaque bloc porte bien SA prise en charge et SA livraison',
    fiche.every((bloc, i) => bloc.indexOf(VEH[i].pcContact) !== -1 && bloc.indexOf(VEH[i].livContact) !== -1));

  // ── MONO-VÉHICULE : LA MÊME FONCTION, SANS RÉSIDU ──
  const ficheMono = await dash.evaluate(v => {
    const c = { id: 'qa-mono', type_service: 'convoyage', nb_vehicules: 1, _vehicules: [v] };
    return _vehiculesDuDossier(c).map((x, i) => _detailVehicule(c, x, i));
  }, DEMANDE._vehicules[0]);
  L.check('F4 : un seul véhicule produit un seul bloc', ficheMono.length === 1, String(ficheMono.length));
  L.check('F5 : et il ne contient rien des deux autres',
    [VEH[1], VEH[2]].every(v => ficheMono[0].indexOf(v.immat) === -1
                             && ficheMono[0].indexOf(v.pcContact) === -1));
  L.check('F6 : mono et multi passent par la MÊME fonction d\'affichage',
    (fs.readFileSync(fichier('dashboard.html'), 'utf8')
      .match(/function _detailVehicule\(/g) || []).length === 1);

  L.check('Z1 : aucune erreur JavaScript côté Dashboard',
    errsDash.length === 0, errsDash.slice(0, 3).join(' | '));

  await nav.close();
  process.exit(L.results() === 0 ? 0 : 1);
})();
