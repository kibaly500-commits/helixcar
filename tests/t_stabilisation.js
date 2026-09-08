// ==================================================================
// STABILISATION APRÈS LA PR nº2 — les blocages constatés en production
// ==================================================================
// Chaque section reproduit d'abord un défaut RÉELLEMENT observé, puis
// vérifie qu'il ne peut plus revenir. Aucune requête ne sort : env.js
// coupe le réseau, et le formulaire est piloté dans un vrai Chromium.
const L = require('./lib.js');
const { fichier, urlFichier } = L;
const fs = require('fs');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + String(e).slice(0, 300) + ']' : '')); fail++; echecs.push(l); }
}

// Double Supabase minimal : il journalise, et ne répond jamais depuis
// le réseau. Le comportement de `rpc` et de `auth` est piloté par des
// drapeaux, pour rejouer chaque issue serveur.
function doubleSupabase() {
  return `
window.__journal = [];
window.__session = null;
window.__authMode = 'ok';        // ok | echec | existe_deja
window.__rpcMode  = 'ok';        // ok | erreur
window.emailjs = { init(){}, send(){ window.__journal.push({op:'email'}); return Promise.resolve(); },
                   sendForm(){ window.__journal.push({op:'email'}); return Promise.resolve(); } };
const U = { id: 'aaaa-1111', email: 'test-qa-claude-postpr2@example.invalid', identities: [{ id: 'i1' }] };
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange() { return { data: { subscription: { unsubscribe(){} } } }; },
    async getSession() { return { data: { session: window.__session } }; },
    async getUser() { return { data: { user: window.__session ? U : null } }; },
    async signUp(id) {
      window.__journal.push({ op: 'signUp', email: id && id.email });
      if (window.__authMode === 'echec') {
        return { data: { user: null, session: null },
                 error: { message: 'Password should be at least 6 characters' } };
      }
      if (window.__authMode === 'existe_deja') {
        return { data: { user: Object.assign({}, U, { identities: [] }), session: null }, error: null };
      }
      return { data: { user: U, session: null }, error: null };
    },
    async signInWithPassword() {
      window.__journal.push({ op: 'signIn' });
      return { data: { session: null, user: null }, error: { message: 'Email not confirmed' } };
    },
    async signOut() { window.__session = null; return {}; }
  },
  from() { return { select(){return this;}, eq(){return this;}, order(){return this;}, limit(){return this;},
                    async insert(){ return { error: null }; },
                    then(r){ return Promise.resolve({ data: [], error: null }).then(r); } }; },
  async rpc(nom, params) {
    window.__journal.push({ op: 'rpc', nom, params: JSON.parse(JSON.stringify(params || {})) });
    if (nom !== 'creer_demande_avec_vehicules') return { data: null, error: null };
    if (window.__rpcMode === 'erreur') return { data: null, error: { message: 'echec simule' } };
    return { data: { id: (params.p_demande || {}).id, numero_client: 'HC-SERVEUR-0001',
                     vehicules: 0, deja_existante: false, rattachee: false }, error: null };
  },
  storage: { from(){ return { async createSignedUrl(){ return { data: null, error: null }; } }; } }
}; } };
`;
}

async function pageClient(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const erreurs = [];
  page.on('pageerror', e => erreurs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(doubleSupabase());
  await page.goto(urlFichier('index.html'), { waitUntil: 'load' });
  await page.waitForTimeout(200);
  page.erreursJs = erreurs;
  return page;
}

// Ouvre le parcours Convoyage avec n véhicules, et rend les fiches.
async function convoyageAvecVehicules(page, n, commun) {
  await L.fillStep1(page, 'particulier');
  await L.chooseService(page, 'convoyage');
  await page.waitForTimeout(80);
  await page.evaluate((args) => {
    const el = document.getElementById('nb-vehicules');
    if (el) { el.value = String(args.n); el.dispatchEvent(new Event('change', { bubbles: true })); }
    // « Les véhicules suivent-ils la même organisation ? » — c'est ce
    // choix qui rend le trajet commun ou individuel.
    const r = document.querySelector('input[name="trajet-commun"][value="'
      + (args.commun ? 'oui' : 'non') + '"]');
    if (r) {
      r.checked = true;
      if (typeof changerTrajetCommun === 'function') changerTrajetCommun(r);
      r.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof onNbVehicules === 'function') onNbVehicules();
    if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
  }, { n, commun: !!commun });
  await page.waitForTimeout(250);
}

// Compte, pour chaque véhicule, les blocs « Mode de transport » qui se
// trouvent RÉELLEMENT dans son conteneur.
async function modesParVehicule(page, n) {
  return page.evaluate((n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const contenu = document.getElementById('veh-contenu-' + i);
      const radios = document.querySelectorAll('input[name="veh-' + i + '-mode"]');
      let dedans = 0;
      radios.forEach(r => { if (contenu && contenu.contains(r)) dedans++; });
      const titres = contenu
        ? Array.prototype.filter.call(contenu.querySelectorAll('.veh-sstitre'),
            t => /Mode de transport/.test(t.textContent || '')).length
        : 0;
      out.push({ radios: radios.length, dansLeConteneur: dedans, titres: titres });
    }
    return out;
  }, n);
}

(async () => {
  const browser = await L.lancerNavigateur();
  const idx = fs.readFileSync(fichier('index.html'), 'utf8');

  // ══ A. LE CONTRÔLE GLOBAL « STANDARD / SUR PLATEAU » N'EXISTE PLUS ══
  check('A1 : le select global « Standard / Sur plateau » a disparu du HTML',
    !/id="client-mode"/.test(idx), 'select client-mode encore présent');
  check('A2 : la case masquée « Transport sur plateau » a disparu',
    !/id="client-plateau"/.test(idx), 'client-plateau encore présent');
  check('A3 : le groupe de boutons radio global a disparu',
    !/id="mode-transport-group"/.test(idx) && !/name="mode-transport"/.test(idx));
  check('A4 : plus aucun état ne l\'alimente',
    !/function onModeTransport\s*\(/.test(idx));
  check('A5 : le payload du DOSSIER ne porte plus mode_transport ni plateau',
    !/^\s*mode_transport:\s*mode_val/m.test(idx) && !/plateau:\s*plateau_val/.test(idx));
  check('A6 : le devis lit le mode sur les VÉHICULES',
    /function _hcPlateauDemande\s*\(/.test(idx) && /const plateau = _hcPlateauDemande\(\)/.test(idx));
  // Le délai souhaité, lui, reste — ce n'est pas le mode de transport.
  check('A7 : le « Délai souhaité » Standard / Prioritaire est CONSERVÉ',
    /id="delai-group"/.test(idx) && /name="delai" value="urgent"/.test(idx)
    && /id="client-urgence"/.test(idx));

  // ══ B. EXACTEMENT UN BLOC PAR VÉHICULE, TOUJOURS DANS SA FICHE ══
  for (const n of [1, 2, 3, 5]) {
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, n, false);
    const modes = await modesParVehicule(page, n);
    check('B' + n + ' : ' + n + ' véhicule(s) — chacun a UN bloc Mode de transport',
      modes.length === n && modes.every(m => m.titres === 1 && m.radios === 2),
      JSON.stringify(modes));
    check('B' + n + 'b : ... et il est bien DANS le conteneur du véhicule',
      modes.every(m => m.dansLeConteneur === 2), JSON.stringify(modes));
    check('B' + n + 'c : aucune erreur JavaScript', page.erreursJs.length === 0,
      page.erreursJs.slice(0, 2).join(' | '));
    await page.close();
  }

  // ══ C. L'ORDRE DES QUATRE RUBRIQUES ══
  {
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, 3, false);
    const ordres = await page.evaluate(() => {
      const out = [];
      for (let i = 0; i < 3; i++) {
        const c = document.getElementById('veh-contenu-' + i);
        out.push(c ? Array.prototype.map.call(c.querySelectorAll(':scope > .veh-sous-accordeon'),
          b => (b.id || '').replace('veh-' + i + '-sous-', '')) : []);
      }
      return out;
    });
    check('C1 : chaque véhicule porte les quatre rubriques, dans l\'ordre',
      ordres.every(o => o.join(',') === 'identite,pc,livraison,mode'),
      JSON.stringify(ordres));
    check('C2 : « Mode de transport » est toujours la DERNIÈRE',
      ordres.every(o => o[o.length - 1] === 'mode'), JSON.stringify(ordres));
    await page.close();
  }

  // ══ D. LA SÉQUENCE QUI FAISAIT DISPARAÎTRE LE BLOC ══
  // Convoyage → Stockage → Livraison après stockage → retour Convoyage.
  {
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, 3, false);
    const avant = await modesParVehicule(page, 3);
    check('D1 : au départ, les 3 véhicules ont leur bloc',
      avant.every(m => m.titres === 1), JSON.stringify(avant));

    await L.chooseService(page, 'stockage');
    await page.waitForTimeout(200);
    await L.chooseService(page, 'convoyage');
    await page.waitForTimeout(200);
    await page.evaluate(() => { if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules(); });
    await page.waitForTimeout(200);
    const apres = await modesParVehicule(page, 3);
    check('D2 : après Convoyage → Stockage → Convoyage, les 3 l\'ont toujours',
      apres.length === 3 && apres.every(m => m.titres === 1 && m.dansLeConteneur === 2),
      JSON.stringify(apres));

    // Répétition : l'anomalie était intermittente.
    for (let k = 0; k < 3; k++) {
      await L.chooseService(page, 'stockage');
      await page.waitForTimeout(120);
      await L.chooseService(page, 'convoyage');
      await page.waitForTimeout(120);
    }
    await page.evaluate(() => { if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules(); });
    await page.waitForTimeout(200);
    const boucle = await modesParVehicule(page, 3);
    check('D3 : et après trois allers-retours de plus, toujours un seul bloc chacun',
      boucle.every(m => m.titres === 1 && m.dansLeConteneur === 2), JSON.stringify(boucle));
    check('D4 : aucun bloc Mode de transport HORS d\'une fiche véhicule',
      await page.evaluate(() => {
        const tous = document.querySelectorAll('#modal-client .veh-sstitre');
        let dehors = 0;
        Array.prototype.forEach.call(tous, t => {
          if (!/Mode de transport/.test(t.textContent || '')) return;
          if (!t.closest('.veh-contenu')) dehors++;
        });
        return dehors === 0;
      }));
    await page.close();
  }

  // ══ D bis. LA VRAIE REPRODUCTION : LE STOCKAGE LAISSE UN « NI OUI NI NON » ══
  //
  // Le bloc n'était généré que si la LIVRAISON APRÈS STOCKAGE de ce
  // véhicule valait exactement true. Or, tant que le client n'a pas
  // répondu, elle vaut null — et cette valeur reste dans la fiche
  // mémorisée quand on revient au Convoyage. C'est le cas du véhicule
  // « 3 sur 3 » jamais ouvert, dont le Dashboard n'affichait aucun mode
  // de transport alors que V1 et V2 en avaient un.
  {
    const page = await pageClient(browser);
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'stockage');
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const el = document.getElementById('nb-vehicules');
      if (el) { el.value = '3'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      const a = document.querySelector('input[name="stock-acheminement"][value="helixcar"]');
      if (a) { a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); }
      const so = document.querySelector('input[name="stock-sortie"][value="helixcar"]');
      if (so) { so.checked = true; so.dispatchEvent(new Event('change', { bubbles: true })); }
      const t = document.querySelector('input[name="trajet-commun"][value="non"]');
      if (t) {
        t.checked = true;
        if (typeof changerTrajetCommun === 'function') changerTrajetCommun(t);
        t.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof onAcheminementStockage === 'function') onAcheminementStockage();
      if (typeof onSortieStockage === 'function') onSortieStockage();
      if (typeof onNbVehicules === 'function') onNbVehicules();
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    });
    await page.waitForTimeout(250);

    // Le client ne répond que pour le PREMIER véhicule.
    await page.evaluate(() => {
      const r = document.querySelector('input[name="veh-0-liv-active"][value="oui"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof basculerLivraisonVehicule === 'function') basculerLivraisonVehicule(0);
    });
    await page.waitForTimeout(200);

    const etatStockage = await page.evaluate(() =>
      _lireFichesVehicules().map(v => v && v.livraison_apres_stockage));
    check('Dbis1 : seuls les véhicules 2 et 3 restent « ni oui ni non »',
      etatStockage.length === 3 && etatStockage[0] === true
        && etatStockage[1] === null && etatStockage[2] === null,
      JSON.stringify(etatStockage));

    // C'EST ICI QUE LE BLOC DISPARAISSAIT. Il n'était produit que si la
    // livraison après stockage de CE véhicule valait exactement true.
    // Les véhicules 2 et 3, dont le client n'a encore rien dit, se
    // retrouvaient donc sans aucun mode de transport — et repartaient
    // en base avec un mode vide, que le Dashboard n'affichait pas.
    const pendantStockage = await modesParVehicule(page, 3);
    check('Dbis1 bis : REPRODUCTION — les trois véhicules ont leur bloc, même sans réponse',
      pendantStockage.length === 3 && pendantStockage.every(m => m.titres === 1 && m.radios === 2),
      JSON.stringify(pendantStockage));
    check('Dbis1 ter : REPRODUCTION — y compris le troisième, jamais ouvert',
      pendantStockage[2] && pendantStockage[2].titres === 1
        && pendantStockage[2].dansLeConteneur === 2,
      JSON.stringify(pendantStockage[2]));
    const modesStockage = await page.evaluate(() =>
      _lireFichesVehicules().map(v => v && v.mode_transport));
    check('Dbis1 quater : REPRODUCTION — et aucun ne part en base avec un mode vide',
      modesStockage.length === 3 && modesStockage.every(m => m === 'standard' || m === 'plateau'),
      JSON.stringify(modesStockage));

    // Retour au Convoyage : c'est là que le bloc manquait.
    await L.chooseService(page, 'convoyage');
    await page.waitForTimeout(200);
    await page.evaluate(() => { if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules(); });
    await page.waitForTimeout(250);
    const apresRetour = await modesParVehicule(page, 3);
    check('Dbis2 : les TROIS véhicules ont leur Mode de transport',
      apresRetour.length === 3 && apresRetour.every(m => m.titres === 1 && m.radios === 2),
      JSON.stringify(apresRetour));
    check('Dbis3 : et le troisième aussi, celui qui n\'a jamais été ouvert',
      apresRetour[2] && apresRetour[2].titres === 1 && apresRetour[2].dansLeConteneur === 2,
      JSON.stringify(apresRetour[2]));
    const modesLus = await page.evaluate(() =>
      _lireFichesVehicules().map(v => v && v.mode_transport));
    check('Dbis4 : le mode part au serveur pour les trois, jamais vide',
      modesLus.length === 3 && modesLus.every(m => m === 'standard' || m === 'plateau'),
      JSON.stringify(modesLus));
    await page.close();
  }

  // ══ D ter. TRAJET COMMUN : LE BLOC ÉTAIT GLOBAL, IL EST MAINTENANT PAR VÉHICULE ══
  //
  // Le bloc du véhicule n'était produit que si le trajet était
  // INDIVIDUEL — (pcIndiv || livIndiv). Avec un trajet commun, aucun
  // véhicule n'avait de mode de transport : un unique contrôle global
  // s'affichait sous les fiches, et c'est lui qui partait en base pour
  // tout le dossier. Deux véhicules ne pouvaient pas avoir des modes
  // différents, et le Dashboard n'en montrait qu'un.
  {
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, 3, true);
    // Depuis l'unification des fiches, _trajetCommun() rend toujours
    // false : chaque véhicule porte ses propres informations, même
    // quand le client répond « oui, mêmes adresses ». Ce contrôle fige
    // cette architecture — si elle changeait, le reste de la section
    // devrait être relu.
    check('Dter0 : les informations restent portées par chaque véhicule',
      await page.evaluate(() => _trajetCommun() === false));
    const communModes = await modesParVehicule(page, 3);
    check('Dter1 : trajet COMMUN — chaque véhicule garde SON mode de transport',
      communModes.length === 3 && communModes.every(m => m.titres === 1 && m.radios === 2),
      JSON.stringify(communModes));
    check('Dter2 : et il est dans sa fiche, pas sous les fiches',
      communModes.every(m => m.dansLeConteneur === 2), JSON.stringify(communModes));
    const distincts = await page.evaluate(() => {
      const r = document.querySelector('input[name="veh-2-mode"][value="plateau"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      return _lireFichesVehicules().map(v => v && v.mode_transport);
    });
    check('Dter3 : deux véhicules du même trajet peuvent avoir des modes différents',
      distincts.length === 3 && distincts[0] === 'standard' && distincts[2] === 'plateau',
      JSON.stringify(distincts));
    await page.close();
  }

  // ══ E. LE MODE CHOISI SURVIT ET PART AU SERVEUR, PAR VÉHICULE ══
  {
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, 3, false);
    await page.evaluate(() => {
      // Véhicule 1 sur plateau, les deux autres par la route.
      const r = document.querySelector('input[name="veh-1-mode"][value="plateau"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(120);
    const lues = await page.evaluate(() =>
      _lireFichesVehicules().map(v => v && v.mode_transport));
    check('E1 : chaque véhicule porte SON mode, indépendamment des autres',
      lues.length === 3 && lues[0] === 'standard' && lues[1] === 'plateau' && lues[2] === 'standard',
      JSON.stringify(lues));
    check('E2 : le devis voit qu\'un plateau est demandé',
      await page.evaluate(() => typeof _hcPlateauDemande === 'function' && _hcPlateauDemande() === true));
    await page.evaluate(() => {
      const r = document.querySelector('input[name="veh-1-mode"][value="standard"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    check('E3 : et qu\'aucun ne l\'est plus quand on revient à la route',
      await page.evaluate(() => typeof _hcPlateauDemande === 'function' && _hcPlateauDemande() === false));
    await page.close();
  }

  // ══ F. AUCUN DÉTAIL SQL N'ATTEINT L'UTILISATEUR ══
  check('F1 : supabaseInsert n\'écrit plus la réponse brute à l\'écran',
    !/dbg\.innerHTML\s*=\s*'<b>Erreur/.test(idx));
  check('F2 : l\'échec de candidature n\'affiche plus JSON.stringify(error)',
    !/alert\('Erreur lors de envoi\.'/.test(idx)
    && !/JSON\.stringify\(rInsert\.error\)/.test(idx));
  check('F3 : la fenêtre partenaire a sa PROPRE zone d\'erreur',
    /id="conv-erreur-envoi"/.test(idx) && /_convAfficherEchecCandidature/.test(idx));
  check('F4 : le bandeau client est effacé à chaque ouverture de fenêtre',
    /function _hcEffacerBandeauErreur/.test(idx)
    && /_hcEffacerBandeauErreur\(\);\s*\n\s*document\.getElementById\('modal-' \+ type\)\.classList\.add\('open'\)/.test(idx));
  check('F5 : un échec de candidature retire les documents devenus orphelins',
    /_supprimerFichierTeleverse/.test(idx)
    && /\[id_url, permis_url, rc_pro_url\]\.map\(_supprimerFichierTeleverse\)/.test(idx));

  // Une erreur laissée par la candidature ne doit plus accueillir le
  // client dans SA fenêtre.
  {
    const page = await pageClient(browser);
    const fuite = await page.evaluate(() => {
      const dbg = document.getElementById('supabase-debug');
      // On simule ce que faisait l'ancienne version.
      dbg.style.display = 'block';
      dbg.textContent = 'Erreur 400 [convoyeurs]: 23514';
      openModal('client');
      return { affiche: dbg.style.display, texte: dbg.textContent };
    });
    check('F6 : ouvrir « Devenir client » efface toute erreur précédente',
      fuite.affiche === 'none' && fuite.texte === '', JSON.stringify(fuite));
    await page.close();
  }

  // ══ G. LE FAUX SUCCÈS DE CRÉATION DE COMPTE ══
  check('G1 : la phrase « compte créé » dépend de l\'issue réelle du signUp',
    /_compteEtat === 'cree' \|\| _compteEtat === 'existe_deja' \|\| _compteEtat === 'non_demande'/.test(idx));
  check('G2 : un refus du serveur est dit tel quel',
    /_compteEtat === 'echec'/.test(idx) && /Votre compte n\\'a pas pu être créé/.test(idx));
  check('G3 : une adresse déjà inscrite n\'est pas un échec',
    /_compteEtat = 'existe_deja'/.test(idx) && /rien n\\'a été créé en double/.test(idx));
  check('G4 : le numéro affiché est celui que le SERVEUR a renvoyé',
    /_retourSrv\.numero_client \|\| clientNum/.test(idx));
  check('G5 : le succès n\'est plus déduit d\'un bloc finally',
    !/finally\s*\{[^}]*succes/i.test(idx));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
