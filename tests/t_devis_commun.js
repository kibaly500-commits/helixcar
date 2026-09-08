// SYSTÈME COMMUN DE DEVIS POUR LES QUATRE SERVICES (§9)
// ------------------------------------------------------------------
// Ce fichier prouve, sur le VRAI code du Dashboard, qu'un seul et même
// mécanisme de devis sert le convoyage, le stockage, le nettoyage et la
// recherche de professionnel — et qu'aucun d'eux n'hérite du texte d'un
// autre. Aucun e-mail n'est envoyé : le test n'appelle que les
// fonctions de composition et le générateur de PDF.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 220) + ']' : '')); fail++; echecs.push(l); }
}

const INIT = `
window.__pdfTextes = [];
window.jspdf = { jsPDF: function () {
  var self = this;
  window.__pdfTextes = [];
  this.internal = { pageSize: { getWidth: function(){return 210;}, getHeight: function(){return 297;} } };
  this.text = function (s) { window.__pdfTextes.push(String(s)); return self; };
  this.setFont = function(){return self;}; this.setFontSize = function(){return self;};
  this.setTextColor = function(){return self;}; this.setFillColor = function(){return self;};
  this.setDrawColor = function(){return self;}; this.setLineWidth = function(){return self;};
  this.setLineDashPattern = function(){return self;};
  this.rect = function(){return self;}; this.roundedRect = function(){return self;};
  this.circle = function(){return self;}; this.line = function(){return self;};
  this.addImage = function(){return self;};
  this.addPage = function(){ window.__pdfPages = (window.__pdfPages||1)+1; return self; };
  this.setPage = function(){return self;}; this.getNumberOfPages = function(){return window.__pdfPages||1;};
  this.getTextWidth = function (s) { return String(s).length * 1.9; };
  this.splitTextToSize = function (s, w) {
    s = String(s); var max = Math.max(8, Math.floor(w / 1.9));
    var mots = s.split(' '), out = [], cur = '';
    mots.forEach(function (m) {
      if ((cur + ' ' + m).trim().length > max) { if (cur) out.push(cur); cur = m; }
      else cur = (cur ? cur + ' ' : '') + m;
    });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  this.output = function(){ return 'data:application/pdf;base64,STUB'; };
  this.save = function(){return self;};
} };
window.__emails = [];
window.emailjs = { init: function(){}, send: function(){ window.__emails.push(1); return Promise.resolve(); },
                   sendForm: function(){ window.__emails.push(1); return Promise.resolve(); } };
window.supabase = { createClient: function () { return {
  auth: { onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
          getSession: async function () { return { data: { session: { access_token: 'jwt-test' } } }; } },
  from: function () { return { select: function(){return this;}, eq: function(){return this;},
                               order: function(){return this;}, limit: function(){return this;},
                               then: function(r){ return Promise.resolve({ data: [], error: null }).then(r); } }; },
  storage: { from: function () { return {}; } },
}; } };
const _f = window.fetch;
window.fetch = function (url) {
  if (String(url).indexOf('/rest/v1/') !== -1) {
    return Promise.resolve({ ok: true, status: 200, headers: { get: function(){ return 'items 0-0/0'; } },
                             text: function(){ return Promise.resolve('[]'); } });
  }
  return _f.apply(window, arguments);
};
`;

// Quatre demandes TEST-QA, une par service, entièrement renseignées.
const DEMANDES = {
  convoyage: {
    id: 'q-conv', prenom: 'TEST-QA', nom: 'Convoyage', email: 'conv@example.invalid',
    type_service: 'convoyage', statut: 'nouveau', nb_vehicules: 1, trajet_commun: false,
    ville_depart: 'Paris', ville_arrivee: 'Lyon', created_at: '2026-09-01T09:00:00Z',
  },
  stockage: {
    id: 'q-stock', prenom: 'TEST-QA', nom: 'Stockage', email: 'stock@example.invalid',
    type_service: 'stockage', statut: 'nouveau', nb_vehicules: 2, trajet_commun: false,
    stockage_ville: 'Marseille', stockage_date_debut: '2026-12-01', stockage_date_fin: '2026-12-20',
    stockage_nb_jours: 19, stockage_acheminement: 'helixcar', stockage_sortie: 'recuperation_client',
    created_at: '2026-09-01T09:00:00Z',
  },
  nettoyage: {
    id: 'q-nett', prenom: 'TEST-QA', nom: 'Nettoyage', email: 'nett@example.invalid',
    type_service: 'nettoyage', statut: 'nouveau', created_at: '2026-09-01T09:00:00Z',
    nettoyage_details: {
      schema_version: 2, type_nettoyage: 'interieur_exterieur', lieu: 'parc_client',
      nombre_vehicules_approx: 12, date_souhaitee: '2026-11-02', heure_precise: '09:00',
      adresse_rue: '3 rue des Lilas', adresse_cp: '69003', adresse_ville: 'Lyon',
      repartition_categories: [{ categorie: 'citadine', quantite: 12, precision: null }],
      contact_sur_place: { type: 'autre', nom: 'TEST-QA Martin', telephone: '+33600000020' },
    },
  },
  professionnel: {
    id: 'q-pro', prenom: 'TEST-QA', nom: 'Professionnel', email: 'pro@example.invalid',
    type_service: 'professionnel', statut: 'nouveau', created_at: '2026-09-01T09:00:00Z',
    professionnel_details: {
      schema_version: 1, categorie: 'technicien', specialite: 'carrosserie', conseil: false,
      nombre_professionnels: 2, nombre_vehicules: 5, adresse_rue: '9 rue Neuf',
      adresse_cp: '44000', adresse_ville: 'Nantes', date_debut: '2026-11-10',
      date_fin: '2026-11-12', duree_jours: 3, heure_debut: '08:00', heure_fin: '17:00',
      description: 'TEST-QA remise en etat', vehicules: [],
      contact_sur_place: { type: 'autre', nom: 'TEST-QA Durand', telephone: '+33600000050' },
    },
  },
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.dismiss());
  await page.addInitScript(INIT);
  await page.goto('file://' + path.resolve('/home/user/helixcar/dashboard.html'), { waitUntil: 'load' });

  await page.evaluate(d => {
    _demandesDevisListe = Object.values(d);
    _devisParClient = {};
  }, DEMANDES);

  async function composer(cle) {
    return page.evaluate(k => {
      const c = _demandesDevisListe.filter(x => x.id === k)[0];
      const devis = { reference: 'DEV-2026-0001', client_id: c.id, prix: 480, statut: 'genere',
                      date_generation: '2026-09-08T10:00:00Z' };
      return {
        objet: _objetDevis(c),
        corps: _corpsDevis(c, devis),
        description: _descriptionPrestation(c),
        nbVehicules: _nbVehiculesDossier(c),
        libellePrix: _devisLibelleService(c).prix,
        service: _typeServiceDemande(c),
      };
    }, cle);
  }

  const conv = await composer('q-conv');
  const stock = await composer('q-stock');
  const nett = await composer('q-nett');
  const pro = await composer('q-pro');

  // ── A. UN SEUL MOTEUR, QUATRE SERVICES ──
  check('A1 : le convoyage garde son objet', /Convoyage/.test(conv.objet), conv.objet);
  check('A2 : le stockage garde le sien', /Stockage/.test(stock.objet), stock.objet);
  check('A3 : le nettoyage n\'hérite plus de l\'objet du convoyage',
    !/Convoyage/i.test(nett.objet) && /[Nn]ettoyage/.test(nett.objet), nett.objet);
  check('A4 : la recherche de professionnel non plus',
    !/Convoyage/i.test(pro.objet) && /technicien/i.test(pro.objet), pro.objet);

  // ── B. LA DESCRIPTION N'EST JAMAIS VIDE ──
  [['B1', 'convoyage', conv], ['B2', 'stockage', stock], ['B3', 'nettoyage', nett], ['B4', 'professionnel', pro]]
    .forEach(([n, lib, r]) => {
      check(n + ' : la description du ' + lib + ' est renseignée',
        typeof r.description === 'string' && r.description.trim().length > 20,
        JSON.stringify(r.description));
    });
  check('B5 : le nettoyage décrit la VRAIE prestation choisie',
    /intérieur et extérieur/i.test(nett.description), nett.description);
  check('B6 : et le lieu réellement retenu', /parc automobile/i.test(nett.description), nett.description);
  check('B7 : et la date d\'intervention', /02\/11\/2026/.test(nett.description), nett.description);
  check('B8 : le professionnel décrit le nombre réellement demandé',
    /2 techniciens/i.test(pro.description), pro.description);
  check('B9 : et la période réellement saisie',
    /10\/11\/2026/.test(pro.description) && /12\/11\/2026/.test(pro.description), pro.description);
  check('B10 : le corps du nettoyage ne parle jamais de convoyage de véhicule',
    !/convoyage de/i.test(nett.corps), nett.corps.slice(0, 200));
  check('B11 : ni celui du professionnel', !/convoyage de/i.test(pro.corps), pro.corps.slice(0, 200));
  check('B12 : aucun corps ne comporte de paragraphe vide',
    [conv, stock, nett, pro].every(r => !/\n\n\n/.test(r.corps)));
  check('B13 : la signature couvre les quatre services',
    [conv, stock, nett, pro].every(r => /nettoyage et professionnels/i.test(r.corps)));

  // ── C. LE NOMBRE DE VÉHICULES VIENT DU BON ENDROIT ──
  check('C1 : convoyage — 1 véhicule', conv.nbVehicules === 1, String(conv.nbVehicules));
  check('C2 : stockage — 2 véhicules', stock.nbVehicules === 2, String(stock.nbVehicules));
  check('C3 : nettoyage — les 12 véhicules déclarés, pas 1',
    nett.nbVehicules === 12, String(nett.nbVehicules));
  check('C4 : professionnel — les 5 véhicules déclarés',
    pro.nbVehicules === 5, String(pro.nbVehicules));
  check('C5 : le nettoyage de flotte est bien annoncé au pluriel',
    /12 véhicules/.test(nett.description), nett.description);

  // ── D. LE CHAMP DE PRIX NOMME LA BONNE PRESTATION ──
  check('D1 : convoyage', conv.libellePrix === 'Prix du convoyage', conv.libellePrix);
  check('D2 : stockage', stock.libellePrix === 'Prix du stockage', stock.libellePrix);
  check('D3 : nettoyage', nett.libellePrix === 'Prix du nettoyage', nett.libellePrix);
  check('D4 : professionnel', pro.libellePrix === 'Prix de la prestation', pro.libellePrix);

  for (const [cle, attendu] of [['q-conv', 'Prix du convoyage'], ['q-nett', 'Prix du nettoyage'],
                                ['q-pro', 'Prix de la prestation'], ['q-stock', 'Prix du stockage']]) {
    await page.evaluate(k => ouvrirFicheDemande(k), cle);
    await page.waitForTimeout(200);
    const label = await page.evaluate(() => {
      const inp = document.getElementById('devis-prix-input');
      const bloc = inp ? inp.closest('div') : null;
      const lab = bloc ? bloc.querySelector('label') : null;
      return lab ? lab.textContent.trim() : '';
    });
    check('D5/' + cle + ' : la fiche affiche « ' + attendu + ' »',
      label.indexOf(attendu) === 0, label);
    await page.evaluate(() => closeModal('fiche-demande'));
  }

  // ── E. UN SEUL ET MÊME MÉCANISME ──
  const src = require('fs').readFileSync('/home/user/helixcar/dashboard.html', 'utf8');
  check('E1 : une seule fonction génère la référence du devis',
    (src.match(/function _genererReferenceDevis\(/g) || []).length === 1);
  check('E2 : une seule fonction construit le PDF',
    (src.match(/function _construirePdfDevis\(/g) || []).length === 1);
  check('E3 : une seule fonction envoie le devis au client',
    (src.match(/function envoyerDevis\(/g) || []).length === 1);
  check('E4 : plus aucun libellé « Prix du convoyage » codé en dur',
    src.indexOf('Prix du convoyage (€ TTC)') === -1);
  check('E5 : plus aucune invite « prix du convoyage » à la modification',
    src.indexOf('Nouveau prix du convoyage') === -1);

  // ── F. LE PDF SE CONSTRUIT POUR LES QUATRE SERVICES ──
  const pdfs = await page.evaluate(() => {
    const out = {};
    _demandesDevisListe.forEach(c => {
      const devis = { reference: 'DEV-2026-0001', client_id: c.id, prix: 480, statut: 'genere',
                      date_generation: '2026-09-08T10:00:00Z' };
      try {
        _construirePdfDevis(c, devis);
        out[c.type_service] = { ok: true, textes: window.__pdfTextes.slice() };
      } catch (e) { out[c.type_service] = { ok: false, err: e.message, textes: [] }; }
    });
    return out;
  });
  ['convoyage', 'stockage', 'nettoyage', 'professionnel'].forEach((sv, i) => {
    check('F' + (i + 1) + ' : le PDF du ' + sv + ' se construit sans erreur',
      pdfs[sv] && pdfs[sv].ok && pdfs[sv].textes.length > 20,
      JSON.stringify(pdfs[sv] && pdfs[sv].err));
  });
  const t = sv => (pdfs[sv].textes || []).join(' | ');
  check('F5 : les quatre PDF portent la même référence de devis',
    ['convoyage', 'stockage', 'nettoyage', 'professionnel']
      .every(sv => t(sv).indexOf('DEV-2026-0001') !== -1));
  check('F6 : les quatre portent le même montant',
    ['convoyage', 'stockage', 'nettoyage', 'professionnel']
      .every(sv => /480/.test(t(sv))));
  check('F7 : le PDF nettoyage nomme la prestation choisie',
    /intérieur et extérieur/i.test(t('nettoyage')), t('nettoyage').slice(0, 200));
  check('F8 : le PDF professionnel nomme la mise à disposition',
    /technicien/i.test(t('professionnel')), t('professionnel').slice(0, 200));
  check('F9 : le PDF nettoyage ne contient AUCUNE ligne de convoyage',
    !/Convoyage automobile/.test(t('nettoyage')));
  check('F10 : le PDF professionnel non plus',
    !/Convoyage automobile/.test(t('professionnel')));

  // ── H. LE BLOC DEVIS EST PRÉSENT DANS LES QUATRE FICHES ──
  for (const [cle, sv] of [['q-conv', 'convoyage'], ['q-stock', 'stockage'],
                           ['q-nett', 'nettoyage'], ['q-pro', 'professionnel']]) {
    await page.evaluate(k => ouvrirFicheDemande(k), cle);
    await page.waitForTimeout(200);
    const bloc = await page.evaluate(() => {
      const corps = document.getElementById('fiche-demande-corps');
      return {
        creer: corps ? corps.textContent.indexOf('Créer le devis') !== -1 : false,
        champ: !!document.getElementById('devis-prix-input'),
        bouton: corps ? corps.textContent.indexOf('Générer le devis') !== -1 : false,
      };
    });
    check('H/' + sv + ' : la fiche propose bien d\'établir un devis',
      bloc.creer && bloc.champ && bloc.bouton, JSON.stringify(bloc));
    await page.evaluate(() => closeModal('fiche-demande'));
  }
  const srcH = require('fs').readFileSync('/home/user/helixcar/dashboard.html', 'utf8');
  check('H5 : le bloc devis n\'est écrit qu\'UNE fois, et réutilisé',
    (srcH.match(/function _blocDevisHtml\(/g) || []).length === 1
    && (srcH.match(/html \+= _blocDevisHtml\(c\);/g) || []).length === 3
    && (srcH.match(/Créer le devis/g) || []).length === 1);

  check('G1 : aucun e-mail n\'a été envoyé pendant le test',
    (await page.evaluate(() => window.__emails.length)) === 0);
  check('Z1 : aucune erreur JavaScript', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
