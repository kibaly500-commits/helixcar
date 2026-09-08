// CALENDRIER DE PÉRIODE : DATES ET HEURES DE DÉBUT / FIN (§7)
// ------------------------------------------------------------------
// Une période, c'est un début ET une fin. Le stockage disposait déjà du
// bon calendrier : une seule ouverture, on clique le début puis la fin,
// la plage se colore, rien ne se referme entre les deux. La période
// d'intervention d'un professionnel ouvrait, elle, deux calendriers
// séparés. Ce fichier vérifie, sur le VRAI formulaire, que les deux
// périodes se comportent désormais à l'identique — et que le stockage
// n'a rien perdu au passage.
const L = require('./lib.js');
const { RACINE, fichier, urlFichier, jourCivil, dansNJours } = L;

// Date CIVILE, jamais UTC : toISOString() reculerait d'un jour en
// France (voir jourCivil dans tests/env.js).
const futurYMD = dansNJours;

// Ouvre RÉELLEMENT le calendrier par la fonction de production.
async function ouvrir(page, id) {
  return page.evaluate(i => {
    const champ = document.getElementById(i);
    if (!champ) return { erreur: 'champ absent : ' + i };
    if (window._hcCalOverlay) window._hcCalOverlay.classList.remove('open');
    _hcCalPeriode = null; _hcCalSousEtapePeriode = null; _hcCalChampActif = null;
    _hcOuvrirCalendrier(champ);
    return {
      ouvert: !!(window._hcCalOverlay && _hcCalOverlay.classList.contains('open')),
      periode: _hcCalPeriode ? { debut: _hcCalPeriode.debut, fin: _hcCalPeriode.fin } : null,
      sousEtape: _hcCalSousEtapePeriode,
      champActif: _hcCalChampActif,
      legende: (document.getElementById('hc-cal-legende') || {}).textContent || '',
    };
  }, id);
}

// Clique un jour RÉELLEMENT présent dans la grille affichée.
async function cliquerJour(page, jour) {
  return page.evaluate(j => {
    const btn = document.querySelector('#hc-cal-grille .hc-cal-jour[data-jour="' + j + '"]');
    if (!btn) return { erreur: 'jour absent : ' + j };
    if (btn.disabled) return { desactive: true };
    btn.click();
    return {
      ouvertApres: !!(window._hcCalOverlay && _hcCalOverlay.classList.contains('open')),
      sousEtape: _hcCalSousEtapePeriode,
    };
  }, jour);
}

async function etatGrille(page) {
  return page.evaluate(() => {
    const out = { bornes: [], inter: [], desactives: [] };
    document.querySelectorAll('#hc-cal-grille .hc-cal-jour[data-jour]').forEach(b => {
      const j = parseInt(b.getAttribute('data-jour'), 10);
      if (b.classList.contains('hc-cal-jour--p1-borne')) out.bornes.push(j);
      if (b.classList.contains('hc-cal-jour--p1-inter')) out.inter.push(j);
      if (b.disabled) out.desactives.push(j);
    });
    return out;
  });
}

async function valeurs(page, ids) {
  return page.evaluate(list => {
    const o = {};
    list.forEach(i => { const e = document.getElementById(i); o[i] = e ? e.value : null; });
    return o;
  }, ids);
}

// Aligne le calendrier sur un mois complet et futur, pour que les
// numéros de jour cliqués existent et soient tous sélectionnables.
async function moisFuturComplet(page) {
  return page.evaluate(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2, 1);
    _hcCalAnneeAffichee = d.getFullYear();
    _hcCalMoisAffiche = d.getMonth();
    _hcRendreCalendrier();
    return { annee: _hcCalAnneeAffichee, mois: _hcCalMoisAffiche };
  });
}

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);

  // ══ A. PÉRIODE DE STOCKAGE — comportement de référence, inchangé ══
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'stockage');
  await page.waitForTimeout(80);

  let o = await ouvrir(page, 'stock-debut');
  L.check('A1 : le calendrier de stockage s\'ouvre en mode période',
    o.ouvert && o.periode && o.periode.debut === 'stock-debut' && o.periode.fin === 'stock-fin',
    JSON.stringify(o));
  L.check('A2 : il commence par la date de début', o.sousEtape === 'debut', o.sousEtape);
  L.check('A3 : la légende annonce la période et l\'étape en cours',
    /Début → fin du stockage/.test(o.legende) && /date de début/i.test(o.legende), o.legende);

  await moisFuturComplet(page);
  let c = await cliquerJour(page, 10);
  L.check('A4 : après le premier clic, le calendrier RESTE ouvert',
    c.ouvertApres === true, JSON.stringify(c));
  L.check('A5 : et il attend maintenant la date de fin', c.sousEtape === 'fin', c.sousEtape);
  let leg = await page.evaluate(() => (document.getElementById('hc-cal-legende') || {}).textContent || '');
  L.check('A6 : la légende le dit', /date de fin/i.test(leg), leg);

  let g = await etatGrille(page);
  L.check('A7 : les jours antérieurs au début sont désactivés pour la fin',
    g.desactives.indexOf(9) !== -1 && g.desactives.indexOf(10) === -1, JSON.stringify(g.desactives.slice(0, 12)));

  await cliquerJour(page, 15);
  g = await etatGrille(page);
  L.check('A8 : les deux bornes sont colorées',
    g.bornes.indexOf(10) !== -1 && g.bornes.indexOf(15) !== -1, JSON.stringify(g.bornes));
  L.check('A9 : la plage entre les deux est colorée, elle aussi',
    [11, 12, 13, 14].every(j => g.inter.indexOf(j) !== -1), JSON.stringify(g.inter));
  L.check('A10 : et rien au-delà des bornes',
    g.inter.indexOf(9) === -1 && g.inter.indexOf(16) === -1, JSON.stringify(g.inter));

  let v = await valeurs(page, ['stock-debut', 'stock-fin']);
  L.check('A11 : les deux champs sont réellement renseignés',
    /-10$/.test(v['stock-debut']) && /-15$/.test(v['stock-fin']), JSON.stringify(v));

  // Effacer ne vide que cette période.
  await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 5);
    const e = document.getElementById('client-date-pc');
    // Le formateur de la production : aucune conversion UTC.
    if (e) e.value = _hcFormaterYMD(d);
  });
  await page.evaluate(() => document.getElementById('hc-cal-effacer').click());
  await page.waitForTimeout(60);
  v = await valeurs(page, ['stock-debut', 'stock-fin', 'client-date-pc']);
  L.check('A12 : Effacer vide les deux bornes de la période',
    v['stock-debut'] === '' && v['stock-fin'] === '', JSON.stringify(v));
  L.check('A13 : et ne touche AUCUNE autre date du formulaire',
    !!v['client-date-pc'], JSON.stringify(v));
  L.check('A14 : le calendrier reste ouvert après Effacer',
    await page.evaluate(() => _hcCalOverlay.classList.contains('open')));
  L.check('A15 : et il redemande la date de début',
    await page.evaluate(() => _hcCalSousEtapePeriode === 'debut'));
  await page.evaluate(() => _hcFermerCalendrier());

  // ══ B. PÉRIODE D'INTERVENTION D'UN PROFESSIONNEL ══
  const page2 = await L.newPage(browser);
  await L.fillStep1(page2, 'pro');
  await L.chooseService(page2, 'professionnel');
  await page2.waitForTimeout(120);

  o = await ouvrir(page2, 'pro-date-debut');
  L.check('B1 : la période d\'intervention s\'ouvre elle aussi en mode période',
    o.ouvert && o.periode && o.periode.debut === 'pro-date-debut' && o.periode.fin === 'pro-date-fin',
    JSON.stringify(o));
  L.check('B2 : elle commence par la date de début', o.sousEtape === 'debut', o.sousEtape);
  L.check('B3 : sa légende lui est propre',
    /Début → fin de l'intervention/.test(o.legende), o.legende);

  await moisFuturComplet(page2);
  c = await cliquerJour(page2, 8);
  L.check('B4 : le calendrier RESTE ouvert après le premier clic',
    c.ouvertApres === true, JSON.stringify(c));
  L.check('B5 : et attend la date de fin', c.sousEtape === 'fin', c.sousEtape);

  g = await etatGrille(page2);
  L.check('B6 : la fin ne peut pas précéder le début',
    g.desactives.indexOf(7) !== -1 && g.desactives.indexOf(8) === -1,
    JSON.stringify(g.desactives.slice(0, 10)));

  await cliquerJour(page2, 12);
  g = await etatGrille(page2);
  L.check('B7 : les deux bornes sont colorées',
    g.bornes.indexOf(8) !== -1 && g.bornes.indexOf(12) !== -1, JSON.stringify(g.bornes));
  L.check('B8 : la plage intermédiaire est colorée',
    [9, 10, 11].every(j => g.inter.indexOf(j) !== -1), JSON.stringify(g.inter));

  v = await valeurs(page2, ['pro-date-debut', 'pro-date-fin']);
  L.check('B9 : les deux dates sont réellement écrites',
    /-08$/.test(v['pro-date-debut']) && /-12$/.test(v['pro-date-fin']), JSON.stringify(v));

  // Rouvrir par la borne de FIN doit modifier la fin, jamais le début.
  await page2.evaluate(() => _hcFermerCalendrier());
  o = await ouvrir(page2, 'pro-date-fin');
  L.check('B10 : rouvrir par la date de fin vise bien la fin',
    o.sousEtape === 'fin', o.sousEtape);
  await moisFuturComplet(page2);
  await cliquerJour(page2, 20);
  v = await valeurs(page2, ['pro-date-debut', 'pro-date-fin']);
  L.check('B11 : seule la fin a changé',
    /-08$/.test(v['pro-date-debut']) && /-20$/.test(v['pro-date-fin']), JSON.stringify(v));

  // Un nouveau début postérieur à la fin ne laisse pas une période absurde.
  await page2.evaluate(() => _hcFermerCalendrier());
  await ouvrir(page2, 'pro-date-debut');
  await moisFuturComplet(page2);
  await cliquerJour(page2, 25);
  v = await valeurs(page2, ['pro-date-debut', 'pro-date-fin']);
  L.check('B12 : un début postérieur à l\'ancienne fin vide cette fin',
    /-25$/.test(v['pro-date-debut']) && v['pro-date-fin'] === '', JSON.stringify(v));

  await page2.evaluate(() => document.getElementById('hc-cal-effacer').click());
  await page2.waitForTimeout(60);
  v = await valeurs(page2, ['pro-date-debut', 'pro-date-fin']);
  L.check('B13 : Effacer vide les deux bornes de l\'intervention',
    v['pro-date-debut'] === '' && v['pro-date-fin'] === '', JSON.stringify(v));
  await page2.evaluate(() => _hcFermerCalendrier());

  // ══ C. HEURES DE DÉBUT ET DE FIN ══
  const heures = await page2.evaluate(() => ({
    proDeb: !!document.getElementById('pro-horaire-cdeb'),
    proFin: !!document.getElementById('pro-horaire-cfin'),
    typeDeb: (document.getElementById('pro-horaire-cdeb') || {}).type,
    typeFin: (document.getElementById('pro-horaire-cfin') || {}).type,
  }));
  L.check('C1 : la période d\'intervention porte une heure de début ET de fin',
    heures.proDeb && heures.proFin, JSON.stringify(heures));
  L.check('C2 : ce sont bien des champs horaires',
    heures.typeDeb === 'time' && heures.typeFin === 'time', JSON.stringify(heures));

  // Sur une intervention d'UN SEUL jour, la fin doit suivre le début.
  await page2.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() + 30);
    const j = _hcFormaterYMD(d);
    ['pro-date-debut', 'pro-date-fin'].forEach(i => {
      const e = document.getElementById(i);
      e.value = j; e.dispatchEvent(new Event('change', { bubbles: true }));
    });
    ['pro-horaire-cdeb', 'pro-horaire-cfin'].forEach((i, k) => {
      const e = document.getElementById(i);
      e.value = k === 0 ? '14:00' : '09:00';
      e.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await page2.waitForTimeout(120);
  const refus = await page2.evaluate(() => {
    let ko = null;
    const ok = _proValiderRubrique('periode', function (id) { ko = id; });
    return { ok: ok, champ: ko,
             message: (document.querySelector('#pro-horaire-cfin ~ .field-error-msg, [data-erreur-pour="pro-horaire-cfin"]') || {}).textContent || '' };
  });
  L.check('C3 : le même jour, une fin antérieure au début est refusée',
    refus.ok === false && refus.champ === 'pro-horaire-cfin', JSON.stringify(refus));

  await page2.evaluate(() => {
    const e = document.getElementById('pro-horaire-cfin');
    e.value = '18:00'; e.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page2.waitForTimeout(80);
  const accepte = await page2.evaluate(() => _proValiderRubrique('periode', function () {}));
  L.check('C4 : une fin postérieure au début est acceptée', accepte === true, String(accepte));

  // Le stockage a lui aussi ses deux heures.
  const heuresStock = await page.evaluate(() => ({
    entree: (document.getElementById('stock-heure-entree') || {}).type,
    sortie: (document.getElementById('stock-heure-sortie') || {}).type,
  }));
  L.check('C5 : le stockage porte une heure d\'entrée ET une heure de sortie',
    heuresStock.entree === 'time' && heuresStock.sortie === 'time', JSON.stringify(heuresStock));

  // ══ D. UN SEUL MÉCANISME, DÉCLARATIF ══
  const src = require('fs').readFileSync(fichier('index.html'), 'utf8');
  L.check('D1 : les périodes sont déclarées dans une seule table',
    (src.match(/var HC_PERIODES_CALENDRIER = \[/g) || []).length === 1);
  L.check('D2 : la table couvre bien les deux périodes du formulaire',
    /stock-debut/.test(src.split('HC_PERIODES_CALENDRIER')[1].slice(0, 400))
    && /pro-date-debut/.test(src.split('HC_PERIODES_CALENDRIER')[1].slice(0, 400)));
  L.check('D3 : plus aucun mode « stockage » codé en dur dans le calendrier',
    src.indexOf('_hcCalModeStockage') === -1 && src.indexOf('_hcEffacerStockage') === -1);
  L.check('D4 : une seule fonction efface une période',
    (src.match(/function _hcEffacerPeriode\(/g) || []).length === 1);
  L.check('D5 : une seule fonction lit une période brute',
    (src.match(/function _hcPeriodeBrute\(/g) || []).length === 1);

  L.check('Z1 : aucune erreur JavaScript (formulaire stockage)',
    page.jsErrors.length === 0, page.jsErrors.slice(0, 2).join(' | '));
  L.check('Z2 : aucune erreur JavaScript (formulaire professionnel)',
    page2.jsErrors.length === 0, page2.jsErrors.slice(0, 2).join(' | '));

  await browser.close();
  process.exit(L.results() === 0 ? 0 : 1);
})();
