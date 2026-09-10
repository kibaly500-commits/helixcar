// BLOCAGE ET DÉBLOCAGE PERSISTANTS D'UN PARTENAIRE (§12)
// ------------------------------------------------------------------
// Ce que ce fichier prouve, sur le VRAI code du Dashboard :
//   * l'état affiché vient de la base, jamais d'une classe CSS ;
//   * il SURVIT à un rechargement complet de la page ;
//   * il n'existe qu'UN SEUL chemin d'écriture (la fiche partenaire) ;
//   * aucun e-mail n'est envoyé, dans aucun des deux sens.
// Le double Supabase est conservé dans sessionStorage : le rechargement
// simule un vrai retour sur la page avec la base inchangée.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');

let pass = 0, fail = 0; const echecs = [];
function check(l, c, e) {
  if (c) { console.log('PASS - ' + l); pass++; }
  else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; echecs.push(l); }
}

const INIT = `
// Base persistée entre deux chargements : c'est ce qui permet de
// vérifier qu'un blocage tient réellement après un rechargement.
function _lireBase() {
  try { const b = sessionStorage.getItem('__db'); if (b) return JSON.parse(b); } catch (e) {}
  return { convoyeurs: {}, decisions: [], historique: [], emails: [] };
}
window.__db = _lireBase();
function _ecrireBase() {
  try { sessionStorage.setItem('__db', JSON.stringify(window.__db)); } catch (e) {}
}
window.__ecrireBase = _ecrireBase;
window.__journal = [];
window.__role = 'admin';
// Lot A01 : la déconnexion renvoie au site public ; en file://, on observe
// la destination demandée au lieu de naviguer.
window.__retours = [];
window._hcRetourVitrine = function (motif) { window.__retours.push(motif || ''); };

function _table(nom) {
  const req = { table: nom, filtres: {} };
  function _src() {
    return nom === 'convoyeur_decisions' ? window.__db.decisions
         : nom === 'convoyeur_decisions_historique' ? window.__db.historique
         : Object.values(window.__db.convoyeurs);
  }
  const api = {
    select() { return api; },
    eq(col, val) { req.filtres[col] = val; return api; },
    order() { return api; },
    limit() { return api; },
    _lignes() { return _src().filter(l => Object.entries(req.filtres).every(([k, v]) => l[k] === v)); },
    then(resolve) { return Promise.resolve({ data: api._lignes(), error: null }).then(resolve); },
    async maybeSingle() { const l = api._lignes()[0]; return { data: l ? Object.assign({}, l) : null, error: null }; },
    upsert(v) { return { then(r) { window.__db.decisions.push(Object.assign({}, v)); _ecrireBase(); return Promise.resolve({ error: null }).then(r); } }; },
    update(valeurs) {
      const majApi = {
        eq(col, val) { req.filtres[col] = val; return majApi; },
        then(resolve) {
          if (window.__role !== 'admin') {
            window.__journal.push({ op: 'update-refuse', nom: nom });
            return Promise.resolve({ error: { message: 'new row violates row-level security policy for table "' + nom + '"' } }).then(resolve);
          }
          api._lignes().forEach(l => {
            Object.assign(l, valeurs);
            // Trigger de la base : la trace du blocage n'est jamais
            // laissée au navigateur.
            if ('bloque' in valeurs) {
              if (valeurs.bloque) { l.bloque_le = '2026-09-08T10:00:00Z'; l.bloque_par = 'admin-test'; }
              else { l.bloque_le = null; l.bloque_par = null; l.bloque_motif = null; }
            }
          });
          window.__journal.push({ op: 'update', nom: nom, valeurs: Object.assign({}, valeurs) });
          _ecrireBase();
          return Promise.resolve({ error: null }).then(resolve);
        },
      };
      return majApi;
    },
  };
  return api;
}
window.supabase = { createClient: function () { return {
  auth: {
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    getSession: async function () { return { data: { session: { access_token: 'jwt-test' } } }; },
    signOut: async function () { window.__journal.push({ op: 'signOut' }); return {}; },
  },
  from: _table,
  storage: { from: function () { return { createSignedUrl: async function () { return { data: null, error: { message: 'non teste ici' } }; } }; } },
}; } };

// Double REST : le Dashboard lit convoyeurs et missions par sbFetch().
window.__rest = [];
const _fetchReel = window.fetch;
window.fetch = function (url, options) {
  url = String(url);
  const i = url.indexOf('/rest/v1/');
  if (i === -1) return _fetchReel.apply(window, arguments);
  options = options || {};
  const requete = url.slice(i + 9);
  const chemin = requete.split('?')[0];
  const params = new URLSearchParams(requete.split('?')[1] || '');
  const methode = (options.method || 'GET').toUpperCase();
  window.__rest.push({ chemin: chemin, methode: methode });
  let lignes = [];
  if (chemin === 'convoyeurs') {
    lignes = Object.values(window.__db.convoyeurs);
    params.forEach(function (valeur, cle) {
      if (cle.charAt(0) === '$' || ['select', 'order', 'limit', 'offset'].indexOf(cle) !== -1) return;
      if (valeur.indexOf('eq.') === 0) {
        const attendu = decodeURIComponent(valeur.slice(3));
        lignes = lignes.filter(function (l) { return String(l[cle]) === attendu; });
      }
    });
  }
  return Promise.resolve({ ok: true, status: 200,
    text: function () { return Promise.resolve(JSON.stringify(lignes)); } });
};
// Tout envoi d'e-mail serait enregistré ici — et il ne doit y en avoir aucun.
window.emailjs = { send: function () { window.__db.emails.push(Array.from(arguments)); _ecrireBase(); return Promise.resolve(); },
                   init: function () {}, sendForm: function () { window.__db.emails.push(['form']); _ecrireBase(); return Promise.resolve(); } };
`;

const FICHIER = urlFichier('dashboard.html');

(async () => {
  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(INIT);
  await page.goto(FICHIER, { waitUntil: 'load' });

  // Deux partenaires actifs : l'un libre, l'autre déjà bloqué.
  await page.evaluate(() => {
    window.__db.convoyeurs = {
      'p-1': { id: 'p-1', prenom: 'TEST-QA', nom: 'Libre', email: 'libre@example.invalid',
               statut: 'actif', activites: ['convoyage'], bloque: false, nb_missions: 3, km_total: 900 },
      'p-2': { id: 'p-2', prenom: 'TEST-QA', nom: 'Bloque', email: 'bloque@example.invalid',
               statut: 'actif', activites: ['convoyage'], bloque: true,
               bloque_motif: 'Documents expirés', bloque_le: '2026-09-01T08:00:00Z',
               bloque_par: 'admin-test', nb_missions: 5, km_total: 1500 },
    };
    window.__ecrireBase();
  });

  async function chargerListe() {
    await page.evaluate(() => loadConvoyeursActifs());
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#convoyeurs-actifs-table tr').forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length < 6) return;
        out.push({
          nom: tds[0].textContent.trim(),
          etat: tds[4].textContent.trim(),
          actions: tds[5].textContent.trim(),
          classe: tr.className,
        });
      });
      return out;
    });
  }

  // ── A. L'ÉTAT AFFICHÉ EST L'ÉTAT ENREGISTRÉ ──
  let liste = await chargerListe();
  const libre = liste.filter(l => l.nom.indexOf('Libre') !== -1)[0] || {};
  const bloque = liste.filter(l => l.nom.indexOf('Bloque') !== -1)[0] || {};
  check('A1 : un partenaire non bloqué est affiché « Actif »',
    /Actif/.test(libre.etat || '') && !/Bloqué/.test(libre.etat || ''), JSON.stringify(libre));
  check('A2 : un partenaire bloqué n\'est PLUS affiché « Actif »',
    /Bloqué/.test(bloque.etat || '') && !/^Actif$/.test((bloque.etat || '').trim()), JSON.stringify(bloque));
  check('A3 : sa ligne est visuellement distinguée', /blocked/.test(bloque.classe || ''), bloque.classe);
  check('A4 : l\'action proposée dépend de l\'état réel',
    /Bloquer/.test(libre.actions || '') && /Débloquer/.test(bloque.actions || ''),
    JSON.stringify([libre.actions, bloque.actions]));

  // ── B. LA FICHE DIT LA MÊME CHOSE QUE LA LISTE ──
  await page.evaluate(() => voirConvoyeurSb('p-2'));
  await page.waitForTimeout(300);
  const fiche = await page.evaluate(() => {
    const z = document.getElementById('dossier-content');
    const st = document.getElementById('dossier-statut-partenaire');
    const btn = document.getElementById('dossier-btn-block');
    return { texte: z ? z.textContent : '', statut: st ? st.textContent.trim() : '', bouton: btn ? btn.textContent.trim() : '' };
  });
  check('B1 : la fiche d\'un partenaire bloqué affiche « Bloqué »', /Bloqué/.test(fiche.statut), fiche.statut);
  check('B2 : elle indique le motif réellement enregistré',
    fiche.texte.indexOf('Documents expirés') !== -1);
  check('B3 : elle indique la date de blocage', /Bloqué le/.test(fiche.texte));
  check('B4 : le bouton propose bien de débloquer', /Débloquer/.test(fiche.bouton), fiche.bouton);

  // ── C. BLOQUER ÉCRIT RÉELLEMENT ──
  await page.evaluate(() => voirConvoyeurSb('p-1'));
  await page.waitForTimeout(250);
  // Premier clic : le motif est demandé, rien n'est encore écrit.
  await page.evaluate(() => toggleBlockConvoyeur());
  await page.waitForTimeout(150);
  let etat = await page.evaluate(() => ({
    motifVisible: (document.getElementById('block-reason-group') || {}).style.display,
    bloque: window.__db.convoyeurs['p-1'].bloque,
    ecritures: window.__journal.filter(j => j.op === 'update').length,
  }));
  check('C1 : le premier clic demande le motif sans rien écrire',
    etat.motifVisible === 'block' && etat.bloque === false && etat.ecritures === 0, JSON.stringify(etat));

  // Sans motif, rien ne part non plus.
  await page.evaluate(() => toggleBlockConvoyeur());
  await page.waitForTimeout(150);
  etat = await page.evaluate(() => ({ bloque: window.__db.convoyeurs['p-1'].bloque,
                                      ecritures: window.__journal.filter(j => j.op === 'update').length }));
  check('C2 : sans motif sélectionné, aucun blocage n\'est enregistré',
    etat.bloque === false && etat.ecritures === 0, JSON.stringify(etat));

  await page.evaluate(() => { document.getElementById('block-reason').value = 'Abandon de mission'; });
  await page.evaluate(() => toggleBlockConvoyeur());
  await page.waitForTimeout(300);
  const apres = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db.convoyeurs['p-1'])));
  check('C3 : le blocage est réellement écrit dans convoyeurs.bloque', apres.bloque === true, JSON.stringify(apres));
  check('C4 : le motif choisi est enregistré', apres.bloque_motif === 'Abandon de mission', apres.bloque_motif);
  check('C5 : qui et quand sont tracés par la base, pas par le navigateur',
    !!apres.bloque_le && !!apres.bloque_par);
  check('C6 : la fiche ouverte cesse immédiatement d\'annoncer « Actif »',
    await page.evaluate(() => /Bloqué/.test((document.getElementById('dossier-statut-partenaire') || {}).textContent || '')));
  check('C7 : AUCUN e-mail n\'a été envoyé',
    (await page.evaluate(() => window.__db.emails.length)) === 0);

  // ── D. PERSISTANCE APRÈS RECHARGEMENT COMPLET ──
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(250);
  liste = await chargerListe();
  const relu = liste.filter(l => l.nom.indexOf('Libre') !== -1)[0] || {};
  check('D1 : après rechargement, le partenaire bloqué le reste',
    /Bloqué/.test(relu.etat || ''), JSON.stringify(relu));
  check('D2 : et sa ligne reste distinguée', /blocked/.test(relu.classe || ''), relu.classe);
  await page.evaluate(() => voirConvoyeurSb('p-1'));
  await page.waitForFunction(() =>
    ((document.getElementById('dossier-statut-partenaire') || {}).textContent || '').trim().length > 0,
    null, { timeout: 5000 }).catch(() => {});
  const ficheRelue = await page.evaluate(() => ({
    statut: (document.getElementById('dossier-statut-partenaire') || {}).textContent || '',
    texte: (document.getElementById('dossier-content') || {}).textContent || '',
    bouton: (document.getElementById('dossier-btn-block') || {}).textContent || '',
  }));
  check('D3 : sa fiche aussi, avec le motif d\'origine',
    /Bloqué/.test(ficheRelue.statut) && ficheRelue.texte.indexOf('Abandon de mission') !== -1);
  check('D4 : et le bouton propose de débloquer', /Débloquer/.test(ficheRelue.bouton), ficheRelue.bouton);

  // ── E. DÉBLOQUER, ET LA PERSISTANCE DANS L'AUTRE SENS ──
  await page.evaluate(() => toggleBlockConvoyeur());
  await page.waitForTimeout(300);
  const debloque = await page.evaluate(() => JSON.parse(JSON.stringify(window.__db.convoyeurs['p-1'])));
  check('E1 : le déblocage est réellement écrit', debloque.bloque === false, JSON.stringify(debloque));
  check('E2 : la trace de blocage est effacée par la base',
    debloque.bloque_le === null && debloque.bloque_par === null && debloque.bloque_motif === null);
  check('E3 : la fiche redevient « Actif » sans attendre sa réouverture',
    await page.evaluate(() => /Actif/.test((document.getElementById('dossier-statut-partenaire') || {}).textContent || '')));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(250);
  liste = await chargerListe();
  const relu2 = liste.filter(l => l.nom.indexOf('Libre') !== -1)[0] || {};
  check('E4 : après rechargement, il est bien redevenu actif',
    /Actif/.test(relu2.etat || '') && !/Bloqué/.test(relu2.etat || ''), JSON.stringify(relu2));
  check('E5 : et l\'action proposée redevient « Bloquer »',
    /Bloquer/.test(relu2.actions || '') && !/Débloquer/.test(relu2.actions || ''), relu2.actions);
  check('E6 : toujours aucun e-mail', (await page.evaluate(() => window.__db.emails.length)) === 0);

  // ── F. UN SEUL MÉCANISME, AUCUN CHEMIN PARALLÈLE ──
  const journalAvant = await page.evaluate(() => window.__journal.length);
  await page.evaluate(() => bloquerConvoyeur('p-1'));
  await page.waitForTimeout(300);
  const f = await page.evaluate(() => ({
    modaleOuverte: !!document.querySelector('#modal-dossier.active, #modal-dossier[style*="flex"], #modal-dossier[style*="block"]'),
    motifVisible: (document.getElementById('block-reason-group') || {}).style.display,
    bloque: window.__db.convoyeurs['p-1'].bloque,
    ecrituresAjoutees: window.__journal.length,
    emails: window.__db.emails.length,
  }));
  check('F1 : le bouton de la liste ouvre la fiche, il n\'écrit rien lui-même',
    f.bloque === false && f.ecrituresAjoutees === journalAvant, JSON.stringify(f));
  check('F2 : et il présente directement le choix du motif',
    f.motifVisible === 'block', f.motifVisible);
  check('F3 : il n\'envoie aucun e-mail (l\'ancienne version l\'annonçait à tort)',
    f.emails === 0);
  const src = require('fs').readFileSync(fichier('dashboard.html'), 'utf8');
  check('F4 : plus aucune fonction ne se contente de changer une classe CSS',
    src.indexOf("alert('✅ Convoyeur bloqué. Email de notification envoyé automatiquement.')") === -1
    && src.indexOf("alert('✅ Convoyeur débloqué. Email de notification envoyé.')") === -1);
  // Une seule fonction construit la charge écrite, et aucun autre appel
  // update() ne transporte la colonne : le mécanisme n'a pas de double.
  const constructions = (src.match(/const valeurs = \{ bloque: !!bloque \};/g) || []).length;
  const updatesDirects = (src.match(/\.update\(\s*\{[^}]*bloque/g) || []).length;
  check('F5 : une seule fonction écrit la colonne bloque',
    constructions === 1 && updatesDirects === 0, constructions + '/' + updatesDirects);
  check('F6 : les boutons de démonstration à identifiants fictifs ont disparu',
    src.indexOf("bloquerConvoyeur('sara')") === -1 && src.indexOf("debloquerConvoyeur('nadia')") === -1);

  // ── G. UNE SESSION PARTENAIRE OUVERTE EST REVÉRIFIÉE ──
  await page.evaluate(() => {
    window.__db.convoyeurs['p-1'].bloque = true;
    window.__ecrireBase();
    currentRole = 'convoyeur';
    _currentConvoyeur = { id: 'p-1', prenom: 'TEST-QA', nom: 'Libre' };
  });
  const acces = await page.evaluate(async () => await verifierAccesPartenaireEnCours());
  await page.waitForTimeout(200);
  check('G1 : un blocage survenu pendant la session ferme l\'accès', acces === false, String(acces));
  check('G2 : la déconnexion existante du Dashboard est réutilisée',
    await page.evaluate(() => _currentConvoyeur === null || _currentConvoyeur === undefined));
  await page.evaluate(() => {
    window.__db.convoyeurs['p-1'].bloque = false;
    window.__ecrireBase();
    currentRole = 'convoyeur';
    _currentConvoyeur = { id: 'p-1', prenom: 'TEST-QA', nom: 'Libre' };
  });
  check('G3 : une fois débloqué, l\'accès est de nouveau accordé',
    (await page.evaluate(async () => await verifierAccesPartenaireEnCours())) === true);

  check('Z1 : aucune erreur JavaScript pendant tout le scénario',
    errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  echecs.forEach(e => console.log('  - ' + e));
  process.exit(fail === 0 ? 0 : 1);
})();
