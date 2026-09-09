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
// Registre des comptes REELLEMENT crees cote serveur. C'est lui qui
// fait foi : l'ecran ne doit jamais annoncer un compte qui n'y est pas.
window.__comptes = [];
window.__demandesEcrites = [];
window.emailjs = { init(){}, send(){ window.__journal.push({op:'email'}); return Promise.resolve(); },
                   sendForm(){ window.__journal.push({op:'email'}); return Promise.resolve(); } };
const U = { id: 'aaaa-1111', email: 'test-qa-claude-postpr2@example.invalid', identities: [{ id: 'i1' }] };
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange() { return { data: { subscription: { unsubscribe(){} } } }; },
    async getSession() { return { data: { session: window.__session } }; },
    async getUser() { return { data: { user: window.__session ? U : null } }; },
    async signUp(id) {
      const adresse = (id && id.email) || '';
      window.__journal.push({ op: 'signUp', email: adresse });
      if (window.__authMode === 'echec') {
        return { data: { user: null, session: null },
                 error: { message: 'Password should be at least 6 characters' } };
      }
      // Une adresse deja inscrite : le serveur ne cree RIEN de plus.
      const deja = window.__comptes.filter(c => c.email === adresse)[0];
      if (window.__authMode === 'existe_deja' || deja) {
        return { data: { user: Object.assign({}, U, { email: adresse, identities: [] }), session: null },
                 error: null };
      }
      window.__comptes.push({ id: 'u-' + (window.__comptes.length + 1), email: adresse });
      return { data: { user: Object.assign({}, U, { email: adresse }), session: null }, error: null };
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
    window.__demandesEcrites.push({ id: (params.p_demande || {}).id,
                                    email: (params.p_demande || {}).email });
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

  // ══ D quater. ET QUAND HELIXCAR NE TRANSPORTE PAS, ON NE DEMANDE RIEN ══
  //
  // Revue critique de la PR nº 3. Rendre le bloc SANS AUCUNE condition
  // était une sur-correction : dans un stockage où le client dépose ET
  // vient rechercher son véhicule lui-même, HelixCar ne le transporte
  // jamais. La question n'a pas d'objet — et son résultat partait
  // pourtant en base, alors que le récapitulatif, lui, ne l'affichait
  // pas (il testait une autre condition). Le client répondait donc à
  // une question invisible dans son propre récapitulatif.
  //
  // La bonne règle n'est ni « toujours », ni « seulement si une autre
  // réponse a été donnée » : c'est « seulement si HelixCar transporte
  // réellement ce véhicule ».
  {
    const page = await pageClient(browser);
    await L.fillStep1(page, 'particulier');
    await L.chooseService(page, 'stockage');
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      const el = document.getElementById('nb-vehicules');
      if (el) { el.value = '2'; el.dispatchEvent(new Event('change', { bubbles: true })); }
      const a = document.querySelector('input[name="stock-acheminement"][value="client"]');
      if (a) { a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); }
      const so = document.querySelector('input[name="stock-sortie"][value="client"]');
      if (so) { so.checked = true; so.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof onAcheminementStockage === 'function') onAcheminementStockage();
      if (typeof onSortieStockage === 'function') onSortieStockage();
      if (typeof onNbVehicules === 'function') onNbVehicules();
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    });
    await page.waitForTimeout(250);
    const sansTransport = await page.evaluate(() => {
      const sc = _scenarioTrajet();
      return {
        scenario: { pc: sc.pc, liv: sc.liv },
        modes: [0, 1].map(i => document.querySelectorAll('input[name="veh-' + i + '-mode"]').length),
        modesLus: _lireFichesVehicules().map(v => v && v.mode_transport)
      };
    });
    check('Dquater1 : le scénario est bien « le client dépose et récupère »',
      sansTransport.scenario.pc === false && sansTransport.scenario.liv === false,
      JSON.stringify(sansTransport.scenario));
    check('Dquater2 : aucun mode de transport n\'est demandé — HelixCar ne transporte pas',
      sansTransport.modes.every(n => n === 0), JSON.stringify(sansTransport.modes));
    check('Dquater3 : et rien de tel ne part en base',
      sansTransport.modesLus.every(m => !m), JSON.stringify(sansTransport.modesLus));

    // Dès que HelixCar reprend le véhicule en charge, la question revient.
    await page.evaluate(() => {
      const a = document.querySelector('input[name="stock-acheminement"][value="helixcar"]');
      if (a) { a.checked = true; a.dispatchEvent(new Event('change', { bubbles: true })); }
      if (typeof onAcheminementStockage === 'function') onAcheminementStockage();
      if (typeof rendreFichesVehicules === 'function') rendreFichesVehicules();
    });
    await page.waitForTimeout(250);
    const avecTransport = await page.evaluate(() =>
      [0, 1].map(i => document.querySelectorAll('input[name="veh-' + i + '-mode"]').length));
    check('Dquater4 : dès que HelixCar vient chercher le véhicule, la question revient',
      avecTransport.every(n => n === 2), JSON.stringify(avecTransport));

    // Le formulaire et le récapitulatif doivent poser la MÊME condition.
    check('Dquater5 : le récapitulatif applique la même règle que le formulaire',
      /if \(\(sc\.pc \|\| sc\.liv\) && v\.mode_transport\)/.test(idx),
      'le récapitulatif teste encore une autre condition');
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

  // ══ K. LE MODE DE TRANSPORT DE BOUT EN BOUT ══
  //
  // Duplication, brouillon, actualisation, reprise, envoi au serveur,
  // devis. Le mode doit rester attaché à SON véhicule à chacune de ces
  // étapes — jamais partagé, jamais perdu.
  {
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, 3, false);

    // Chaque véhicule reçoit son propre mode, dès l'ouverture.
    await page.evaluate(() => {
      const poser = (i, v) => {
        const r = document.querySelector('input[name="veh-' + i + '-mode"][value="' + v + '"]');
        if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      poser(0, 'plateau'); poser(1, 'standard'); poser(2, 'plateau');
    });
    await page.waitForTimeout(120);
    check('K1 : trois véhicules, trois modes indépendants',
      JSON.stringify(await page.evaluate(() =>
        _lireFichesVehicules().map(v => v && v.mode_transport)))
        === JSON.stringify(['plateau', 'standard', 'plateau']),
      JSON.stringify(await page.evaluate(() => _lireFichesVehicules().map(v => v && v.mode_transport))));

    // Modifier l'un ne touche pas les autres.
    await page.evaluate(() => {
      const r = document.querySelector('input[name="veh-0-mode"][value="standard"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(80);
    check('K2 : en modifier un ne touche aucun autre',
      JSON.stringify(await page.evaluate(() =>
        _lireFichesVehicules().map(v => v && v.mode_transport)))
        === JSON.stringify(['standard', 'standard', 'plateau']));

    // DUPLICATION : la copie garde son propre mode, et reste indépendante.
    const dup = await page.evaluate(() => {
      // Le véhicule 1 est complet et sur plateau ; on le copie vers le 2.
      const poser = (i, v) => {
        const r = document.querySelector('input[name="veh-' + i + '-mode"][value="' + v + '"]');
        if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      poser(0, 'plateau');
      if (typeof _hcCopierVehiculeVers === 'function') _hcCopierVehiculeVers(0, 1);
      const apresCopie = _lireFichesVehicules().map(v => v && v.mode_transport);
      // On change la copie : l'original ne doit pas bouger.
      poser(1, 'standard');
      return { apresCopie, apresChangement: _lireFichesVehicules().map(v => v && v.mode_transport) };
    });
    check('K3 : la duplication copie bien le mode du véhicule source',
      dup.apresCopie[1] === 'plateau', JSON.stringify(dup.apresCopie));
    check('K4 : et la copie reste INDÉPENDANTE de son original',
      dup.apresChangement[0] === 'plateau' && dup.apresChangement[1] === 'standard',
      JSON.stringify(dup.apresChangement));

    // BROUILLON puis ACTUALISATION : chaque mode revient sur son véhicule.
    await page.evaluate(() => {
      const poser = (i, v) => {
        const r = document.querySelector('input[name="veh-' + i + '-mode"][value="' + v + '"]');
        if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      poser(0, 'plateau'); poser(1, 'standard'); poser(2, 'plateau');
      if (typeof _sauvegarderBrouillonClient === 'function') _sauvegarderBrouillonClient();
    });
    await page.waitForTimeout(150);
    const brouillon = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('helixcar_brouillon_client_v1') || 'null'); }
      catch (e) { return null; }
    });
    // Le brouillon mémorise les boutons radio par NOM de groupe : le mode
    // de chaque véhicule y a donc sa propre entrée, jamais une entrée
    // partagée. C'est ce qui permet à la reprise de rendre à chacun le
    // sien (contrôle K6).
    const radios = (brouillon && brouillon.radios) || {};
    check('K5 : le brouillon garde une entrée DISTINCTE par véhicule',
      radios['veh-0-mode'] === 'plateau'
      && radios['veh-1-mode'] === 'standard'
      && radios['veh-2-mode'] === 'plateau',
      JSON.stringify({ v0: radios['veh-0-mode'], v1: radios['veh-1-mode'], v2: radios['veh-2-mode'] }));
    check('K5 bis : et aucune entrée de mode GLOBAL n\'y subsiste',
      !Object.keys(radios).some(k => k === 'mode-transport'),
      JSON.stringify(Object.keys(radios).filter(k => /mode/.test(k))));

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => { try { openModal('client'); } catch (e) {} });
    await page.waitForTimeout(600);
    const repris = await page.evaluate(() => ({
      modes: _lireFichesVehicules().map(v => v && v.mode_transport),
      blocs: [0, 1, 2].map(i => {
        const c = document.getElementById('veh-contenu-' + i);
        return c ? Array.prototype.filter.call(c.querySelectorAll('.veh-sstitre'),
          t => /Mode de transport/.test(t.textContent || '')).length : -1;
      })
    }));
    check('K6 : après actualisation et reprise, chaque véhicule retrouve SON mode',
      JSON.stringify(repris.modes) === JSON.stringify(['plateau', 'standard', 'plateau']),
      JSON.stringify(repris));
    check('K7 : et toujours un seul bloc Mode de transport par véhicule',
      JSON.stringify(repris.blocs) === JSON.stringify([1, 1, 1]), JSON.stringify(repris.blocs));

    // ENVOI AU SERVEUR : un mode par véhicule dans le payload.
    const envoi = await page.evaluate(() =>
      _lireFichesVehicules().filter(Boolean).map(_normaliserVehiculePourEnvoi)
        .map(v => ({ position: v.position, mode: v.mode_transport })));
    check('K8 : le payload porte un mode par véhicule, jamais un mode global',
      envoi.length === 3 && envoi.every(v => v.mode === 'plateau' || v.mode === 'standard')
      && envoi[0].mode === 'plateau' && envoi[1].mode === 'standard',
      JSON.stringify(envoi));
    check('K9 : le devis suit les véhicules, pas un réglage de dossier',
      await page.evaluate(() => _hcPlateauDemande() === true));
    await page.close();
  }

  // ══ K bis. LE DASHBOARD MONTRE LE MODE DE CHAQUE VÉHICULE ══
  {
    const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
    check('Kbis1 : le Dashboard lit mode_transport SUR LE VÉHICULE',
      /_libelleModeTransport|mt === 'plateau'/.test(dash));
    const pageD = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errsD = [];
    pageD.on('pageerror', e => errsD.push(e.message));
    await pageD.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
    const rendu = await pageD.evaluate(() => {
      const f = Object.keys(window).filter(k => /^_libelleMode|^_modeTransport/.test(k));
      const lu = [];
      [['standard', 'route'], ['plateau', 'plateau']].forEach(([v, attendu]) => {
        let texte = '';
        try {
          for (const nom of f) { if (typeof window[nom] === 'function') texte += ' ' + window[nom](v); }
        } catch (e) { texte = 'ERREUR ' + e.message; }
        lu.push({ valeur: v, texte: texte.trim(), attendu });
      });
      return lu;
    });
    check('Kbis2 : chaque valeur a un libellé lisible côté Dashboard',
      rendu.every(r => r.texte && new RegExp(r.attendu, 'i').test(r.texte)),
      JSON.stringify(rendu));
    check('Kbis3 : aucune erreur JavaScript', errsD.length === 0, errsD.slice(0, 2).join(' | '));
    await pageD.close();
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

  // ══ G bis. LE COMPTE EXISTE-T-IL VRAIMENT, CÔTÉ SERVEUR ? ══
  //
  // Les contrôles G1 à G5 lisent le code. Ceux-ci vont plus loin : ils
  // déroulent le parcours réel, puis interrogent le REGISTRE SERVEUR.
  // L'écran ne doit jamais annoncer un compte que le serveur n'a pas.
  async function parcoursCompteSeul(page, opts) {
    opts = opts || {};
    await page.evaluate((o) => {
      window.__authMode = o.authMode || 'ok';
      window.__rpcMode = o.rpcMode || 'ok';
    }, opts);
    await L.fillStep1(page, 'particulier');
    await page.evaluate((adresse) => {
      const e = document.getElementById('client-email');
      if (e && adresse) { e.value = adresse; e.dispatchEvent(new Event('input', { bubbles: true })); }
    }, opts.email || 'test-qa-claude-postpr2@example.invalid');
    await L.chooseService(page, 'compte');
    await page.waitForTimeout(80);
    for (let i = 0; i < 10; i++) {
      const fini = await page.evaluate(() =>
        !!document.querySelector('#client-success-msg') &&
        (document.getElementById('client-success-msg').textContent || '').trim().length > 0);
      if (fini) break;
      await page.evaluate(() => {
        const mdp = document.getElementById('client-password');
        if (mdp && !mdp.value) {
          mdp.value = 'MotDePasseQA2026';
          mdp.dispatchEvent(new Event('input', { bubbles: true }));
          mdp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const envoi = document.getElementById('client-submit-btn');
        if (envoi && envoi.offsetParent !== null && !envoi.disabled) { envoi.click(); return; }
        const b = document.getElementById('client-step-next-btn');
        if (b && !b.disabled) b.click();
      });
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(600);
    return page.evaluate(() => ({
      ecran: (document.getElementById('client-success-msg') || {}).textContent || '',
      comptes: window.__comptes.slice(),
      demandes: window.__demandesEcrites.slice()
    }));
  }

  // ── Le cas nominal : le compte est créé, et il est bien là. ──
  {
    const page = await pageClient(browser);
    const r = await parcoursCompteSeul(page, { email: 'nominal@example.invalid' });
    check('Gbis1 : le compte est RÉELLEMENT présent côté serveur',
      r.comptes.some(c => c.email === 'nominal@example.invalid'), JSON.stringify(r.comptes));
    check('Gbis2 : et l\'écran l\'annonce alors, à juste titre',
      /compte HelixCar est maintenant créé/i.test(r.ecran), r.ecran.slice(0, 200));
    check('Gbis3 : un seul compte, jamais deux', r.comptes.length === 1, JSON.stringify(r.comptes));
    await page.close();
  }

  // ── Le serveur refuse : aucun écran de succès ne doit mentir. ──
  {
    const page = await pageClient(browser);
    const r = await parcoursCompteSeul(page, { authMode: 'echec', email: 'refuse@example.invalid' });
    check('Gbis4 : le serveur a refusé — AUCUN compte n\'existe',
      r.comptes.length === 0, JSON.stringify(r.comptes));
    check('Gbis5 : et l\'écran n\'annonce PAS un compte créé',
      !/compte HelixCar est maintenant créé/i.test(r.ecran), r.ecran.slice(0, 300));
    check('Gbis6 : il dit au contraire que le compte n\'a pas pu être créé',
      /compte n'a pas pu être créé/i.test(r.ecran), r.ecran.slice(0, 300));
    await page.close();
  }

  // ── Nouvelle tentative avec la MÊME adresse : rien en double. ──
  {
    const page = await pageClient(browser);
    await parcoursCompteSeul(page, { email: 'rejeu@example.invalid' });
    // Le client recommence : nouvelle page, même registre serveur.
    const page2 = await pageClient(browser);
    await page2.evaluate((comptes) => { window.__comptes = comptes; }, [{ id: 'u-1', email: 'rejeu@example.invalid' }]);
    const r2 = await parcoursCompteSeul(page2, { email: 'rejeu@example.invalid' });
    check('Gbis7 : une adresse déjà inscrite ne crée AUCUN second compte',
      r2.comptes.length === 1, JSON.stringify(r2.comptes));
    check('Gbis8 : et l\'écran le dit, sans prétendre avoir créé quoi que ce soit',
      /existait déjà avec cette adresse/i.test(r2.ecran), r2.ecran.slice(0, 300));
    await page.close(); await page2.close();
  }

  // ── Professionnel puis particulier : aucune contamination. ──
  {
    const page = await pageClient(browser);
    // On ouvre d'abord la candidature partenaire, et on la fait échouer.
    await page.evaluate(() => {
      openModal('convoyeur');
      const dbg = document.getElementById('supabase-debug');
      if (dbg) { dbg.style.display = 'block'; dbg.textContent = 'Erreur 400 [convoyeurs]: 23514'; }
      closeModal('convoyeur');
    });
    await page.waitForTimeout(150);
    const r = await parcoursCompteSeul(page, { email: 'bascule@example.invalid' });
    check('Gbis9 : professionnel → particulier — le compte est bien créé',
      r.comptes.some(c => c.email === 'bascule@example.invalid'), JSON.stringify(r.comptes));
    check('Gbis10 : et aucune erreur [convoyeurs] ne suit l\'utilisateur',
      !/convoyeurs/i.test(r.ecran)
      && await page.evaluate(() => {
           const d = document.getElementById('supabase-debug');
           return !d || d.style.display === 'none' || !(d.textContent || '').trim();
         }),
      r.ecran.slice(0, 200));
    await page.close();
  }

  // ── L'écriture de la demande échoue : rien n'est annoncé. ──
  {
    const page = await pageClient(browser);
    const r = await parcoursCompteSeul(page, { rpcMode: 'erreur', email: 'demandeko@example.invalid' });
    check('Gbis11 : la demande n\'a pas été écrite',
      r.demandes.length === 0, JSON.stringify(r.demandes));
    check('Gbis12 : et aucun écran de succès n\'apparaît',
      !/compte HelixCar est maintenant créé/i.test(r.ecran)
      && !/numéro client/i.test(r.ecran), r.ecran.slice(0, 300));
    check('Gbis13 : un message compréhensible est affiché à la place',
      await page.evaluate(() => {
        const d = document.getElementById('supabase-debug');
        return !!d && d.style.display !== 'none'
          && /n'a pas pu être enregistrée/i.test(d.textContent || '')
          && !/\bcode\b|23514|violates|relation/i.test(d.textContent || '');
      }));
    await page.close();
  }

  // ══ I. LE COMPTEUR « DEMANDES DE DEVIS » ══
  //
  // Il ne s'actualisait plus. Deux causes, toutes deux dans le code :
  // le comptage partait avec la CLÉ ANONYME — or la RLS est active sur
  // clients depuis les migrations 90 et 91, donc le serveur répond 200
  // avec un total de zéro, sans la moindre erreur — et un délai
  // d'anti-rafale de cinq minutes gelait le badge, y compris au retour
  // sur l'onglet.
  {
    const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
    check('I1 : le comptage part avec le JETON DE SESSION, pas la clé anonyme',
      /_jetonSessionSupabase\(\)\.then\(function \(jetonSession\) \{[\s\S]{0,400}?'Authorization': 'Bearer ' \+ \(jetonSession \|\| SUPABASE_KEY\)/.test(dash));
    check('I2 : le délai d\'anti-rafale n\'est plus de cinq minutes',
      /var DELAI_MIN_RECOMPTAGE_MS = 30000;/.test(dash)
      && !/DELAI_MIN_RECOMPTAGE_MS = 300000/.test(dash));
    check('I3 : le retour sur l\'onglet FORCE un comptage',
      /if \(!document\.hidden\) \{\s*\n\s*majBadgeDemandes\(true\);/.test(dash));

    // Comportement réel : le badge suit les données chargées.
    const pageC = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errsC = [];
    pageC.on('pageerror', e => errsC.push(e.message));
    await pageC.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });
    // Le badge vit dans la navigation, qui n'existe qu'une fois connecté.
    await pageC.evaluate(() => {
      currentRole = 'admin';
      var l = document.getElementById('login-screen'); if (l) l.style.display = 'none';
      var a = document.getElementById('app'); if (a) a.style.display = 'flex';
      if (typeof buildNav === 'function') buildNav('admin');
    });
    await pageC.waitForTimeout(150);
    const compteur = await pageC.evaluate(() => {
      const lu = { id: 'c1', type_service: 'convoyage', statut: 'nouveau', vue_admin_at: '2026-01-01' };
      const neuve1 = { id: 'c2', type_service: 'convoyage', statut: 'nouveau', vue_admin_at: null };
      const neuve2 = { id: 'c3', type_service: 'nettoyage', statut: 'nouveau', vue_admin_at: null };
      const etat = {};
      _demandesDevisListe = [lu, neuve1];
      _appliquerCompteurDemandes(_compterNonLues());
      etat.depart = (document.getElementById('badge-admin-devis') || {}).textContent;
      // Une nouvelle demande arrive.
      _demandesDevisListe = [lu, neuve1, neuve2];
      _appliquerCompteurDemandes(_compterNonLues());
      etat.apresNouvelle = (document.getElementById('badge-admin-devis') || {}).textContent;
      // L'administrateur en lit une.
      neuve1.vue_admin_at = '2026-09-08T10:00:00Z';
      _rafraichirEtatLecture();
      etat.apresLecture = (document.getElementById('badge-admin-devis') || {}).textContent;
      // Deux rafraîchissements de suite ne comptent pas deux fois.
      _rafraichirEtatLecture();
      _rafraichirEtatLecture();
      etat.apresDeuxRafraichissements = (document.getElementById('badge-admin-devis') || {}).textContent;
      return etat;
    });
    check('I4 : le badge part du nombre réel de demandes non lues',
      compteur.depart === '1', JSON.stringify(compteur));
    check('I5 : il s\'incrémente dès qu\'une demande arrive',
      compteur.apresNouvelle === '2', JSON.stringify(compteur));
    check('I6 : il décroît quand l\'administrateur en lit une',
      compteur.apresLecture === '1', JSON.stringify(compteur));
    check('I7 : et deux rafraîchissements ne comptent jamais deux fois',
      compteur.apresDeuxRafraichissements === '1', JSON.stringify(compteur));
    check('I8 : aucune erreur JavaScript', errsC.length === 0, errsC.slice(0, 2).join(' | '));
    await pageC.close();
  }

  // ══ J. LE DÉLAI COMMERCIAL ANNONCÉ AU PUBLIC ══
  {
    const publiques = idx
      // Les commentaires techniques et les instructions de retour arrière
      // ne sont pas du texte lu par un client : ils sont écartés.
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    check('J1 : plus aucune promesse publique « 2h » ou « 2 heures »',
      !/(moins de|sous)\s*2\s*(h|heures)/i.test(publiques),
      (publiques.match(/.{0,60}(moins de|sous)\s*2\s*(h|heures).{0,40}/i) || [''])[0]);
    check('J2 : la formulation validée est bien présente',
      /réponse garantie sous 1 heure/i.test(idx));
  }

  // ══ H. LES DEVIS PDF : UNE RESPIRATION, PAS UNE REFONTE ══
  //
  // Certains titres arrivaient collés à la carte grise qui les précède.
  // On ne juge pas cela à l'œil : on MESURE. Le stub jsPDF enregistre
  // les coordonnées réelles de chaque titre et de chaque carte, et on
  // vérifie l'écart entre le bas d'une carte et le titre suivant.
  //
  // Ce que ce test ne fait PAS : rendre un vrai PDF. jsPDF vient d'un
  // CDN, coupé par principe pendant les tests. La relecture visuelle
  // d'un PDF réel reste un contrôle manuel, décrit dans le dossier de
  // recette.
  {
    const STUB = `
window.__pdf = { titres: [], cartes: [], pages: 1, bas: 0 };
window.jspdf = { jsPDF: function () {
  var self = this;
  var courant = 1;
  this.internal = { pageSize: { getWidth: function(){return 210;}, getHeight: function(){return 297;} } };
  this.text = function (s, x, y) {
    window.__pdf.titres.push({ t: String(s), x: x, y: y, page: courant });
    if (typeof y === 'number' && y > window.__pdf.bas) window.__pdf.bas = y;
    return self;
  };
  this.roundedRect = function (x, y, w, h) {
    window.__pdf.cartes.push({ y: y, h: h, bas: y + h, page: courant });
    if (y + h > window.__pdf.bas) window.__pdf.bas = y + h;
    return self;
  };
  this.rect = this.roundedRect;
  this.setFont = function(){return self;}; this.setFontSize = function(){return self;};
  this.setTextColor = function(){return self;}; this.setFillColor = function(){return self;};
  this.setDrawColor = function(){return self;}; this.setLineWidth = function(){return self;};
  this.setLineDashPattern = function(){return self;};
  this.circle = function(){return self;}; this.line = function(){return self;};
  this.addImage = function(){return self;};
  this.addPage = function(){ courant++; window.__pdf.pages = Math.max(window.__pdf.pages, courant); return self; };
  this.setPage = function(n){ courant = n; return self; };
  this.getNumberOfPages = function(){ return window.__pdf.pages; };
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
  this.save = function(){ return self; };
}};
`;
    const DOSSIERS = {
      nettoyage: {
        id: 'q-nett', prenom: 'TEST-QA', nom: 'Nettoyage', email: 'nett@example.invalid',
        type_service: 'nettoyage', statut: 'nouveau', created_at: '2026-09-01T09:00:00Z',
        nettoyage_details: {
          schema_version: 2, type_nettoyage: 'interieur_exterieur', lieu: 'parc_client',
          nombre_vehicules_approx: 12,
          date_souhaitee: '2026-11-02', date_fin: '2026-11-04',
          creneau_debut: '09:00', creneau_fin: '17:00',
          adresse_rue: '3 rue des Lilas', adresse_cp: '69003', adresse_ville: 'Lyon',
          repartition_categories: [{ categorie: 'citadine', quantite: 12, precision: null }],
          contact_sur_place: { type: 'autre', nom: 'TEST-QA Martin', telephone: '+33600000020' }
        }
      },
      professionnel: {
        id: 'q-pro', prenom: 'TEST-QA', nom: 'Professionnel', email: 'pro@example.invalid',
        type_service: 'professionnel', statut: 'nouveau', created_at: '2026-09-01T09:00:00Z',
        professionnel_details: {
          schema_version: 1, categorie: 'renfort', mission: 'jockey', conseil: false,
          nombre_professionnels: 2, nombre_vehicules: 5, adresse_rue: '9 rue Neuf',
          adresse_cp: '44000', adresse_ville: 'Nantes', date_debut: '2026-11-10',
          date_fin: '2026-11-12', duree_jours: 3, heure_debut: '08:00', heure_fin: '17:00',
          description: 'TEST-QA remise en etat complete du parc, avec un suivi quotidien.',
          informations_complementaires: 'TEST-QA acces par le portail arriere, badge a retirer a l accueil.',
          vehicules: [],
          contact_sur_place: { type: 'autre', nom: 'TEST-QA Durand', telephone: '+33600000050' }
        }
      }
    };

    const pagePdf = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errsPdf = [];
    pagePdf.on('pageerror', e => errsPdf.push(e.message));
    pagePdf.on('dialog', d => d.dismiss());
    await pagePdf.addInitScript(STUB);
    await pagePdf.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });

    for (const [nom, dossier] of Object.entries(DOSSIERS)) {
      const mesures = await pagePdf.evaluate((d) => {
        window.__pdf = { titres: [], cartes: [], pages: 1, bas: 0 };
        _demandesDevisListe = [d];
        _devisParClient = {};
        try {
          _construirePdfDevis(d, { reference: 'DEV-QA-0001', client_id: d.id, prix: 480,
                                   statut: 'genere', date_generation: '2026-09-08T10:00:00Z' });
        } catch (e) { return { erreur: e.message }; }
        return window.__pdf;
      }, dossier);

      check('H-' + nom + '1 : le devis se construit sans erreur',
        !mesures.erreur, mesures.erreur);
      if (mesures.erreur) continue;

      // Écart réel entre le bas de la carte précédente et le titre.
      // Les titres sont dessinés en capitales dans le PDF : on compare
      // sur une forme normalisée, jamais sur la casse.
      const AERES = ['mission sur site', 'intervention', 'informations complémentaires',
                     'prestation', 'prestations', "lieu d'intervention", 'véhicules à nettoyer'];
      const ecarts = [];
      mesures.titres.forEach(t => {
        if (AERES.indexOf(String(t.t).toLowerCase()) === -1) return;
        const avant = mesures.cartes
          .filter(c => c.page === t.page && c.bas <= t.y)
          .sort((a, b) => b.bas - a.bas)[0];
        if (avant) ecarts.push({ titre: t.t, ecart: +(t.y - avant.bas).toFixed(2) });
      });
      check('H-' + nom + '2 : les titres visés sont bien précédés d\'une carte mesurable',
        ecarts.length > 0, JSON.stringify(mesures.titres.map(t => t.t).slice(0, 20)));
      check('H-' + nom + '3 : aucun n\'est collé à la carte précédente (≥ 5 mm)',
        ecarts.every(e => e.ecart >= 5), JSON.stringify(ecarts));
      // Marges et pagination : rien ne déborde de la page A4.
      // 297 mm est la hauteur physique d'une A4. Le pied de page est
      // dessiné volontairement tout en bas : ce qui doit être vrai, c'est
      // que RIEN ne sorte de la page.
      check('H-' + nom + '4 : rien n\'est dessiné au-delà de la page A4',
        mesures.bas <= 297, 'point le plus bas : ' + mesures.bas + ' mm');
      check('H-' + nom + '5 : la pagination reste raisonnable',
        mesures.pages >= 1 && mesures.pages <= 3, 'pages : ' + mesures.pages);
    }
    check('H0 : aucune erreur JavaScript pendant la construction des devis',
      errsPdf.length === 0, errsPdf.slice(0, 2).join(' | '));
    await pagePdf.close();
  }

  // ══ L. LA PLAGE HORAIRE FACULTATIVE NE RESSUSCITE RIEN ══
  //
  // Point de revue : la plage conservée pour le nettoyage ne doit pas
  // recréer l'ancienne question, ni ses choix, ni une validation cachée.
  {
    const page = await pageClient(browser);
    // Le nettoyage est réservé aux professionnels : la case
    // « je suis un professionnel » ne se confirme que pour eux.
    await L.fillStep1(page, 'pro');
    await L.chooseService(page, 'nettoyage');
    await page.waitForTimeout(150);
    const etat = await page.evaluate(() => ({
      radiosDispo: document.querySelectorAll('input[name="nett-dispo"]').length,
      champHeure: !!document.getElementById('nett-heure'),
      blocHeure: !!document.getElementById('nett-heure-precise-bloc'),
      groupeDispo: !!document.getElementById('nett-dispo-group'),
      // Les trois libellés supprimés ne doivent plus exister nulle part
      // dans la fenêtre client.
      // Uniquement le bloc du nettoyage : « Heure précise » existe
      // légitimement ailleurs, pour les horaires de convoyage.
      textes: (document.getElementById('bloc-nettoyage-orga') || {}).textContent || '',
      fonctions: ['_nettTypeDispo', '_nettHeure', 'nettOnDispoChange']
        .filter(f => typeof window[f] === 'function')
    }));
    check('L1 : la question et son groupe ont disparu du DOM',
      etat.radiosDispo === 0 && etat.groupeDispo === false, JSON.stringify(etat.fonctions));
    check('L2 : le champ « Heure précise » et son bloc aussi',
      etat.champHeure === false && etat.blocHeure === false);
    check('L3 : plus aucune fonction ne les pilote',
      etat.fonctions.length === 0, JSON.stringify(etat.fonctions));
    check('L4 : le libellé « Quelle est votre disponibilité ? » n\'apparaît nulle part',
      !/Quelle est votre disponibilit/i.test(etat.textes));
    check('L5 : ni « Heure précise », ni « Créneau horaire », ni « Flexible » dans le bloc Nettoyage',
      !/Heure pr[ée]cise|Cr[ée]neau horaire|Flexible/i.test(etat.textes),
      etat.textes.slice(0, 200));

    // AUCUNE VALIDATION CACHÉE : la plage est facultative, et une étape
    // complète sans elle doit passer.
    const validation = await page.evaluate(() => {
      // On remplit tout SAUF la plage horaire.
      const p = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      const clic = (sel) => { const e = document.querySelector(sel); if (e) e.click(); };
      clic('#nett-elig-emplacement'); clic('#nett-elig-eau-elec');
      clic('input[name="nett-lieu"][value="locaux_client"]');
      p('nett-adresse-rue', '24 avenue Victor-Hugo');
      p('nett-adresse-cp', '93260'); p('nett-adresse-ville', 'Les Lilas');
      clic('input[name="nett-contact-sp"][value="autre"]');
      p('nett-contact-sp-nom', 'TEST-QA Karim'); p('nett-contact-sp-tel', '+33600000000');
      const d = new Date(); d.setDate(d.getDate() + 7);
      const f = new Date(); f.setDate(f.getDate() + 9);
      p('nett-date', _hcFormaterYMD(d)); p('nett-date-fin', _hcFormaterYMD(f));
      p('nett-creneau-debut', ''); p('nett-creneau-fin', '');
      clic('input[name="nett-delai"][value="standard"]');
      const sansPlage = _validateNettoyageEtape4();
      // Puis avec une plage incohérente : là, et là seulement, ça bloque.
      p('nett-creneau-debut', '17:00'); p('nett-creneau-fin', '09:00');
      const plageIncoherente = _validateNettoyageEtape4();
      // Et enfin une plage cohérente.
      p('nett-creneau-debut', '09:00'); p('nett-creneau-fin', '17:00');
      const plageCoherente = _validateNettoyageEtape4();
      return { sansPlage: sansPlage.ok, plageIncoherente: plageIncoherente.ok,
               plageCoherente: plageCoherente.ok };
    });
    check('L6 : sans plage horaire, l\'étape est VALIDE — elle est facultative',
      validation.sansPlage === true, JSON.stringify(validation));
    check('L7 : une plage incohérente est refusée, et elle seule',
      validation.plageIncoherente === false, JSON.stringify(validation));
    check('L8 : une plage cohérente passe',
      validation.plageCoherente === true, JSON.stringify(validation));

    // Le payload ne recrée aucune des clés supprimées.
    const payloadNett = await page.evaluate(() => _construireDetailsNettoyage());
    check('L9 : le payload ne porte plus dispo_type ni heure_precise',
      payloadNett.dispo_type === undefined && payloadNett.heure_precise === undefined,
      JSON.stringify(Object.keys(payloadNett)));
    check('L10 : il porte bien la période et la plage',
      !!payloadNett.date_souhaitee && !!payloadNett.date_fin
      && payloadNett.creneau_debut === '09:00' && payloadNett.creneau_fin === '17:00',
      JSON.stringify(payloadNett));
    await page.close();
  }

  // ══ M. LES PROTECTIONS DE LA PR nº 2 SONT INTACTES ══
  //
  // Chacune est vérifiée par une marque VIVANTE dans le code, pas par
  // une déclaration. La suite qui la couvre en détail est nommée.
  {
    const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');
    const sql = ['92', '94', '95', '96', '97', '98', '99']
      .map(n => fs.readdirSync(fichier('migrations'))
        .filter(f => f.indexOf(n + '_') === 0)[0])
      .map(f => fs.readFileSync(fichier('migrations/' + f), 'utf8')).join('\n');

    const PROTECTIONS = [
      ['RLS clients et partenaires (90, 91)', () =>
        fs.readFileSync(fichier('migrations/91_durcissement_rls_clients.sql'), 'utf8')
          .indexOf('enable row level security') !== -1, 't_rls sections V à Z'],
      ['creer_demande_avec_vehicules : listes blanches', () =>
        /champs_publics_demande\(\)/.test(sql) && /champs_publics_vehicule\(\)/.test(sql), 't_rls section V'],
      ['le propriétaire vient de auth.uid(), jamais du navigateur', () =>
        /'rattachee', \(v_uid is not null\)/.test(sql) && !/payload\.auth_user_id\s*=/.test(idx),
        't_rattachement A1-A3'],
      ['rattachement après confirmation (99)', () =>
        /email_confirmed_at/.test(sql) && /_hcReclamerDemandesEnAttente/.test(idx), 't_rattachement C, E'],
      ['deux secrets distincts, séparés par usage', () =>
        /empreinte_secret\('creation'/.test(sql) && /empreinte_secret\('reclamation'/.test(sql)
        && /p_cle_reclamation: cleReclamation/.test(idx), 't_rls section R bis'],
      ['le secret de création n\'est jamais persisté', () =>
        !/_hcMemoriserReclamation\([^)]*cleCreation/.test(idx), 't_rattachement C13-C14 bis'],
      ['aucun handler JavaScript dynamique en ligne', () =>
        /HC_ACTIONS/.test(dash) && /data-hc-a/.test(dash), 't_durcissement B'],
      ['photos de mission réellement existantes (98)', () =>
        /storage\.objects/.test(sql), 't_rls section Z bis'],
      ['verrou serveur des missions (97)', () =>
        /trg_verrou_maj_mission/.test(sql), 't_rls section Z'],
      ['autorisation interne de informations_demande', () =>
        /est_admin\(\)/.test(fs.readFileSync(fichier('migrations/101_informations_types_coherents.sql'), 'utf8')),
        't_rls sections W, T'],
      ['envoi vidéo reprenable et Edge Function', () =>
        /uploadVideoCandidature/.test(idx) && /candidature-video/.test(idx)
        && fs.existsSync(fichier('supabase/functions/candidature-video/index.ts')), 't_tus, t_video_securite'],
      ['verify_jwt versionné pour la fonction vidéo', () =>
        /verify_jwt\s*=\s*false/.test(fs.readFileSync(fichier('supabase/config.toml'), 'utf8')),
        't_video_securite'],
      ['isolement réseau des tests', () =>
        /abort/.test(fs.readFileSync(fichier('tests/env.js'), 'utf8')), 'toutes les suites'],
      ['intégration continue en deux tâches', () => {
        const y = fs.readFileSync(fichier('.github/workflows/tests.yml'), 'utf8');
        return /Politiques RLS/.test(y) && /Suites navigateur/.test(y);
      }, 'GitHub Actions']
    ];
    PROTECTIONS.forEach(([nom, preuve, suite], i) => {
      let ok = false, err = '';
      try { ok = !!preuve(); } catch (e) { err = e.message; }
      check('M' + (i + 1) + ' : ' + nom + ' — intacte (couverte par ' + suite + ')', ok, err);
    });
  }

  // ══ N. MANIFESTE FONCTIONNEL DES NOUVEAUTÉS ══
  //
  // Point 6 de la revue : « le simple comptage des fonctions n'est pas
  // une preuve suffisante ». Une fonction peut exister et ne plus rien
  // faire. Chaque nouveauté apportée par le main précédent est donc
  // vérifiée ici par un COMPORTEMENT réellement observé dans la page —
  // on remplit, on clique, on appelle, on lit le résultat — et la suite
  // qui la couvre en détail est nommée à côté.
  //
  // Les nouveautés qui vivent dans le Dashboard ont leurs propres
  // suites, exécutées dans la même campagne : on en vérifie ici la
  // marque vivante, et on nomme la suite qui les exerce.
  {
    const dash = fs.readFileSync(fichier('dashboard.html'), 'utf8');

    // ── N1 à N5 : le parcours Convoyage multi-véhicules ──
    const page = await pageClient(browser);
    await convoyageAvecVehicules(page, 3, false);

    const fiches = await page.evaluate(() => {
      const set = (id, v) => {
        const e = document.getElementById(id);
        if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }
      };
      set('veh-1-marque', 'TEST-QA-CLAUDE-POSTPR2 Peugeot 308');
      set('veh-1-immat', 'TEST-QA-CLAUDE-POSTPR2-001');
      const lues = _lireFichesVehicules();
      return {
        conteneurs: document.querySelectorAll('[id^="veh-contenu-"]').length,
        marques: lues.map(v => v && v.marque_modele),
        immats: lues.map(v => v && v.immatriculation)
      };
    });
    check('N1 : multi-véhicules — trois fiches réellement rendues (t_multivehicules)',
      fiches.conteneurs === 3, JSON.stringify(fiches.conteneurs));
    check('N2 : multi-véhicules — écrire dans la fiche 2 ne touche ni la 1 ni la 3 (t_multivehicules)',
      fiches.marques[1].indexOf('Peugeot 308') !== -1
      && fiches.marques[0] === '' && fiches.marques[2] === ''
      && fiches.immats[0] === '' && fiches.immats[2] === '',
      JSON.stringify(fiches.marques) + ' / ' + JSON.stringify(fiches.immats));

    // Le calendrier de période : il s'ouvre, il propose Effacer et OK,
    // il écrit une date CIVILE, et Effacer la retire vraiment.
    await page.evaluate(() =>
      _hcOuvrirCalendrier(document.getElementById('veh-0-pc-date')));
    await page.waitForTimeout(250);
    const cal = await page.evaluate(() => {
      const out = {
        effacer: !!document.getElementById('hc-cal-effacer'),
        ok: !!document.getElementById('hc-cal-ok')
      };
      const jours = Array.prototype.slice
        .call(document.querySelectorAll('#hc-cal-grille button.hc-cal-jour'))
        .filter(j => !j.disabled && j.className.indexOf('hors-mois') === -1);
      out.joursOuverts = jours.length;
      if (jours.length) jours[jours.length - 1].click();
      document.getElementById('hc-cal-ok').click();
      out.valeur = (document.getElementById('veh-0-pc-date') || {}).value;
      out.aujourdhui = _hcFormaterYMD(_hcAujourdhui());
      return out;
    });
    check('N3 : calendriers de période — les boutons Effacer et OK existent (t_dates, t_periode)',
      cal.effacer === true && cal.ok === true && cal.joursOuverts > 0, JSON.stringify(cal));
    check('N4 : un clic sur un jour écrit une date CIVILE, jamais un décalage UTC (t_dates)',
      /^\d{4}-\d{2}-\d{2}$/.test(cal.valeur) && cal.valeur >= cal.aujourdhui,
      JSON.stringify(cal.valeur));

    await page.evaluate(() =>
      _hcOuvrirCalendrier(document.getElementById('veh-0-pc-date')));
    await page.waitForTimeout(200);
    const efface = await page.evaluate(() => {
      document.getElementById('hc-cal-effacer').click();
      return (document.getElementById('veh-0-pc-date') || {}).value;
    });
    check('N5 : et « Effacer » retire réellement la date (t_dates)',
      efface === '', JSON.stringify(efface));

    // ── N6 à N8 : la vidéo de candidature ──
    const video = await page.evaluate(() => {
      const max = CONV_VIDEO_TAILLE_MAX;
      _convTraiterFichierVideo({ name: 'TEST-QA.mp4', size: max + 1, type: 'video/mp4' });
      const trop = { etat: _convVideoEtat, msg: _convVideoMsg };
      _convTraiterFichierVideo({ name: 'TEST-QA.txt', size: 1024, type: 'text/plain' });
      const format = { etat: _convVideoEtat, msg: _convVideoMsg };
      const j1 = _convGenererJetonEnvoi();
      const j2 = _convGenererJetonEnvoi();
      return { max, trop, format, jetonsDistincts: j1 !== j2, longueur: String(j1).length };
    });
    check('N6 : limite vidéo de 300 Mo — un fichier de 300 Mo + 1 octet est REFUSÉ (t_video)',
      video.max === 300 * 1024 * 1024 && video.trop.etat === 'invalide'
      && /trop volumineux/i.test(video.trop.msg), JSON.stringify(video.trop));
    check('N7 : et un format non pris en charge est refusé par le même chemin (t_video)',
      video.format.etat === 'invalide' && /Format non pris en charge/.test(video.format.msg),
      JSON.stringify(video.format));
    check('N8 : envoi reprenable — chaque envoi reçoit un jeton unique (t_tus)',
      video.jetonsDistincts === true && video.longueur >= 16, JSON.stringify(video));
    await page.close();

    // ── N9 à N11 : le parcours « Trouver un professionnel » ──
    const pagePro = await pageClient(browser);
    await L.fillStep1(pagePro, 'pro');
    await L.chooseService(pagePro, 'professionnel');
    await pagePro.waitForTimeout(200);
    const pro = await pagePro.evaluate(() => {
      const coche = (nom, val, handler) => {
        const e = document.querySelector('input[name="' + nom + '"][value="' + val + '"]');
        if (e) { e.checked = true; if (typeof window[handler] === 'function') window[handler](); }
        return !!e;
      };
      const okCat = coche('pro-categorie', 'renfort', 'proOnCategorieChange');
      const okMet = coche('pro-mission', 'soutien_administratif', 'proOnMetierChange');
      const d = _construireDetailsProfessionnel();
      return { okCat, okMet, categorie: d.categorie, mission: d.mission,
               libelle: _proLibelleMetier(d), etape4: _estEtapeApplicable(4),
               apresEtape2: _prochaineEtape(2) };
    });
    check('N9 : parcours « Trouver un professionnel » — il vit et se remplit (t_pro, t_pro_ui)',
      pro.okCat === true && pro.okMet === true && pro.categorie === 'renfort',
      JSON.stringify(pro));
    check('N10 : le métier « Soutien administratif » est réellement sélectionnable (t_metiers)',
      pro.mission === 'soutien_administratif' && pro.libelle === 'Soutien administratif',
      JSON.stringify(pro));
    // Le parcours professionnel tient TOUT ENTIER dans l'étape 2 : la
    // 4 ne lui est pas applicable, et « Continuer » mène directement au
    // récapitulatif. C'est la nouveauté, pas un manque.
    check('N11 : le parcours professionnel va de l\'étape 2 au récapitulatif (t_etapes)',
      pro.etape4 === false && pro.apresEtape2 === 5,
      JSON.stringify([pro.etape4, pro.apresEtape2]));
    await pagePro.close();

    // ── N12 à N13 : les huit métiers de candidature ──
    const pageCand = await pageClient(browser);
    await pageCand.evaluate(() => { try { openModal('convoyeur'); } catch (e) {} });
    await pageCand.waitForTimeout(150);
    await pageCand.evaluate(() => { _formStepState.convoyeur = 2; _renderFormStep('convoyeur'); });
    await pageCand.waitForTimeout(200);
    const cand = await pageCand.evaluate(() => {
      const boutons = Array.prototype.slice
        .call(document.querySelectorAll('#conv-metiers-liste [data-ajouter]'))
        .map(b => b.getAttribute('data-ajouter'));
      const b = document.querySelector('#conv-metiers-liste [data-ajouter="soutien_administratif"]');
      if (b) b.click();
      return { boutons, retenus: _metiersPartenaire(), activites: _activitesPartenaire() };
    });
    check('N12 : les huit métiers de la PR nº 2 sont proposés au candidat (t_metiers)',
      cand.boutons.length === 8 && cand.boutons.indexOf('soutien_administratif') !== -1,
      JSON.stringify(cand.boutons));
    check('N13 : en ajouter un déduit bien son activité (t_metiers, t_decisions)',
      cand.retenus.indexOf('soutien_administratif') !== -1
      && cand.activites.indexOf('renfort') !== -1, JSON.stringify(cand));
    await pageCand.close();

    // ── N14 à N16 : le parcours Nettoyage professionnel ──
    const pageNett = await pageClient(browser);
    await L.fillStep1(pageNett, 'pro');
    await L.chooseService(pageNett, 'nettoyage');
    await pageNett.waitForTimeout(200);
    const nett = await pageNett.evaluate(() => ({
      eligibilite: !!document.getElementById('nett-eligibilite-group'),
      orga: !!document.getElementById('bloc-nettoyage-orga'),
      pro: _nettEstProfessionnel(),
      categories: document.querySelectorAll('input[name="nett-categorie"], .nett-rep-ligne').length
    }));
    check('N14 : parcours Nettoyage professionnel — ses blocs sont bien montés (t_nettoyage)',
      nett.eligibilite === true && nett.orga === true && nett.pro === true,
      JSON.stringify(nett));
    const nettPayload = await pageNett.evaluate(() => {
      const r = document.querySelector('input[name="nett-contact-sp"][value="autre"]');
      if (r) { r.checked = true; r.click(); }
      const c = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      c('nett-contact-sp-nom', 'TEST-QA-CLAUDE-POSTPR2 Karim');
      c('nett-contact-sp-tel', '+33600000000');
      const p = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      const d = new Date(); d.setDate(d.getDate() + 5);
      const f = new Date(); f.setDate(f.getDate() + 8);
      p('nett-date', _hcFormaterYMD(d)); p('nett-date-fin', _hcFormaterYMD(f));
      return _construireDetailsNettoyage();
    });
    check('N15 : le nettoyage porte une PÉRIODE, deux bornes civiles (t_nettoyage, t_periode)',
      /^\d{4}-\d{2}-\d{2}$/.test(nettPayload.date_souhaitee || '')
      && /^\d{4}-\d{2}-\d{2}$/.test(nettPayload.date_fin || '')
      && nettPayload.date_fin > nettPayload.date_souhaitee,
      JSON.stringify([nettPayload.date_souhaitee, nettPayload.date_fin]));
    check('N16 : le contact sur place transversal est toujours produit (t_contact)',
      !!nettPayload.contact_sur_place
      && /TEST-QA-CLAUDE-POSTPR2 Karim/.test(JSON.stringify(nettPayload.contact_sur_place)),
      JSON.stringify(nettPayload.contact_sur_place));
    await pageNett.close();

    // ── N17 à N22 : les nouveautés du Dashboard et du serveur ──
    //
    // Marque vivante + suite qui l'exerce réellement dans la campagne.
    const MARQUES = [
      ['devis commun aux quatre services', () =>
        /_construirePdfDevis/.test(dash)
        && ['convoyage', 'stockage', 'nettoyage', 'professionnel']
             .every(sv => new RegExp('^\\s*' + sv + ':', 'm').test(dash)),
        't_devis, t_devis_commun'],
      ['informations nécessaires à la mission', () =>
        /informations_demande/.test(dash) && /informations_demande/.test(idx), 't_infos'],
      ['trois espaces : administrateur, client, partenaire', () =>
        /admin/.test(dash) && /partenaire/.test(dash) && /v_mes_demandes/.test(dash),
        't_client, t_pro_ui, t_blocage'],
      ['charte Dashboard fond blanc', () =>
        /background\s*:\s*#fff|--hc-fond\s*:\s*#fff/i.test(dash), 't_charte'],
      ['décisions multi-activités et blocage partenaire', () =>
        /decisions_candidature|decision_activite|blocage/.test(dash), 't_decisions, t_blocage'],
      ['missions de nettoyage dans le Dashboard', () =>
        /_tenterMissionNettoyage/.test(dash) && /creer_mission_nettoyage_si_prete/.test(dash),
        't_mission_nettoyage, t_nettoyage_dashboard']
    ];
    MARQUES.forEach(([nom, preuve, suite], i) => {
      let ok = false, err = '';
      try { ok = !!preuve(); } catch (e) { err = e.message; }
      check('N' + (i + 17) + ' : ' + nom + ' — présente et exercée par ' + suite, ok, err);
    });
  }

  // ══ O. LES FORMULAIRES HISTORIQUES SONT RESTÉS FIDÈLES ══
  //
  // Point 7 de la revue : les parcours historiques doivent être fidèles
  // à l'ancien index validé, SANS écraser les nouveautés du main
  // courant. On compare donc les libellés <label> relevés dans l'ancien
  // index (tests/reference_ancien_index.js) à ceux de l'index actuel.
  //
  // La règle est stricte dans les deux sens :
  //   • aucun libellé historique ne peut disparaître sans une raison
  //     NOMMÉE dans DISPARUS_EXPLIQUES ;
  //   • et chaque raison nommée doit correspondre à un libellé qui a
  //     RÉELLEMENT disparu — une liste d'excuses qui grossit sans objet
  //     serait, elle aussi, un échec.
  {
    const REF = require('./reference_ancien_index.js');

    // Même extraction que celle qui a produit le relevé de référence.
    const libellesActuels = (() => {
      const out = new Set();
      const re = /<label\b[^>]*>([\s\S]*?)<\/label>/g;
      let m;
      while ((m = re.exec(idx))) {
        const t = m[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 120 && t.indexOf('{') === -1) out.add(t);
      }
      return out;
    })();

    const expliques = REF.DISPARUS_EXPLIQUES.map(d => d[0]);
    const disparus = REF.LIBELLES_ANCIEN_INDEX.filter(l => !libellesActuels.has(l));
    const nonExpliques = disparus.filter(l => expliques.indexOf(l) === -1);
    const excusesSansObjet = expliques.filter(l => disparus.indexOf(l) === -1);

    check('O1 : le relevé de l\'ancien index est bien celui qui a été audité',
      REF.LIBELLES_ANCIEN_INDEX.length === 140,
      REF.LIBELLES_ANCIEN_INDEX.length + ' libellés');
    check('O2 : aucun libellé historique n\'a disparu sans raison nommée',
      nonExpliques.length === 0, nonExpliques.join(' | '));
    check('O3 : et aucune « raison » ne couvre un libellé toujours présent',
      excusesSansObjet.length === 0, excusesSansObjet.join(' | '));
    check('O4 : les onze disparitions sont exactement celles qui étaient demandées',
      disparus.length === 11, disparus.length + ' : ' + disparus.join(' | '));

    // Les nouveautés ne sont pas écrasées : l'index actuel en propose
    // strictement PLUS que l'ancien, et les libellés propres au main
    // courant sont bien là.
    check('O5 : l\'index actuel propose plus de libellés que l\'ancien, pas moins',
      libellesActuels.size > REF.LIBELLES_ANCIEN_INDEX.length,
      libellesActuels.size + ' vs ' + REF.LIBELLES_ANCIEN_INDEX.length);

    // Chaque retrait est COMPENSÉ par le dispositif qui le remplace :
    // on l'exige explicitement, pour qu'une disparition ne puisse jamais
    // être justifiée à vide.
    const REMPLACEMENTS = [
      ['la date unique est remplacée par une période à deux bornes',
        () => /id="nett-date-fin"/.test(idx) && /Date de fin/.test(idx)],
      ['la plage horaire existe, mais facultative',
        () => /id="nett-creneau-debut"/.test(idx) && /id="nett-creneau-fin"/.test(idx)
              && /facultatif/i.test(idx)],
      ['le mode de transport est rendu dans chaque fiche véhicule',
        () => /veh-sstitre/.test(idx)
              && idx.indexOf('name="veh-\' + i + \'-mode') !== -1],
      ['les trois cases d\'activité sont remplacées par les huit métiers',
        () => /METIERS_PARTENAIRE/.test(idx)
              && (idx.match(/cle: '[a-z_]+',\s*libelle:/g) || []).length === 8],
      ['« Soutien administratif » — un métier que l\'ancien index ignorait',
        () => /soutien_administratif/.test(idx)
              && REF.LIBELLES_ANCIEN_INDEX.indexOf('Soutien administratif') === -1]
    ];
    REMPLACEMENTS.forEach(([nom, preuve], i) => {
      let ok = false, err = '';
      try { ok = !!preuve(); } catch (e) { err = e.message; }
      check('O' + (i + 6) + ' : ' + nom, ok, err);
    });

    // Et les parcours NOUVEAUX restent bâtis sur le code actuel : aucun
    // fragment de l'ancien index n'a été recopié dans « Trouver un
    // professionnel » ni dans « Nettoyage ».
    // On vise la DÉFINITION, pas le mot : les commentaires qui
    // expliquent le retrait doivent pouvoir le nommer.
    check('O11 : le parcours Nettoyage n\'a pas été remplacé par l\'ancien code',
      /_construireDetailsNettoyage/.test(idx) && /_nettDateFin/.test(idx)
      && !/function nettOnDispoChange/.test(idx)
      && !/function _nettTypeDispo/.test(idx), 'du code retiré est revenu');
    check('O12 : le parcours « Trouver un professionnel » non plus',
      /_construireDetailsProfessionnel/.test(idx) && /_proMajEtatRubriques/.test(idx),
      'le parcours professionnel a perdu son socle actuel');
  }

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
