// Les suites historiques, les assertions et node:test ont des sorties distinctes.
// Un code d'erreur, un signal ou un FAIL explicite ne devient jamais un succès.
function resultatSuite(sortie, statut) {
  const legacy = sortie.match(/===\s*(\d+)\s+PASS\s*\/\s*(\d+)\s+FAIL\s*===/);
  const nodePass = sortie.match(/^[ℹ#]\s+pass\s+(\d+)\s*$/m);
  const nodeFail = sortie.match(/^[ℹ#]\s+fail\s+(\d+)\s*$/m);
  const lignesPass = (sortie.match(/^PASS\b/gm) || []).length;
  const lignesFail = (sortie.match(/^FAIL\b/gm) || []).length;
  let pass = legacy ? Number(legacy[1]) : nodePass ? Number(nodePass[1]) : lignesPass;
  let fail = legacy ? Number(legacy[2]) : nodeFail ? Number(nodeFail[1]) : lignesFail;
  fail = Math.max(fail, lignesFail);
  if (statut !== 0 || !pass && !fail) fail = Math.max(1, fail);
  return {pass, fail, etat: fail ? 'ÉCHEC' : 'OK'};
}
module.exports = resultatSuite;
