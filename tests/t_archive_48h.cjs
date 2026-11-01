const assert=require('node:assert/strict'),C=require('../assets/planning-calcul');
const when='2026-11-01T10:00',t=C.instant(when),hour=3600000;
assert.equal(C.archiveApres48h(when,t-1),false);
assert.equal(C.archiveApres48h(when,t+47*hour+59*60000),false);
assert.equal(C.archiveApres48h(when,t+48*hour),true);
assert.equal(C.archiveApres48h(when,t+49*hour),true);
for(const value of ['2026-03-28T10:00','2026-10-24T10:00','2026-12-31T10:00']){
 assert.equal(C.archiveApres48h(value,C.instant(value)+48*hour-1),false);
 assert.equal(C.archiveApres48h(value,C.instant(value)+48*hour),true);
}
assert.equal(C.archiveApres48h(''),false);assert.equal(C.archiveApres48h('invalide'),false);
console.log('PASS archives : limite exacte 48 h, futur, changements d’heure et année, dates invalides.');
