// Devis PDF des nouveaux services — exécution réelle de _construirePdfDevis
// avec un stub jsPDF instrumenté (le jsPDF CDN est injoignable en sandbox).
// Ce test vérifie le CONTENU réellement émis, pas le rendu visuel.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

let pass = 0, fail = 0; const failures = [];
function check(l, c, e) { if (c) { console.log('PASS - ' + l); pass++; } else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; failures.push(l); } }

const STUB = `
window.__pdfTextes = [];
window.jspdf = { jsPDF: function () {
  var self = this;
  window.__pdfTextes = [];
  this.internal = { pageSize: { getWidth: function(){return 210;}, getHeight: function(){return 297;} } };
  this.text = function (s, x, y) { window.__pdfTextes.push(String(s)); return self; };
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
`;

const CLIENT = {
  id: 'test-qa-1', numero_client: 'HC-TESTQA', prenom: 'TEST-QA', nom: 'Dupont',
  email: 'test-qa@example.invalid', telephone: '+33600000000', type_client: 'pro',
  societe: 'TEST-QA Flotte SAS', statut: 'nouveau', created_at: '2026-09-01T10:00:00Z'
};

const DEM_NETT = Object.assign({}, CLIENT, {
  type_service: 'nettoyage',
  nettoyage_details: {
    schema_version: 2,
    conditions: { professionnel: true, emplacement_adapte: true, eau_electricite: true },
    nombre_vehicules_approx: 3,
    repartition_categories: [
      { categorie: 'berline_break', quantite: 1, precision: null },
      { categorie: 'suv_4x4', quantite: 2, precision: null }
    ],
    type_nettoyage: 'preparation_complete',
    lieu: 'locaux_client',
    adresse_rue: '24 avenue Victor-Hugo', adresse_cp: '93260', adresse_ville: 'Les Lilas',
    date_souhaitee: '2026-09-14', dispo_type: 'precise', heure_precise: '09:00',
    creneau_debut: null, creneau_fin: null, delai: 'standard',
    contact_sur_place: { type: 'autre', nom: 'Karim B.', telephone: '06 00 00 00 00' }
  }
});

const DEM_TECH = Object.assign({}, CLIENT, {
  societe: 'Automobiles du Centre', type_service: 'professionnel',
  professionnel_details: {
    schema_version: 1, categorie: 'technicien', conseil: false,
    specialite: 'diagnostic', mission: null, precision: null,
    nombre_professionnels: 1, nombre_vehicules: 2,
    vehicules: [
      { position: 1, type_vehicule: 'berline', marque_modele: 'BMW Série 3' },
      { position: 2, type_vehicule: 'suv', marque_modele: 'Audi Q5' }
    ],
    adresse_rue: '18 rue de Paris', adresse_cp: '93160', adresse_ville: 'Noisy-le-Grand',
    contact_sur_place: { type: 'moi', nom: 'Paul Martin', telephone: '+33611111111' },
    date_debut: '2026-09-21', date_fin: '2026-09-22', duree_jours: 2,
    heure_debut: '09:00', heure_fin: '17:00',
    description: 'Recherche de panne et diagnostic électronique',
    informations_complementaires: null
  }
});

const DEM_RENFORT = Object.assign({}, CLIENT, {
  societe: 'Concession République', type_service: 'professionnel',
  professionnel_details: {
    schema_version: 1, categorie: 'renfort', conseil: false,
    specialite: null, mission: 'jockey', precision: null,
    nombre_professionnels: 2, nombre_vehicules: null, vehicules: [],
    adresse_rue: '12 boulevard Voltaire', adresse_cp: '75011', adresse_ville: 'Paris',
    contact_sur_place: { type: 'autre', nom: 'Sophie M.', telephone: '06 11 22 33 44' },
    date_debut: '2026-09-28', date_fin: '2026-09-30', duree_jours: 3,
    heure_debut: '08:30', heure_fin: '17:30',
    description: 'Accueil et préparation des véhicules du parc',
    informations_complementaires: 'Badge d’accès à retirer à l’accueil.'
  }
});

const DEVIS = { reference: 'DEV-2026-TESTQA', prix: 1250, statut: 'genere', date_generation: '2026-09-07T09:00:00Z' };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.resolve('/home/user/helixcar/dashboard.html'), { waitUntil: 'load' });
  await page.addScriptTag({ content: STUB });

  const dispo = await page.evaluate(() => typeof _construirePdfDevis === 'function');
  check('Fonction _construirePdfDevis disponible', dispo);

  async function genere(dem) {
    return page.evaluate(([d, dv]) => {
      try { _construirePdfDevis(d, dv); return { ok: true, textes: window.__pdfTextes.slice() }; }
      catch (e) { return { ok: false, err: e.message, stack: String(e.stack).slice(0, 300) }; }
    }, [dem, DEVIS]);
  }

  // ── NETTOYAGE ──
  let r = await genere(DEM_NETT);
  check('Devis NETTOYAGE généré sans exception', r.ok, r.err + ' | ' + r.stack);
  let t = (r.textes || []).join(' | ');
  let tw = (r.textes || []).join(' ');   // fragments recollés : tolère un libellé réparti sur 2 lignes
  check('Nettoyage : titre de service présent', /Nettoyage automobile/i.test(t), t.slice(0, 300));
  check('Nettoyage : nombre de véhicules', /\| 3 \|/.test(' | ' + t + ' | '), t.slice(0, 400));
  check('Nettoyage : formule affichée', /Préparation complète/i.test(t));
  check('Nettoyage : adresse d\'intervention', /24 avenue Victor-Hugo/.test(t));
  check('Nettoyage : CONTACT SUR PLACE affiché', /Contact sur place/i.test(t) && /Karim B\. — 06 00 00 00 00/.test(t), t.slice(0, 600));
  check('Nettoyage : répartition par catégorie', /Berline \/ Break/.test(t) && /SUV \/ 4x4/.test(t));
  check('Nettoyage : prestation = formule demandée', /Préparation complète/.test(t));
  check('Nettoyage : bande tarif présente', /TARIF PROPOSÉ/.test(t));
  check('Nettoyage : aucune donnée convoyage/stockage inventée',
    !/Prise en charge|Livraison|Stockage automobile|Restitution|Plateau/i.test(t), t.slice(0, 800));

  // ── TECHNICIEN ──
  r = await genere(DEM_TECH);
  check('Devis TECHNICIEN généré sans exception', r.ok, r.err + ' | ' + r.stack);
  t = (r.textes || []).join(' | ');
  tw = (r.textes || []).join(' ');
  check('Technicien : titre de service', /Trouver un professionnel automobile/i.test(t));
  check('Technicien : besoin affiché (libellé long réparti sur 2 lignes, comme la maquette)',
    /Technicien automobile/.test(tw), tw.slice(0, 400));
  check('Technicien : spécialité affichée', /Diagnostic/.test(t));
  check('Technicien : lieu affiché', /18 rue de Paris/.test(t));
  check('Technicien : contact sur place', /Paul Martin — \+33611111111/.test(t), t.slice(0, 700));
  check('Technicien : période', /21\/09\/2026/.test(t) && /22\/09\/2026/.test(t), t.slice(0, 700));
  check('Technicien : horaires', /09:00 – 17:00/.test(t));
  check('Technicien : mission décrite', /Recherche de panne/.test(t));
  check('Technicien : les 2 véhicules', /BMW Série 3/.test(t) && /Audi Q5/.test(t));
  check('Technicien : types de véhicule lisibles', /Berline/.test(t) && /SUV \/ Crossover/.test(t));
  check('Technicien : prestation formulée', /Mise à disposition d'un technicien automobile/.test(t), t.slice(0, 900));
  check('Technicien : ni immatriculation ni VIN ni restitution',
    !/IMMATRICULATION|VIN|Restitution/i.test(t), t.slice(0, 900));
  check('Technicien : aucun bloc Informations complémentaires vide',
    !/Informations complémentaires/i.test(t), t.slice(0, 900));

  // ── RENFORT ──
  r = await genere(DEM_RENFORT);
  check('Devis RENFORT généré sans exception', r.ok, r.err + ' | ' + r.stack);
  t = (r.textes || []).join(' | ');
  tw = (r.textes || []).join(' ');
  check('Renfort : besoin affiché (libellé long réparti sur 2 lignes, comme la maquette)',
    /Renfort automobile sur site/.test(tw), tw.slice(0, 400));
  check('Renfort : mission affichée', /Jockey automobile/.test(t));
  check('Renfort : nombre de professionnels', /\| 2 \|/.test(' | ' + t + ' | '), t.slice(0, 500));
  check('Renfort : durée calculée affichée', /3 jours/.test(t), t.slice(0, 600));
  check('Renfort : type de mission décrit', /Accueil et préparation des véhicules du parc/.test(t));
  check('Renfort : contact sur place', /Sophie M\. — 06 11 22 33 44/.test(t));
  check('Renfort : prestation au pluriel correcte',
    /Mise à disposition de 2 renforts automobiles sur site/.test(t), t.slice(0, 900));
  check('Renfort : AUCUN bloc véhicule (non applicable)',
    !/Véhicule 1|Information sur le véhicule/i.test(t), t.slice(0, 900));
  check('Renfort : informations complémentaires affichées car présentes',
    /Informations complémentaires/i.test(t) && /Badge/.test(t), t.slice(0, 1000));

  // ── NON-RÉGRESSION : convoyage inchangé ──
  const DEM_CONV = Object.assign({}, CLIENT, {
    type_service: 'convoyage', nb_vehicules: 1, ville_depart: 'Paris', ville_arrivee: 'Lyon',
    adresse_depart_rue: '1 rue A', adresse_arrivee_rue: '2 rue B',
    date_prise_en_charge: '2026-10-01', date_livraison: '2026-10-02',
    type_vehicule: 'berline', marque_modele: 'Peugeot 308', restitution: 'Non'
  });
  r = await genere(DEM_CONV);
  check('NON-RÉGRESSION : devis convoyage généré sans exception', r.ok, r.err + ' | ' + r.stack);
  t = (r.textes || []).join(' | ');
  check('NON-RÉGRESSION : convoyage garde ses sections', /Convoyage automobile/i.test(t), t.slice(0, 500));
  check('NON-RÉGRESSION : convoyage sans bloc des nouveaux services',
    !/Trouver un professionnel|Mission sur site|Véhicules à nettoyer/i.test(t));
  check('NON-RÉGRESSION : bande tarif toujours présente', /TARIF PROPOSÉ/.test(t));

  check('Aucune erreur JS de page', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (failures.length) failures.forEach(f => console.log('  - ' + f));
  process.exit(fail > 0 ? 1 : 0);
})();
