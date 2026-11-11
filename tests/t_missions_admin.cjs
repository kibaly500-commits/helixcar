const assert=require('node:assert/strict');
const {etape,datesCiviles}=require('../assets/missions-admin.js');
const published={publiee_le:'2026-11-01',statut:'a_pourvoir'};
assert.equal(etape({statut:'brouillon'},null,false),'preparer');
assert.equal(etape({statut:'en_attente'},{statut:'brouillon'},false),'preparer');
assert.equal(etape({statut:'en_attente'},published,false),'attribuer');
assert.equal(etape({statut:'proposee',convoyeur_id:'a'},null,false),'attribuer');
assert.equal(etape({statut:'acceptee',convoyeur_id:'a'},published,false),'avenir');
assert.equal(etape({statut:'en_cours',convoyeur_id:'a'},published,true),'encours');
assert.equal(etape({statut:'fini',convoyeur_id:'a'},published,true),'encours');
assert.equal(etape({statut:'terminee',convoyeur_id:'a'},published,false),'historique');
assert.equal(etape({statut:'annulee'},published,false),'historique');
assert.equal(etape({statut:'en_attente'},published,true),'historique');
const fleet=[{statut:'brouillon'},{statut:'en_attente'},{statut:'acceptee',convoyeur_id:'a'}];
assert.deepEqual(fleet.map((m,i)=>etape(m,i?published:null,false)),['preparer','attribuer','avenir']);
console.log('PASS missions exclusives par étape, proposition non acceptée, fin à valider non masquée, archives et flotte partiellement attribuée');

assert.equal(datesCiviles({date_livraison:null},'2026-11-09').date_livraison,'2026-11-09');
assert.equal(datesCiviles({date_livraison:'2026-11-09T18:15:00.000000'}).date_livraison,'2026-11-09T18:15:00');
