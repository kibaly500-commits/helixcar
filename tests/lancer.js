#!/usr/bin/env node
// LANCEUR UNIQUE DES TESTS HELIXCAR
// ------------------------------------------------------------------
// La commande documentée jusqu'ici était :
//
//     for f in tests/t_*.js; do node "$f" || echo "ÉCHEC $f"; done
//
// Elle NE PEUT PAS échouer : « || echo » avale le code de retour, et le
// statut final de la boucle est celui du dernier echo. Une suite en
// échec passait donc inaperçue — y compris dans une intégration
// continue, qui aurait affiché un joli vert.
//
// Ce lanceur, lui :
//   * exécute chaque suite dans son propre processus ;
//   * additionne les PASS et les FAIL RÉELLEMENT rapportés ;
//   * compte comme échec une suite qui plante sans ligne de synthèse ;
//   * sort avec un code NON NUL dès qu'une seule chose ne va pas.
//
// Usage :  node tests/lancer.js [--sans-sql] [--seulement <motif>]
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const sansSql = args.includes('--sans-sql');
const iMotif = args.indexOf('--seulement');
const motif = iMotif !== -1 ? args[iMotif + 1] : null;

const LIGNE_SYNTHESE = /===\s*(\d+)\s+PASS\s*\/\s*(\d+)\s+FAIL\s*===/;

function suites() {
  const js = fs.readdirSync(__dirname)
    .filter(f => /^t_.*\.js$/.test(f))
    .sort()
    .map(f => ({ nom: f.replace(/\.js$/, ''), cmd: process.execPath, args: [path.join(__dirname, f)] }));

  const mjs = fs.readdirSync(__dirname)
    .filter(f => /^t_.*\.mjs$/.test(f))
    .sort()
    .map(f => ({ nom: f.replace(/\.mjs$/, ''), cmd: process.execPath, args: [path.join(__dirname, f)] }));

  const sql = sansSql ? [] : [{
    nom: 't_rls',
    cmd: 'bash',
    args: [path.join(__dirname, 't_rls.sh')],
    facultative: 'PostgreSQL 16 local et droits root requis',
  }];

  return [...js, ...mjs, ...sql].filter(s => !motif || s.nom.includes(motif));
}

const liste = suites();
if (liste.length === 0) {
  console.error('Aucune suite ne correspond' + (motif ? ' à « ' + motif + ' »' : '') + '.');
  process.exit(2);
}

console.log('Dépôt   : ' + RACINE);
console.log('Suites  : ' + liste.length);
console.log('');

let totalPass = 0, totalFail = 0;
const enEchec = [];
const resultats = [];
const debutGlobal = Date.now();

for (const s of liste) {
  const debut = Date.now();
  const r = spawnSync(s.cmd, s.args, {
    cwd: RACINE,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const secondes = ((Date.now() - debut) / 1000).toFixed(1);
  const sortie = (r.stdout || '') + (r.stderr || '');
  const m = sortie.match(LIGNE_SYNTHESE);

  let pass = 0, fail = 0, etat;
  if (m) {
    pass = parseInt(m[1], 10);
    fail = parseInt(m[2], 10);
    // Une suite peut afficher « 0 FAIL » ET sortir en erreur : on ne
    // croit pas la ligne sur parole, on regarde aussi le code de sortie.
    etat = (fail === 0 && r.status === 0) ? 'OK' : 'ÉCHEC';
    if (fail === 0 && r.status !== 0) fail = 1;   // incohérence = échec
  } else if (s.facultative && r.status !== 0 && /introuvable|not found|command not found|initdb/i.test(sortie)) {
    etat = 'IGNORÉE';
  } else {
    // Pas de ligne de synthèse : plantage, timeout, sortie tronquée.
    etat = 'ÉCHEC';
    fail = 1;
  }

  totalPass += pass;
  totalFail += fail;
  if (etat === 'ÉCHEC') {
    enEchec.push({ nom: s.nom, code: r.status, sortie });
  }
  resultats.push({ nom: s.nom, pass, fail, etat, secondes });

  console.log(
    (etat === 'OK' ? '  OK    ' : etat === 'IGNORÉE' ? '  ····  ' : '  ÉCHEC ')
    + s.nom.padEnd(24)
    + String(pass).padStart(4) + ' PASS'
    + String(fail).padStart(5) + ' FAIL'
    + '   ' + secondes + 's'
    + (etat === 'IGNORÉE' ? '   (' + s.facultative + ')' : '')
  );
}

console.log('');
console.log('─'.repeat(64));
console.log('TOTAL : ' + totalPass + ' PASS / ' + totalFail + ' FAIL   en '
  + ((Date.now() - debutGlobal) / 1000).toFixed(0) + ' s');

if (enEchec.length) {
  console.log('');
  console.log('Suites en échec : ' + enEchec.map(e => e.nom).join(', '));
  for (const e of enEchec) {
    console.log('');
    console.log('══ ' + e.nom + ' (code ' + e.code + ') ══');
    const lignes = e.sortie.split('\n').filter(l => /^FAIL|Error|error:|Erreur/.test(l));
    (lignes.length ? lignes : e.sortie.split('\n').slice(-25)).slice(0, 40)
      .forEach(l => console.log('  ' + l));
  }
}

// UN SEUL échec suffit à faire échouer l'ensemble.
process.exit(totalFail === 0 && enEchec.length === 0 ? 0 : 1);
