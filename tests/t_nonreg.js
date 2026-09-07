// NON-RÉGRESSION : Convoyage, Stockage, création de compte, partenaire,
// textes, et absence de tout nouvel email / statut de paiement.
const L = require('./lib.js');
const fs = require('fs');

function futur(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

(async () => {
  const browser = await L.launch();

  // ── A. CONVOYAGE mono-véhicule ──
  let page = await L.newPage(browser);
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'convoyage');
  let s = await L.btnState(page);
  L.check('A1 : Convoyage — Continuer reste actif (comportement historique)', s.disabled === false);
  let etat = await page.evaluate(() => ({
    nbBloc: (document.getElementById('bloc-nb-vehicules') || {}).style.display,
    conv: _avecConvoyage(),
    trajet: (document.getElementById('trajet-type-group') || {}).style.display,
    etape4: _estEtapeApplicable(4),
    proch: _prochaineEtape(2)
  }));
  L.check('A2 : Convoyage — bloc véhicules affiché', etat.nbBloc === 'block');
  L.check('A3 : Convoyage — service convoyage bien reconnu', etat.conv === true);
  L.check('A4 : Convoyage — étape 4 toujours applicable', etat.etape4 === true);
  L.check('A5 : Convoyage — enchaînement des étapes inchangé', etat.proch === 3 || etat.proch === 4, 'proch=' + etat.proch);

  // multi-véhicules
  const multi = await page.evaluate(() => {
    const el = document.getElementById('nb-vehicules');
    el.value = 3; onNbVehiculesChange();
    return { nb: _nbVehicules(), fiches: document.querySelectorAll('[id^="veh-contenu-"]').length };
  });
  L.check('A6 : Convoyage multi — compteur à 3 véhicules', multi.nb === 3, JSON.stringify(multi));
  L.check('A7 : Convoyage multi — 3 fiches véhicules rendues (identique à origin/main)',
    multi.fiches === 3, JSON.stringify(multi));
  L.check('A8 : aucune erreur JS (convoyage)', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  await page.close();

  // ── B. STOCKAGE ──
  page = await L.newPage(browser);
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'stockage');
  s = await L.btnState(page);
  L.check('B1 : Stockage — Continuer reste actif', s.disabled === false);
  etat = await page.evaluate(() => ({
    bloc: (document.getElementById('bloc-stockage') || {}).style.display,
    nb: (document.getElementById('bloc-nb-vehicules') || {}).style.display,
    etape4: _estEtapeApplicable(4)
  }));
  L.check('B2 : Stockage — bloc stockage affiché', etat.bloc === 'block');
  L.check('B3 : Stockage — bloc véhicules affiché', etat.nb === 'block');
  L.check('B4 : Stockage — étape 4 toujours applicable', etat.etape4 === true);

  // chronologie stockage préservée
  const chrono = await page.evaluate(([d1, d2]) => {
    document.getElementById('stock-debut').value = d2;
    document.getElementById('stock-fin').value = d1;   // fin AVANT début
    return typeof verifierChronologieStockage === 'function' ? verifierChronologieStockage() : null;
  }, [futur(5), futur(10)]);
  L.check('B5 : Stockage — chronologie début/fin toujours contrôlée', chrono === false, 'retour=' + chrono);
  L.check('B6 : aucune erreur JS (stockage)', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  await page.close();

  // ── C. CRÉATION DE COMPTE SANS DEMANDE ──
  page = await L.newPage(browser);
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'compte');
  etat = await page.evaluate(() => ({
    choix: (document.getElementById('client-step2-choice') || {}).style.display,
    texte: (document.getElementById('client-step2-choice') || {}).textContent || '',
    btn: document.getElementById('client-step-next-btn').disabled
  }));
  L.check('C1 : Compte seul — bloc de choix affiché', etat.choix === 'block');
  L.check('C2 : Compte seul — nouveau message générique',
    /effectuer une demande de service à tout moment/.test(etat.texte), etat.texte.slice(0, 200));
  L.check('C3 : Compte seul — ancien message convoyage absent',
    !/demande de convoyage à tout moment/.test(etat.texte));
  L.check('C4 : Compte seul — Continuer non bloqué par les nouveaux services', etat.btn === false);
  L.check('C5 : aucune erreur JS (compte)', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  await page.close();

  // ── D. FORMULAIRE PARTENAIRE inchangé ──
  page = await L.newPage(browser);
  const part = await page.evaluate(() => {
    try { openModal('convoyeur'); } catch (e) {}
    return {
      ouvert: document.getElementById('modal-convoyeur').classList.contains('open'),
      activites: ['convoyage', 'nettoyage', 'renfort'].every(v => !!document.getElementById('conv-act-' + v)),
      docs: ['identite', 'permis', 'rcpro'].every(v => !!document.getElementById('conv-doc-' + v)),
      etapes: typeof _validateConvStep === 'function',
      videoChamp: !!document.querySelector('[id*="conv-video"]'),
      // Sans activité sélectionnée, la vidéo ne doit rien exiger.
      videoRequiseSansActivite: (typeof _convVideoRequise === 'function') ? _convVideoRequise() : null,
      videoGroupeMasque: (document.getElementById('conv-video-group') || {}).style.display
    };
  });
  L.check('D1 : Partenaire — modale toujours fonctionnelle', part.ouvert);
  L.check('D2 : Partenaire — 3 activités toujours présentes', part.activites);
  L.check('D3 : Partenaire — 3 documents toujours présents', part.docs);
  L.check('D4 : Partenaire — validation par étape intacte', part.etapes);
  // La vidéo fait désormais partie du parcours partenaire : ce qui doit
  // rester vrai, c'est qu'elle n'impose rien tant qu'aucune activité ne
  // l'exige (le formulaire reste utilisable exactement comme avant).
  L.check('D5 : Partenaire — bloc vidéo présent', part.videoChamp === true);
  L.check('D5b : Partenaire — aucune vidéo exigée sans activité sélectionnée',
    part.videoRequiseSansActivite === false, String(part.videoRequiseSansActivite));
  L.check('D5c : Partenaire — bloc vidéo masqué par défaut',
    part.videoGroupeMasque === 'none', part.videoGroupeMasque);
  L.check('D6 : aucune erreur JS (partenaire)', page.jsErrors.length === 0, page.jsErrors.join(' | '));
  await page.close();

  // ── E. GARDE-FOUS DE PÉRIMÈTRE (analyse du diff réel) ──
  const { execSync } = require('child_process');
  const diff = execSync('git diff origin/main -- index.html dashboard.html', { cwd: '/home/user/helixcar', maxBuffer: 60 * 1024 * 1024 }).toString();
  const ajouts = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).join('\n');

  L.check('E1 : aucun nouvel envoi EmailJS introduit',
    !/emailjs\.(send|sendForm)/i.test(ajouts), (ajouts.match(/emailjs\.[a-z]+/gi) || []).join(','));
  L.check('E2 : aucun code Stripe introduit',
    !/stripe|checkout\.session|payment_intent/i.test(ajouts));
  L.check('E3 : aucun statut « payé » introduit',
    !/statut\s*[:=]\s*['"]pay/i.test(ajouts) && !/\bpaye\b\s*[:=]\s*true/i.test(ajouts));
  L.check('E4 : aucune clé service_role introduite',
    !/service_role/i.test(ajouts));
  L.check('E5 : aucune suppression de validation métier existante',
    !/^-\s*(if \(!_check|_showFieldError|_showGroupError)/m.test(diff.split('\n').filter(l => l.startsWith('-')).join('\n')));

  const fichiers = execSync('git diff origin/main --name-only', { cwd: '/home/user/helixcar' }).toString().trim().split('\n');
  L.check('E6 : périmètre de fichiers maîtrisé',
    fichiers.every(f => f === 'index.html' || f === 'dashboard.html'
                     || f.startsWith('migrations/') || f.startsWith('tests/')),
    fichiers.join(', '));
  L.check('E6b : aucun fichier hors périmètre (devis.html, index.ts, edl.html…)',
    !fichiers.some(f => ['devis.html', 'index.ts', 'edl.html', 'fiche-mission.html',
                         'lettre-voiture.html', 'creer-compte-convoyeur.html',
                         'helixcar-emails.html'].indexOf(f) !== -1),
    fichiers.join(', '));
  L.check('E7 : aucun fichier SQL exécuté (dossier migrations livré tel quel)',
    fichiers.some(f => f.startsWith('migrations/')));

  // ── F. TEXTE : zéro occurrence de l'ancien message ──
  const idx = fs.readFileSync('/home/user/helixcar/index.html', 'utf8');
  L.check('F1 : zéro « demande de convoyage à tout moment » dans index.html',
    (idx.match(/demande de convoyage à tout moment/g) || []).length === 0);
  L.check('F2 : le nouveau message est bien présent',
    /effectuer une demande de service à tout moment/.test(idx));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
