// Dashboard administrateur : fiche candidat unique, états de la vidéo,
// lecture par URL signée temporaire, nettoyage à la fermeture.
const { chromium, lancerNavigateur, RACINE, fichier, urlFichier } = require('./env.js');
const path = require('path');

let pass = 0, fail = 0; const failures = [];
function check(l, c, e) { if (c) { console.log('PASS - ' + l); pass++; } else { console.log('FAIL - ' + l + (e ? '  [' + e + ']' : '')); fail++; failures.push(l); } }

const AVEC_VIDEO = {
  id: 'cand-1', prenom: 'TEST-QA', nom: 'Martin', email: 'qa@example.invalid',
  telephone: '+33600000000', activites: ['convoyage', 'renfort'], statut: 'en_attente',
  video_chemin: 'candidatures/8f14e45f-ea8d-4c2b-9f21-000000000001.webm',
  video_mime: 'video/webm', video_taille_octets: 2676, video_duree_secondes: 30.1
};
const SANS_VIDEO_REQUISE = {
  id: 'cand-2', prenom: 'TEST-QA', nom: 'Durand', email: 'qa2@example.invalid',
  telephone: '+33600000001', activites: ['convoyage'], statut: 'en_attente', video_chemin: null
};
const NETTOYAGE_SEUL = {
  id: 'cand-3', prenom: 'TEST-QA', nom: 'Petit', email: 'qa3@example.invalid',
  telephone: '+33600000002', activites: ['nettoyage'], statut: 'en_attente', video_chemin: null
};
// LOT V01 — envoi autorisé mais jamais finalisé (migration 105) : ni
// reçue, ni absente. L'administrateur doit le lire tel quel.
const ENVOI_EN_COURS = {
  id: 'cand-4', prenom: 'TEST-QA', nom: 'Roux', email: 'qa4@example.invalid',
  telephone: '+33600000003', activites: ['convoyage'], statut: 'video_attendue', video_chemin: null,
  video_envoi_chemin: 'candidatures/8f14e45f-ea8d-4c2b-9f21-000000000004/aaaaaaaa-0000-4000-8000-000000000004.mp4',
  video_envoi_mime: 'video/mp4', video_envoi_taille_octets: 225024410, video_envoi_commence_le: '2026-09-09T10:00:00Z'
};

// `const sbAuth = window.supabase ? window.supabase.createClient(...) : null`
// est évalué au chargement, et supabase-js vient d'un CDN injoignable ici.
// On fournit donc window.supabase AVANT les scripts de la page : le vrai
// `sbAuth` du Dashboard est alors un client double, entièrement
// instrumenté. Aucune ligne du code de production n'est modifiée.
const INIT_SUPABASE = `
  window.__signatures = [];
  window.__resultatSignature = { data: { signedUrl: 'https://exemple.invalid/signed?token=abc&expires=300' }, error: null };
  window.supabase = {
    createClient: function () {
      return {
        auth: { onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
                getSession: async function () { return { data: { session: null } }; },
                signOut: async function () { return {}; } },
        // Double minimal du query builder PostgREST. order, limit et then
        // sont indispensables : la fiche partenaire charge desormais les
        // decisions et leur historique, qui trient les lignes.
        from: function () { return { select: function () { return this; }, eq: function () { return this; },
                 order: function () { return this; }, limit: function () { return this; },
                 then: function (resoudre) { return Promise.resolve({ data: [], error: null }).then(resoudre); },
                 maybeSingle: async function () { return { data: null, error: null }; },
                 insert: async function () { return {}; }, update: function () { return this; } }; },
        storage: {
          from: function (bucket) {
            return {
              createSignedUrl: async function (chemin, duree) {
                window.__signatures.push({ bucket: bucket, chemin: chemin, duree: duree });
                return window.__resultatSignature;
              }
            };
          }
        }
      };
    }
  };
`;
async function definirResultatSignature(page, litteral) {
  await page.evaluate(r => { window.__resultatSignature = r; window.__signatures = []; }, litteral);
}

(async () => {
  const browser = await lancerNavigateur();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.addInitScript(INIT_SUPABASE);
  await page.goto(urlFichier('dashboard.html'), { waitUntil: 'load' });

  await page.evaluate(([a, b, c, d]) => {
    window._candidaturesData = {};
    [a, b, c, d].forEach(x => { window._candidaturesData[x.id] = x; });
  }, [AVEC_VIDEO, SANS_VIDEO_REQUISE, NETTOYAGE_SEUL, ENVOI_EN_COURS]);

  // ── A. Fiche unique et états ──
  await page.evaluate(() => openDossierSb('cand-1'));
  const dossierCandidat = await page.evaluate(() => document.getElementById('dossier-content').textContent);
  check('A0 : le RIB n\'est pas demandé dans le dossier de candidature', !/RIB/i.test(dossierCandidat), dossierCandidat);
  await page.waitForTimeout(120);
  let fiche = await page.evaluate(() => ({
    html: document.getElementById('dossier-content').innerHTML,
    texte: document.getElementById('dossier-content').textContent,
    nbFiches: document.querySelectorAll('#dossier-content').length
  }));
  check('A1 : une seule fiche par candidat, malgré 2 activités', fiche.nbFiches === 1);
  check('A2 : toutes les activités affichées',
    /Convoyage/i.test(fiche.texte) && /Renfort/i.test(fiche.texte), fiche.texte.slice(0, 200));
  check('A3 : bouton « Voir la vidéo » présent', /Voir la vidéo/.test(fiche.html));
  check('A4 : métadonnées affichées (durée et taille)', /30 s/.test(fiche.texte), fiche.texte.slice(-160));
  check('A5 : aucune URL de stockage exposée dans la fiche',
    !/candidatures\/|storage\/v1/.test(fiche.html), fiche.html.slice(0, 200));

  await page.evaluate(() => openDossierSb('cand-2'));
  await page.waitForTimeout(80);
  fiche = await page.evaluate(() => document.getElementById('dossier-content').textContent);
  check('A6 : vidéo attendue mais absente -> « Manquante »', /Manquante/i.test(fiche), fiche.slice(-160));

  await page.evaluate(() => openDossierSb('cand-3'));
  await page.waitForTimeout(80);
  fiche = await page.evaluate(() => document.getElementById('dossier-content').textContent);
  check('A7 : nettoyage seul sans vidéo -> « Manquante »',
    /Manquante/i.test(fiche) && !/Non requise/i.test(fiche), fiche.slice(-160));

  await page.evaluate(() => openDossierSb('cand-4'));
  await page.waitForTimeout(80);
  let ficheEnCours = await page.evaluate(() => ({
    html: document.getElementById('dossier-content').innerHTML,
    texte: document.getElementById('dossier-content').textContent
  }));
  check('A8 : LOT V01 — envoi autorisé non finalisé -> « Envoi en cours, non finalisé », ni « Manquante » ni « Voir la vidéo »',
    /Envoi en cours, non finalisé/.test(ficheEnCours.texte) && !/Manquante/i.test(ficheEnCours.texte)
    && !/Voir la vidéo/.test(ficheEnCours.html), ficheEnCours.texte.slice(-200));
  check('A9 : ... et aucun chemin de stockage exposé pour un envoi en cours',
    !/candidatures\/|storage\/v1/.test(ficheEnCours.html));

  // ── B. Lecture réussie par URL signée ──
  await definirResultatSignature(page, { data: { signedUrl: 'https://exemple.invalid/signed?token=abc&expires=300' }, error: null });
  // On lit l'etat dans le MEME evaluate que l'appel : l'hote de test
  // n'existe pas, donc <video> finit toujours par declencher onerror et
  // remasquer le lecteur. Ce repli est le comportement voulu en cas de
  // fichier illisible ; il ne doit pas masquer ce qu'on verifie ici,
  // a savoir que l'URL signee obtenue est bien affichee.
  let lecture = await page.evaluate(async () => {
    await ouvrirVideoCandidature('cand-1');
    return ({
    modaleOuverte: document.getElementById('modal-video-candidature').classList.contains('open'),
    lecteurVisible: document.getElementById('video-candidature-lecteur').style.display,
    src: document.getElementById('video-candidature-lecteur').getAttribute('src') || '',
    etatVisible: document.getElementById('video-candidature-etat').style.display,
    meta: document.getElementById('video-candidature-meta').textContent,
    titre: document.getElementById('video-candidature-titre').textContent,
    signatures: window.__signatures
  });
  });
  check('B1 : modale de lecture ouverte', lecture.modaleOuverte);
  check('B2 : lecteur affiché', lecture.lecteurVisible === 'block');
  check('B3 : la source est bien l\'URL SIGNÉE', /signed\?token=abc/.test(lecture.src), lecture.src);
  check('B4 : signature demandée sur le bucket privé et le bon chemin',
    lecture.signatures.length === 1 &&
    lecture.signatures[0].bucket === 'candidatures-videos' &&
    lecture.signatures[0].chemin === AVEC_VIDEO.video_chemin,
    JSON.stringify(lecture.signatures));
  check('B5 : durée de validité limitée (<= 300 s)',
    !!lecture.signatures[0] && lecture.signatures[0].duree === 300,
    JSON.stringify(lecture.signatures));
  check('B6 : titre nominatif', /TEST-QA Martin/.test(lecture.titre), lecture.titre);
  check('B7 : métadonnées affichées sous le lecteur', /30 s/.test(lecture.meta), lecture.meta);

  // ── C. Fermeture : l'URL signée ne persiste pas ──
  await page.evaluate(() => fermerVideoCandidature());
  await page.waitForTimeout(120);
  let apres = await page.evaluate(() => ({
    ouverte: document.getElementById('modal-video-candidature').classList.contains('open'),
    src: document.getElementById('video-candidature-lecteur').getAttribute('src'),
    srcProp: document.getElementById('video-candidature-lecteur').src,
    meta: document.getElementById('video-candidature-meta').textContent,
    variable: window._urlVideoSignee,
    domEntier: document.getElementById('modal-video-candidature').innerHTML
  }));
  check('C1 : modale refermée', apres.ouverte === false);
  check('C2 : attribut src réellement retiré', apres.src === null, String(apres.src));
  check('C3 : URL signée absente du DOM', !/signed\?token=abc/.test(apres.domEntier));
  check('C4 : URL signée oubliée en mémoire', !apres.variable, String(apres.variable));
  check('C5 : métadonnées effacées', apres.meta === '');

  // ── D. Fichier introuvable -> « indisponible » ──
  await definirResultatSignature(page, { data: null, error: { message: 'Object not found' } });
  await page.evaluate(() => ouvrirVideoCandidature('cand-1'));
  await page.waitForTimeout(200);
  let etat = await page.evaluate(() => ({
    txt: document.getElementById('video-candidature-etat').textContent,
    visible: document.getElementById('video-candidature-etat').style.display,
    lecteur: document.getElementById('video-candidature-lecteur').style.display
  }));
  check('D1 : fichier introuvable -> état « indisponible »', /indisponible/i.test(etat.txt), etat.txt);
  check('D2 : aucun lecteur affiché dans ce cas', etat.lecteur === 'none');
  await page.evaluate(() => fermerVideoCandidature());

  // ── E. Non autorisé -> « erreur », jamais la vidéo ──
  await definirResultatSignature(page, { data: null, error: { message: 'new row violates row-level security policy' } });
  await page.evaluate(() => ouvrirVideoCandidature('cand-1'));
  await page.waitForTimeout(200);
  etat = await page.evaluate(() => ({
    txt: document.getElementById('video-candidature-etat').textContent,
    lecteur: document.getElementById('video-candidature-lecteur').style.display,
    src: document.getElementById('video-candidature-lecteur').getAttribute('src')
  }));
  check('E1 : refus RLS -> message d\'erreur explicite',
    /non autoris|erreur/i.test(etat.txt), etat.txt);
  check('E2 : refus RLS -> aucune vidéo jouée', etat.lecteur === 'none' && !etat.src);
  await page.evaluate(() => fermerVideoCandidature());

  // ── F. Session non administrateur -> pas de lecture ──
  // Simule l'absence de client authentifié (supabase-js non chargé) :
  // on retire le storage du client réellement utilisé par la page.
  await page.evaluate(() => { try { sbAuth.storage = null; } catch (e) { window.sbAuth = { storage: null }; } });
  await page.evaluate(() => ouvrirVideoCandidature('cand-1'));
  await page.waitForTimeout(180);
  etat = await page.evaluate(() => ({
    txt: document.getElementById('video-candidature-etat').textContent,
    lecteur: document.getElementById('video-candidature-lecteur').style.display
  }));
  check('F1 : sans session administrateur -> lecture refusée',
    /session administrateur/i.test(etat.txt), etat.txt);
  check('F2 : sans session administrateur -> aucun lecteur', etat.lecteur === 'none');
  await page.evaluate(() => fermerVideoCandidature());

  // ── G. Candidature sans vidéo ──
  await page.evaluate(() => ouvrirVideoCandidature('cand-2'));
  await page.waitForTimeout(150);
  etat = await page.evaluate(() => document.getElementById('video-candidature-etat').textContent);
  check('G1 : candidature sans vidéo -> message clair', /indisponible|aucune vid/i.test(etat), etat);
  await page.evaluate(() => fermerVideoCandidature());

  check('Aucune erreur JS', errs.length === 0, errs.join(' | '));

  await browser.close();
  console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (failures.length) failures.forEach(f => console.log('  - ' + f));
  process.exit(fail > 0 ? 1 : 0);
})();
