// NON-RÉGRESSION : Convoyage, Stockage, création de compte, partenaire,
// textes, et absence de tout nouvel email / statut de paiement.
const L = require('./lib.js');
const { RACINE, fichier, urlFichier, jourCivil, dansNJours } = L;
const fs = require('fs');

// Date CIVILE, jamais UTC : toISOString() reculerait d'un jour en
// France (voir jourCivil dans tests/env.js).
const futur = dansNJours;

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
  const indexHtml = fs.readFileSync(fichier('index.html'), 'utf8');
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

  L.check('E2 : l’adresse publique HelixCar est la boîte officielle du domaine',
    /mailto:contact@helixcar\.fr/.test(indexHtml)
      && /HELIXCAR_EMAIL_ADMIN\s*=\s*['"]contact@helixcar\.fr['"]/.test(indexHtml));
  L.check('E3 : aucun code Stripe introduit',
    !/stripe|checkout\.session|payment_intent/i.test(ajoutsCode),
    (ajoutsCode.match(/.*stripe.*/i) || []).slice(0, 2).join(' | '));
  L.check('E4 : aucun statut « payé » introduit',
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
  L.check('E5 : aucune clé privilégiée réelle introduite dans le navigateur',
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
  // RETRAITS DÉLIBÉRÉS, ÉNUMÉRÉS UN PAR UN.
  //
  // Ce garde-fou existe pour attraper une validation supprimée par
  // inadvertance. Quand un retrait est au contraire DEMANDÉ, il est
  // nommé ici — jamais dilué dans un assouplissement de la règle. Tout
  // ce qui n'y figure pas continue de faire échouer le test.
  //
  // La question « Quelle est votre disponibilité ? » (Heure précise /
  // Créneau horaire / Flexible) a été retirée du parcours Nettoyage sur
  // demande explicite. Le champ d'heure précise disparaissait avec elle,
  // et sa validation avec lui.
  const RETRAITS_DELIBERES = [
    "if (!_checkRequiredText('nett-heure'",
    "_showGroupError('nett-dispo-group'",
    // LOT D4 — la rubrique « Informations sur les véhicules » du
    // parcours professionnel a été SUPPRIMÉE sur demande explicite :
    // elle n'existait que pour le technicien, dont le besoin porte sur
    // des personnes et une période, jamais sur un parc. Ses deux
    // validations disparaissent donc avec elle. Compensé par E5e.
    "_showFieldError('pro-veh-",
    "_showFieldError('pro-veh-'"
  ];
  const validationsRetirees = diff.split('\n')
    .filter(l => l.startsWith('-') && !l.startsWith('---'))
    .map(l => l.slice(1).trim())
    .filter(l => /^(if \(!_check|_showFieldError|_showGroupError)/.test(l))
    .map(l => ({ ligne: l, sig: signatureControle(l) }))
    .filter(o => !RETRAITS_DELIBERES.some(r => (o.sig || o.ligne).indexOf(r) === 0))
    .filter(o => o.sig ? sourceActuelle.indexOf(o.sig) === -1
                       : sourceActuelle.indexOf(o.ligne) === -1)
    .map(o => o.ligne);
  L.check('E5 : aucune suppression de validation métier existante',
    validationsRetirees.length === 0, validationsRetirees.slice(0, 3).join(' | '));
  // Le garde-fou ne doit pas devenir un fourre-tout : chaque retrait
  // délibéré est compensé par une validation qui, elle, DOIT exister.
  L.check('E5b : les retraits délibérés restent une liste courte et nommée',
    RETRAITS_DELIBERES.length <= 6);
  L.check('E5c : la période de nettoyage est validée à la place',
    /_checkDate\('nett-date-fin', true\)/.test(sourceActuelle)
    && /La fin ne peut pas pr/.test(sourceActuelle),
    'validation de la date de fin absente');
  L.check('E5d : et la cohérence de l\'horaire sur place aussi',
    /_showFieldError\('nett-creneau-fin'/.test(sourceActuelle));
  // LOT D3 — l'horaire sur place n'est plus facultatif : sa PRÉSENCE
  // est désormais exigée, ce qui est strictement plus strict.
  L.check('E5d bis : les deux horaires de nettoyage sont maintenant obligatoires',
    /_showFieldError\('nett-creneau-debut', 'Ce champ est obligatoire\.'\)/.test(sourceActuelle)
    && /_showFieldError\('nett-creneau-fin', 'Ce champ est obligatoire\.'\)/.test(sourceActuelle));
  // LOT D4 — compensation nommée du retrait ci-dessus : la rubrique
  // n'existe plus DU TOUT, donc rien ne peut plus la valider à moitié.
  L.check('E5e : plus aucune rubrique véhicule dans le parcours professionnel',
    !/id="pro-acc-vehicules"/.test(sourceActuelle)
    && !/id="pro-nb-vehicules"/.test(sourceActuelle)
    && !/function proRendreVehicules/.test(sourceActuelle)
    && /var PRO_RUBRIQUES = \['besoin', 'lieu', 'periode', 'mission'\]/.test(sourceActuelle));

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
    // Visuel éditorial demandé pour la section « Nos services ».
    'assets/helixcar-services-mercedes.webp',
    'creer-compte-convoyeur.html',
    // Le réglage sans lequel la fonction vidéo répondrait 401 à toute
    // candidature. Versionné exprès, plutôt que coché à la main.
    'supabase/config.toml',
    // Outillage des tests : dépendance Playwright et verrou de version.
    'package.json',
    'package-lock.json',
    // Le lanceur de tests et la campagne d'intégration continue.
    '.github/workflows/tests.yml',
    // Recette : désactive les déploiements Vercel de cette seule branche.
    'vercel.json',
    // node_modules et sorties locales, désormais ignorés par git.
    '.gitignore',
    // Le dossier de recette et de mise en production.
    'RECETTE-LOT.md',
    // Celui de la stabilisation qui a suivi la PR nº 2.
    'RECETTE-STABILISATION-POST-PR2.md',
    // Celui du chantier qui a suivi la PR nº 3.
    'RECETTE-POST-PR3.md',
    // Lot Q01 : la page publique du devis suit le contrat versionné de
    // la fonction serveur (version obsolète, paiement en attente).
    'devis.html',
    // Identité officielle : la fiche imprimable indique désormais la
    // même adresse de contact que la vitrine.
    'fiche-mission.html',
    // Même identité sur la lettre de voiture contractuelle.
    'lettre-voiture.html',
    // Lot Q01 : la fonction devis-secure vivait à la racine, hors de
    // l'arborescence que la CLI Supabase déploie. Elle est DÉPLACÉE
    // (git mv) vers supabase/functions/devis-secure/index.ts : l'ancien
    // chemin apparaît dans le diff comme supprimé, c'est voulu.
    'index.ts',
    // Le dossier de recette de la révision experte P0/P1.
    'RECETTE-EXPERT-P0-P1.md',
    // X01 : retrait demandé des pages de démonstration et faux contrats.
    'helixcar-cgv-client.html',
    'helixcar-contrat-convoyeur.html',
    'helixcar-emails.html',
    // V01 : mesure réelle des vidéos hors des limites d'une Edge Function.
    'services/video-validation/serveur.mjs',
    'services/video-validation/valider.mjs',
    'services/video-validation/README.md',
    // Adaptateur Vercel du validateur vidéo, isolé de la vitrine.
    'api/video-validation.mjs',
  ];
  // supabase/templates/ — les modèles d'e-mail Supabase, versionnés
  // pour que ce qui part réellement aux clients soit relu et comparé
  // comme n'importe quel autre fichier (lots A3 et B2). Ils ne sont
  // pas déployés par une fusion : ils se recopient à la main dans
  // Supabase, comme l'indique le dossier de recette.
  const horsPerimetre = f => PERIMETRE.indexOf(f) === -1
    && !f.startsWith('migrations/') && !f.startsWith('tests/')
    && !f.startsWith('supabase/functions/') && !f.startsWith('supabase/templates/');
  L.check('E6 : périmètre de fichiers maîtrisé',
    !fichiers.some(horsPerimetre), fichiers.filter(horsPerimetre).join(', '));
  L.check('E6c : le périmètre reste une liste, pas un préfixe fourre-tout',
    PERIMETRE.every(f => f.indexOf('*') === -1) && PERIMETRE.length <= 25,
    PERIMETRE.length + ' entrées');
  // devis.html, les deux documents opérationnels et index.ts sont entrés dans le
  // périmètre (voir PERIMETRE) ; les autres pages annexes restent interdites.
  L.check('E6b : aucun fichier annexe hors périmètre (edl.html…)',
    !fichiers.some(f => ['edl.html'].indexOf(f) !== -1),
    fichiers.join(', '));
  L.check('E6d : la fonction devis-secure n\'est plus à la racine du dépôt',
    !fs.existsSync(fichier('index.ts')) && fs.existsSync(fichier('supabase/functions/devis-secure/index.ts')));
  // Ce qui est touché dans l'inscription partenaire doit se limiter aux
  // mots de passe : aucun autre comportement de cette page ne change.
  const diffConvoyeur = execSync('git diff origin/main -- creer-compte-convoyeur.html',
    { cwd: RACINE }).toString();
  const lignesDiff = signe => diffConvoyeur.split('\n')
    .filter(l => l.startsWith(signe) && !/^[+-]{3}/.test(l))
    .map(l => l.slice(1).trim())
    .filter(l => l && !l.startsWith('//'));
  const ajoutsConvoyeur = lignesDiff('+');
  // CE QUI EST RETIRÉ est jugé à part, sur une liste NOMMÉE — jamais
  // dilué dans le vocabulaire autorisé des ajouts. Le lot B1 retire
  // exactement une chose : le PATCH anonyme sur convoyeurs.auth_user_id,
  // que la RLS refusait en silence, et l'adresse d'aperçu codée en dur.
  const RETRAITS_CONVOYEUR = [
    "method: 'PATCH',", "'apikey': SUPABASE_KEY,",
    "'Authorization': 'Bearer ' + SUPABASE_KEY,", "'Content-Type': 'application/json',",
    "'Prefer': 'return=minimal'", "body: JSON.stringify({ auth_user_id: result.data.user.id })",
    "await fetch(SUPABASE_URL + '/rest/v1/convoyeurs?id=eq.' + convoyeurId, {",
    "headers: {", "}", "},", "});", "} catch (e) { console.error('Erreur liaison auth_user_id:', e); }",
    "if (result.data && result.data.user && result.data.user.id) {", "try {",
    "options: { emailRedirectTo: 'https://helixcar-i89b.vercel.app/dashboard.html' }",
    "var result = await sb.auth.signUp({", "btn.textContent = 'Création du compte…';",
    "try {"
  ];
  const retraitsInattendus = lignesDiff('-')
    .filter(l => RETRAITS_CONVOYEUR.indexOf(l) === -1);
  L.check('E6c bis : les seuls retraits de l\'inscription partenaire sont ceux du lot B1',
    retraitsInattendus.length === 0, retraitsInattendus.slice(0, 3).join(' | '));
  // RÈGLE ÉLARGIE, ET NOMMÉE (lot B1). Cette page ne devait toucher que
  // l'affichage des mots de passe. Le lot B1 en change délibérément la
  // LOGIQUE DE COMPTE : elle ne doit plus jamais créer un second mot de
  // passe pour une adresse déjà connue, et le rattachement de la fiche
  // passe par une fonction serveur au lieu d'un PATCH anonyme que la
  // RLS refusait en silence. E6d ci-dessous rend cette évolution
  // vérifiable, et interdit tout retour en arrière.
  L.check('E6c : l\'inscription partenaire ne change que le mot de passe et la logique de compte',
    ajoutsConvoyeur.every(l => /mot de passe|pw|password|mdp|oeil|Afficher|Masquer|svg|path d=|circle|aria-|minlength|autocomplete|padding-right|toggle|actif|selection|focus|libelle|bouton|input|button|display|align|justify|min-width|min-height|color|border-radius|line-height|position|background|cursor|transform|right:|top:|var |try |catch|el\.|textContent|🙈|👁|return|function|\}|\{|signIn|signUp|rpc|role|convoyeur|compte|espace|adresse|origine|helixcar|LOT|\/\/|\*|autofill|background-clip|fill-color|caret-color|transition|ms-reveal|ms-clear|Lot A01|glyphes|gestionnaires|navigateur|Edge|doublon|revelation|révélation/i.test(l)),
    ajoutsConvoyeur.filter(l => !/mot de passe|pw|password|mdp|oeil|Afficher|Masquer|svg|path d=|circle|aria-|minlength|autocomplete|padding-right|toggle|actif|selection|focus|libelle|bouton|input|button|display|align|justify|min-width|min-height|color|border-radius|line-height|position|background|cursor|transform|right:|top:|var |try |catch|el\.|textContent|🙈|👁|return|function|\}|\{|signIn|signUp|rpc|role|convoyeur|compte|espace|adresse|origine|helixcar|LOT|\/\/|\*|autofill|background-clip|fill-color|caret-color|transition|ms-reveal|ms-clear|Lot A01|glyphes|gestionnaires|navigateur|Edge|doublon|revelation|révélation/i.test(l)).slice(0, 3).join(' | '));
  // L'ÉLARGISSEMENT CI-DESSUS EST COMPENSÉ, jamais laissé à nu : ces
  // trois contrôles interdisent tout retour au comportement d'avant.
  const srcConvoyeur = fs.readFileSync(fichier('creer-compte-convoyeur.html'), 'utf8');
  L.check('E6d : la page tente d\'abord de se connecter, avant toute création',
    srcConvoyeur.indexOf('signInWithPassword') !== -1
    && srcConvoyeur.indexOf('signInWithPassword') < srcConvoyeur.indexOf('auth.signUp'));
  L.check('E6d bis : le rattachement passe par le serveur, plus par un PATCH anonyme',
    /rpc\('ajouter_role_partenaire'/.test(srcConvoyeur)
    && !/method: 'PATCH'[\s\S]{0,300}auth_user_id/.test(srcConvoyeur));
  L.check('E6d ter : et plus aucune adresse d\'aperçu n\'y est codée en dur',
    !/helixcar-i89b/.test(srcConvoyeur));

  // Le délai annoncé au client doit être le même partout.
  const fichiersDelai = ['index.html', 'dashboard.html', 'devis.html', 'helixcar-emails.html']
    .filter(f => fs.existsSync(fichier(f)))
    .map(f => fs.readFileSync(fichier(f), 'utf8'));
  L.check('E8 : plus aucun délai « sous 2 heures » annoncé',
    fichiersDelai.every(t => !/sous 2\s*h(eures)?/i.test(t)));
  L.check('E9 : le délai annoncé est bien « sous 1 heure »',
    /sous 1 heure/.test(fichiersDelai[0]));

  // RÈGLE CORRIGÉE : le libellé disait « aucun SQL exécuté », mais le
  // contrôle exigeait seulement qu'un fichier de migrations ait été
  // touché — ce qui ne prouve rien et devient faux dès qu'un lot
  // n'apporte pas de SQL. La vraie garantie est double, et elle est
  // désormais vérifiée telle quelle :
  //   * aucune migration DÉJÀ APPLIQUÉE (92 → 102) n'est modifiée ;
  //   * toute nouvelle migration est numérotée après 102.
  const migrationsTouchees = fichiers.filter(f => f.startsWith('migrations/') && /\.sql$/.test(f));
  const numero = f => parseInt((f.match(/migrations\/(\d+)_/) || [])[1] || '0', 10);
  L.check('E7 : aucune migration déjà appliquée (92 → 102) n\'est modifiée',
    migrationsTouchees.every(f => numero(f) > 102 || numero(f) < 92),
    migrationsTouchees.filter(f => numero(f) >= 92 && numero(f) <= 102).join(', '));
  L.check('E7b : toute nouvelle migration est numérotée après 102',
    migrationsTouchees.every(f => numero(f) === 0 || numero(f) > 102 || numero(f) < 92),
    migrationsTouchees.join(', '));

  // ── F. TEXTE : zéro occurrence de l'ancien message ──
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');
  L.check('F1 : zéro « demande de convoyage à tout moment » dans index.html',
    (idx.match(/demande de convoyage à tout moment/g) || []).length === 0);
  L.check('F2 : le nouveau message est bien présent',
    /effectuer une demande de service à tout moment/.test(idx));

  await browser.close();
  process.exit(L.results() > 0 ? 1 : 0);
})();
