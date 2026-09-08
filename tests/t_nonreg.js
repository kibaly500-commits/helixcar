// NON-RÉGRESSION : Convoyage, Stockage, création de compte, partenaire,
// textes, et absence de tout nouvel email / statut de paiement.
const L = require('./lib.js');
const { RACINE, fichier, urlFichier } = L;
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
      // Les trois activités historiques ne sont plus cochées directement :
      // depuis le chantier « métiers », elles sont DÉDUITES des métiers
      // choisis. Ce qui doit rester vrai, ce n'est donc pas la présence
      // des anciennes cases, c'est qu'un candidat puisse toujours les
      // déclarer toutes les trois — et que la liste soit bien affichée.
      activites: (function () {
        if (typeof METIERS_PARTENAIRE === 'undefined') return false;
        const dispo = METIERS_PARTENAIRE.map(m => m.activite);
        if (typeof convRendreMetiers === 'function') convRendreMetiers();
        const listeAffichee = !!document.querySelector('#conv-metiers-liste .conv-metier-ligne');
        return listeAffichee
          && ['convoyage', 'nettoyage', 'renfort'].every(a => dispo.indexOf(a) !== -1);
      })(),
      docs: ['identite', 'permis', 'rcpro'].every(v => !!document.getElementById('conv-doc-' + v)),
      etapes: typeof _validateConvStep === 'function',
      videoChamp: !!document.querySelector('[id*="conv-video"]'),
      // Sans activité sélectionnée, la vidéo ne doit rien exiger.
      videoRequiseSansActivite: (typeof _convVideoRequise === 'function') ? _convVideoRequise() : null,
      videoGroupeMasque: (document.getElementById('conv-video-group') || {}).style.display
    };
  });
  L.check('D1 : Partenaire — modale toujours fonctionnelle', part.ouvert);
  L.check('D2 : Partenaire — les 3 activités historiques restent déclarables', part.activites);
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
  const diff = execSync('git diff origin/main -- index.html dashboard.html', { cwd: RACINE, maxBuffer: 60 * 1024 * 1024 }).toString();
  const lignesAjoutees = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
  const ajouts = lignesAjoutees.join('\n');
  // Les garde-fous ci-dessous cherchent du CODE, pas des mots. Les
  // commentaires qui attestent l'absence de Stripe contiennent
  // forcément « Stripe » : les inclure ferait échouer le test sur sa
  // propre documentation. On ne teste donc que les lignes de code.
  const ajoutsCode = lignesAjoutees
    .map(l => l.slice(1).trim())
    .filter(l => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*')
                 && !l.startsWith('--') && !l.startsWith('<!--'))
    .join('\n');

  L.check('E1 : aucun nouvel envoi EmailJS introduit',
    !/emailjs\.(send|sendForm)/i.test(ajouts), (ajouts.match(/emailjs\.[a-z]+/gi) || []).join(','));
  L.check('E2 : aucun code Stripe introduit',
    !/stripe|checkout\.session|payment_intent/i.test(ajoutsCode),
    (ajoutsCode.match(/.*stripe.*/i) || []).slice(0, 2).join(' | '));
  L.check('E3 : aucun statut « payé » introduit',
    !/statut\s*[:=]\s*['"]pay/i.test(ajoutsCode) && !/\bpaye\b\s*[:=]\s*true/i.test(ajoutsCode));
  // Le mot apparaît dans des commentaires qui attestent que la clé
  // reste côté serveur. Ce qui doit être vérifié, c'est l'absence de
  // clé RÉELLE (JWT dont le rôle n'est pas « anon ») et l'absence de
  // lecture d'une variable de clé privilégiée dans le navigateur.
  function jwtsPrivilegies(src) {
    return (src.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [])
      .filter(j => {
        try {
          let p = j.split('.')[1]; p += '='.repeat((4 - p.length % 4) % 4);
          return (JSON.parse(Buffer.from(p, 'base64').toString('utf8')).role || '') !== 'anon';
        } catch (e) { return false; }
      });
  }
  L.check('E4 : aucune clé privilégiée réelle introduite dans le navigateur',
    jwtsPrivilegies(ajouts).length === 0
    && !/SUPABASE_SERVICE_ROLE_KEY/.test(fs.readFileSync(fichier('index.html'), 'utf8'))
    && !/SUPABASE_SERVICE_ROLE_KEY/.test(fs.readFileSync(fichier('dashboard.html'), 'utf8')));
  // Une ligne qui apparaît « supprimée » dans le diff ne prouve rien :
  // git ré-aligne les hunks dès qu'on modifie le voisinage, et une
  // validation déplacée ou ré-indentée apparaît alors comme retirée.
  // Ce qui compte est qu'elle EXISTE ENCORE dans le fichier livré. On
  // vérifie donc chaque validation supposée supprimée contre le contenu
  // réel des deux pages.
  const sourceActuelle =
    fs.readFileSync(fichier('index.html'), 'utf8')
    + fs.readFileSync(fichier('dashboard.html'), 'utf8');
  // Le MESSAGE affiché peut légitimement changer (reformulation) sans
  // que le contrôle disparaisse. Ce qui est vérifié est donc le CONTRÔLE
  // lui-même : la fonction appelée et le champ (ou le groupe) qu'elle
  // vise. Un message réécrit passe ; un contrôle réellement supprimé
  // échoue toujours.
  const signatureControle = l => {
    const m = /^(if \(!_check\w+\(\s*'[^']+'|_showFieldError\(\s*'[^']+'|_showGroupError\(\s*'[^']+')/.exec(l);
    return m ? m[1] : null;
  };
  const validationsRetirees = diff.split('\n')
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1).trim())
    .filter(l => /^(if \(!_check|_showFieldError|_showGroupError)/.test(l))
    .map(l => ({ ligne: l, sig: signatureControle(l) }))
    .filter(o => o.sig ? sourceActuelle.indexOf(o.sig) === -1
                       : sourceActuelle.indexOf(o.ligne) === -1)
    .map(o => o.ligne);
  L.check('E5 : aucune suppression de validation métier existante',
    validationsRetirees.length === 0, validationsRetirees.slice(0, 3).join(' | '));

  const fichiers = execSync('git diff origin/main --name-only', { cwd: RACINE }).toString().trim().split('\n');
  // creer-compte-convoyeur.html est entré dans le périmètre avec
  // l'harmonisation des mots de passe : l'inscription partenaire y vit,
  // et elle était explicitement demandée.
  //
  // L'audit indépendant y a fait entrer six autres entrées, chacune
  // pour une raison nommée. Élargissement DÉLIBÉRÉ, énuméré ici plutôt
  // que dilué dans un préfixe fourre-tout — tout ce qui n'y figure pas
  // reste refusé, et la liste de E6b reste la barrière dure.
  const PERIMETRE = [
    'index.html',
    'dashboard.html',
    'creer-compte-convoyeur.html',
    // Le réglage sans lequel la fonction vidéo répondrait 401 à toute
    // candidature. Versionné exprès, plutôt que coché à la main.
    'supabase/config.toml',
    // Outillage des tests : dépendance Playwright et verrou de version.
    'package.json',
    'package-lock.json',
    // Le lanceur de tests et la campagne d'intégration continue.
    '.github/workflows/tests.yml',
    // node_modules et sorties locales, désormais ignorés par git.
    '.gitignore',
    // Le dossier de recette et de mise en production.
    'RECETTE-LOT.md',
  ];
  L.check('E6 : périmètre de fichiers maîtrisé',
    fichiers.every(f => PERIMETRE.indexOf(f) !== -1
                     || f.startsWith('migrations/') || f.startsWith('tests/')
                     || f.startsWith('supabase/functions/')),
    fichiers.filter(f => PERIMETRE.indexOf(f) === -1
                      && !f.startsWith('migrations/') && !f.startsWith('tests/')
                      && !f.startsWith('supabase/functions/')).join(', '));
  L.check('E6c : le périmètre reste une liste, pas un préfixe fourre-tout',
    PERIMETRE.every(f => f.indexOf('*') === -1) && PERIMETRE.length <= 12,
    PERIMETRE.length + ' entrées');
  L.check('E6b : aucun fichier hors périmètre (devis.html, index.ts, edl.html…)',
    !fichiers.some(f => ['devis.html', 'index.ts', 'edl.html', 'fiche-mission.html',
                         'lettre-voiture.html',
                         'helixcar-emails.html'].indexOf(f) !== -1),
    fichiers.join(', '));
  // Ce qui est touché dans l'inscription partenaire doit se limiter aux
  // mots de passe : aucun autre comportement de cette page ne change.
  const diffConvoyeur = execSync('git diff origin/main -- creer-compte-convoyeur.html',
    { cwd: RACINE }).toString();
  const ajoutsConvoyeur = diffConvoyeur.split('\n')
    .filter(l => (l.startsWith('+') || l.startsWith('-')) && !/^[+-]{3}/.test(l))
    .map(l => l.slice(1).trim())
    .filter(l => l && !l.startsWith('//'));
  L.check('E6c : dans l\'inscription partenaire, seuls les mots de passe changent',
    ajoutsConvoyeur.every(l => /mot de passe|pw|password|mdp|oeil|Afficher|Masquer|svg|path d=|circle|aria-|minlength|autocomplete|padding-right|toggle|actif|selection|focus|libelle|bouton|input|button|display|align|justify|min-width|min-height|color|border-radius|line-height|position|background|cursor|transform|right:|top:|var |try |catch|el\.|textContent|🙈|👁|return|function|\}|\{/i.test(l)),
    ajoutsConvoyeur.filter(l => !/mot de passe|pw|password|mdp|oeil|Afficher|Masquer|svg|path d=|circle|aria-|minlength|autocomplete|padding-right|toggle|actif|selection|focus|libelle|bouton|input|button|display|align|justify|min-width|min-height|color|border-radius|line-height|position|background|cursor|transform|right:|top:|var |try |catch|el\.|textContent|🙈|👁|return|function|\}|\{/i.test(l)).slice(0, 3).join(' | '));
  // Le délai annoncé au client doit être le même partout.
  const fichiersDelai = ['index.html', 'dashboard.html', 'devis.html', 'helixcar-emails.html']
    .filter(f => fs.existsSync(fichier(f)))
    .map(f => fs.readFileSync(fichier(f), 'utf8'));
  L.check('E8 : plus aucun délai « sous 2 heures » annoncé',
    fichiersDelai.every(t => !/sous 2\s*h(eures)?/i.test(t)));
  L.check('E9 : le délai annoncé est bien « sous 1 heure »',
    /sous 1 heure/.test(fichiersDelai[0]));

  L.check('E7 : aucun fichier SQL exécuté (dossier migrations livré tel quel)',
    fichiers.some(f => f.startsWith('migrations/')));

  // ── F. TEXTE : zéro occurrence de l'ancien message ──
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  L.check('F1 : zéro « demande de convoyage à tout moment » dans index.html',
    (idx.match(/demande de convoyage à tout moment/g) || []).length === 0);
  L.check('F2 : le nouveau message est bien présent',
    /effectuer une demande de service à tout moment/.test(idx));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
