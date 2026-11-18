const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('edl.html','utf8');
const validation=source.slice(source.indexOf('function validate(s)'),source.indexOf('\n}',source.indexOf('function validate(s)'))+2);
for(const [phase,depart,saisie,attendu] of [['arrivee',10000,'9999',false],['arrivee',10000,'10000',true],['restitution_arrivee',5000,'4999',false],['restitution_arrivee',5000,'5100',true],['arrivee',0,'0',true],['restitution_depart',10000,'5000',true],['depart',null,'',false]]){
 const context={PHASE:phase,kilometrageDepart:depart,etat:'bon',document:{getElementById:()=>({value:saisie})},alert:()=>{}};
 assert.equal(vm.runInNewContext(validation+';validate(1)',context),attendu,phase+' '+saisie);
}
console.log('PASS refus immédiat des km inférieurs, zéro accepté, véhicules indépendants');
