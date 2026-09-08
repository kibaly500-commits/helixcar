// Calendriers liés : mois d'ouverture, bornes, horaires même jour
const L = require('./lib.js');

function futur(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
// Prochain 10 décembre strictement futur
function decembreFutur() {
  const auj = new Date();
  let an = auj.getFullYear();
  if (auj > new Date(an, 11, 10)) an++;
  return an + '-12-10';
}
function janvierSuivant() { return (parseInt(decembreFutur().slice(0, 4), 10) + 1) + '-01-15'; }

async function setVal(page, id, v) {
  await page.evaluate(([i, val]) => {
    const e = document.getElementById(i);
    e.value = val;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, v]);
  await page.waitForTimeout(30);
}

// Ouvre RÉELLEMENT le calendrier via la fonction de production et lit le mois affiché
async function moisOuvert(page, champId) {
  return page.evaluate(id => {
    const champ = document.getElementById(id);
    if (!champ) return { erreur: 'champ absent' };
    if (window._hcCalOverlay) window._hcCalOverlay.classList.remove('open');
    _hcOuvrirCalendrier(champ);
    const res = { mois: _hcCalMoisAffiche, annee: _hcCalAnneeAffichee };
    if (window._hcCalOverlay) window._hcCalOverlay.classList.remove('open');
    return res;
  }, champId);
}

(async () => {
  const browser = await L.launch();
  const page = await L.newPage(browser);
  const DEC = decembreFutur();
  const JAN = janvierSuivant();
  const anDec = parseInt(DEC.slice(0, 4), 10);
  const auj = new Date();

  // ── A. Stockage : le calendrier de LIVRAISON suit la date de stockage ──
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'stockage');
  await page.waitForTimeout(60);
  // HelixCar assure l'acheminement ET la sortie -> les dates liées existent
  await page.evaluate(() => {
    const a = document.querySelector('input[name="stock-acheminement"][value="helixcar"]');
    if (a) { a.checked = true; a.dispatchEvent(new Event('click', { bubbles: true })); }
    const s = document.querySelector('input[name="stock-sortie"][value="helixcar"]');
    if (s) { s.checked = true; s.dispatchEvent(new Event('click', { bubbles: true })); }
    if (typeof onAcheminementStockage === 'function') onAcheminementStockage();
    if (typeof onSortieStockage === 'function') onSortieStockage();
  });
  await page.waitForTimeout(80);

  // Sans aucune date liée : mois actuel (règle 4)
  let m = await moisOuvert(page, 'client-date-livraison');
  L.check('A1 : sans aucune date liée, le calendrier ouvre sur le mois actuel',
    m.mois === auj.getMonth() && m.annee === auj.getFullYear(), JSON.stringify(m));

  // Début de stockage en DÉCEMBRE -> la livraison doit ouvrir en DÉCEMBRE
  await setVal(page, 'stock-debut', DEC);
  m = await moisOuvert(page, 'client-date-livraison');
  L.check('A2 : RÉGRESSION CORRIGÉE — début en décembre, la livraison ouvre en décembre',
    m.mois === 11 && m.annee === anDec, JSON.stringify(m) + ' attendu {mois:11,annee:' + anDec + '}');

  // La date propre du champ reste prioritaire (règle 1)
  await setVal(page, 'client-date-livraison', JAN);
  m = await moisOuvert(page, 'client-date-livraison');
  L.check('A3 : la date déjà choisie du champ reste prioritaire (janvier)',
    m.mois === 0 && m.annee === anDec + 1, JSON.stringify(m));

  // Décembre -> janvier : aucune date perdue en naviguant
  const conserve = await page.evaluate(() => ({
    debut: document.getElementById('stock-debut').value,
    liv: document.getElementById('client-date-livraison').value
  }));
  L.check('A4 : décembre -> janvier sans perte de date',
    conserve.debut === DEC && conserve.liv === JAN, JSON.stringify(conserve));

  // ── B. Parcours professionnel : période liée ──
  const page2 = await L.newPage(browser);
  await L.fillStep1(page2, 'pro');
  await L.chooseService(page2, 'professionnel');
  await page2.evaluate(() => { proBasculerRubrique('periode'); });
  await page2.waitForTimeout(60);

  m = await moisOuvert(page2, 'pro-date-fin');
  L.check('B1 : sans date de début, la fin ouvre sur le mois actuel',
    m.mois === auj.getMonth() && m.annee === auj.getFullYear(), JSON.stringify(m));

  await setVal(page2, 'pro-date-debut', DEC);
  m = await moisOuvert(page2, 'pro-date-fin');
  L.check('B2 : début en décembre -> la fin ouvre en décembre',
    m.mois === 11 && m.annee === anDec, JSON.stringify(m));

  // Borne minimale : la fin ne peut pas précéder le début
  const min = await page2.evaluate(() => {
    const d = _hcDateMinimaleChamp('pro-date-fin');
    return d ? d.toISOString().slice(0, 10) : null;
  });
  L.check('B3 : date minimale de la fin = date de début', min === DEC, 'min=' + min);

  // Période colorée comme Convoyage/Stockage
  await setVal(page2, 'pro-date-fin', anDec + '-12-12');
  const per = await page2.evaluate(() => {
    const p = _hcPeriodePourChamp('pro-date-debut');
    return { debut: p.debut ? p.debut.toISOString().slice(0, 10) : null,
             fin: p.finLiv ? p.finLiv.toISOString().slice(0, 10) : null };
  });
  L.check('B4 : période début/fin exposée au calendrier pour la coloration',
    per.debut === DEC && per.fin === anDec + '-12-12', JSON.stringify(per));

  // ── C. Horaires : même jour, fin antérieure refusée ──
  await setVal(page2, 'pro-date-fin', DEC);   // même jour que le début
  await setVal(page2, 'pro-horaire-cdeb', '14:00');
  await setVal(page2, 'pro-horaire-cfin', '11:00');
  let h = await page2.evaluate(() => ({
    memeJour: _proMemeJour(),
    complete: _proRubriqueComplete('periode'),
    erreur: (document.getElementById('pro-horaire-cfin-err') || {}).textContent || ''
  }));
  L.check('C1 : même jour détecté', h.memeJour === true);
  L.check('C2 : même jour + fin antérieure -> rubrique incomplète', h.complete === false);
  L.check('C3 : erreur horaire réellement affichée', /postérieure/i.test(h.erreur), h.erreur);

  await setVal(page2, 'pro-horaire-cfin', '18:00');
  h = await page2.evaluate(() => ({ complete: _proRubriqueComplete('periode'), duree: _proDureeJours() }));
  L.check('C4 : même jour + fin postérieure -> rubrique complète', h.complete === true);
  L.check('C5 : durée = 1 jour sur une période d\'un seul jour', h.duree === 1, 'duree=' + h.duree);

  // Multi-jours : les deux horaires redeviennent indépendants
  await setVal(page2, 'pro-date-fin', anDec + '-12-13');
  await setVal(page2, 'pro-horaire-cdeb', '14:00');
  await setVal(page2, 'pro-horaire-cfin', '11:00');
  h = await page2.evaluate(() => ({ complete: _proRubriqueComplete('periode'), duree: _proDureeJours() }));
  L.check('C6 : multi-jours -> fin matinale acceptée (fin de mission le dernier jour)', h.complete === true);
  L.check('C7 : durée multi-jours correcte', h.duree === 4, 'duree=' + h.duree);

  // Fin antérieure au début : refusée
  await setVal(page2, 'pro-date-fin', futur(1));
  h = await page2.evaluate(() => ({
    complete: _proRubriqueComplete('periode'),
    err: (document.getElementById('pro-date-fin-err') || {}).textContent || ''
  }));
  L.check('C8 : date de fin antérieure au début -> refusée', h.complete === false);
  L.check('C9 : erreur de chronologie affichée', /précéder/i.test(h.err), h.err);

  L.check('Aucune erreur JS (stockage)', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  L.check('Aucune erreur JS (professionnel)', page2.jsErrors.length === 0, page2.jsErrors.join(' | '));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
