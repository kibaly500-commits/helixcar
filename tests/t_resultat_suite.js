const assert = require('node:assert/strict');
const resultat = require('./resultat-suite');
for (const [sortie, code, pass, fail] of [
  ['=== 12 PASS / 0 FAIL ===', 0, 12, 0],
  ['PASS première assertion\nPASS deuxième assertion', 0, 2, 0],
  ['ℹ pass 9\nℹ fail 0', 0, 9, 0],
  ['# pass 3\n# fail 1', 1, 3, 1],
  ['PASS première assertion\nAssertionError', 1, 1, 1],
  ['=== 12 PASS / 0 FAIL ===', 1, 12, 1],
  ['FAIL contrôle\n=== 12 PASS / 0 FAIL ===', 0, 12, 1],
  ['', 0, 0, 1],
  ['PASS contrôle', null, 1, 1],
]) {
  assert.deepEqual(resultat(sortie, code), {pass, fail, etat: fail ? 'ÉCHEC' : 'OK'});
}
console.log('=== 9 PASS / 0 FAIL ===');
