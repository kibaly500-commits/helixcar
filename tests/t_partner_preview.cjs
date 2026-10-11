const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/preparation-missions.js');
const p={category:'convoyage',title:'Convoyage',remuneration:295,distance:224,motorisation:'Diesel',restit_motorisation:'Essence',mission:{restitution:true},rows:[
 ['Départ','Paris'],['Arrivée','Lille'],['Prise en charge','2026-11-17 · 14:30'],['Livraison','2026-11-22 · 14:30'],['Véhicule','berline · Peugeot 508'],['Restitution','citadine · Renault Clio'],['Trajet de restitution','Lille · Paris'],['Restitution prévue','2026-11-27 · 14:30'],['Garde du véhicule','120 h'],['Garde du véhicule récupéré','5 jours']].map(([label,value])=>({label,value}))};
const data=P.publicData(p);assert.equal(data.remuneration,295);assert.ok(!JSON.stringify(data).includes('Garde du véhicule'));
const source=fs.readFileSync('assets/preparation-missions-ui.js','utf8');
const code=source.slice(source.indexOf('  function card('),source.indexOf('  window.hcPreparationCarteOpportunite='));
const ctx={esc:String,display:v=>String(v||''),money:v=>v==null?'À définir':v+' €'};vm.createContext(ctx);vm.runInContext(code,ctx);
const html=ctx.card(data);assert.ok(html.replace(/\u00a0/g,' ').includes('295 €'));assert.ok(html.includes('224 km'));
assert.ok(html.includes('Véhicule à récupérer à'));assert.ok(html.includes('À livrer à'));assert.ok(html.includes('<h4>Livraison</h4>'));assert.ok(html.includes('Véhicule à restituer'));
assert.ok(!html.includes('Garde du véhicule'));assert.equal((html.match(/2026-11-22/g)||[]).length,2);
const historical=ctx.card({...data,rows:[...data.rows,{label:'Garde du véhicule',value:'120 h'}]});assert.ok(!historical.includes('120 h'));
assert.ok(source.includes('card(linked?(p.saved?.annonce||HCPreparation.publicData(p)):HCPreparation.publicData(p),linked?{}:{editIndex:i})'));
console.log('PASS aperçu : prix, distance, étapes explicites, date de récupération retour, aucune ligne de garde, brouillon actuel prioritaire.');

const noisy={...p,retour_helixcar:{},retour_reception:'2026-11-18T17:45',rows:p.rows.map(r=>r.label==='Restitution prévue'?{...r,value:'Réception chez HelixCar à fixer'}:r)};
const noisyHtml=ctx.card(P.publicData(noisy));assert.ok(noisyHtml.includes('2026-11-18'));assert.ok(noisyHtml.includes('17:45'));
assert.ok(!noisyHtml.includes('Date à préciser'));
console.log('PASS retour Noisy : rendez-vous saisi prioritaire sur ancienne ligne d’affichage.');

const feesHtml=ctx.card(P.publicData({...p,carburant_peages:73.92}));assert.ok(feesHtml.replace(/\u00a0/g,' ').includes('dont 73 €'));assert.ok(!feesHtml.includes('73,92'));

const professional=P.build({type_service:'professionnel',professionnel_details:{categorie:'technicien',specialite:'diagnostic',nombre_professionnels:4,date_debut:'2026-10-20',date_fin:'2026-11-20',heure_debut:'08:30',heure_fin:'17:30',adresse_ville:'Noisy-le-Grand',description:'Contrôler et établir un rapport'}},[]);
assert.equal(professional.length,4);
assert.equal(new Set(professional.map(p=>p.key)).size,4);
assert.ok(professional.every(p=>p.nb_professionnels===1));
professional[0].rows.find(r=>r.label==='Tâches demandées').value='Mission indépendante';
assert.equal(professional[1].rows.find(r=>r.label==='Tâches demandées').value,'Contrôler et établir un rapport');
for(const p of professional){
 const data=P.publicData(p),publicHtml=ctx.card(data),adminHtml=ctx.card(data,{editIndex:0});
 assert.ok(!publicHtml.includes('<dt>Professionnels</dt>'));
 assert.ok(!publicHtml.includes('data-edit-tasks'));
 assert.ok(adminHtml.includes('data-edit-tasks="0"'));
 assert.ok(publicHtml.includes('20 octobre 2026')&&publicHtml.includes('20 novembre 2026'));
}
const withoutTasks={...P.publicData(professional[0]),rows:P.publicData(professional[0]).rows.filter(r=>r.label!=='Tâches demandées')};
assert.ok(ctx.card(withoutTasks,{editIndex:0}).includes('À renseigner'));
assert.ok(!ctx.card(withoutTasks).includes('Tâches demandées'));
const saved=professional.map((p,i)=>({plan:p,cle:p.key,mission_id:i===0?'published':null}));
assert.equal(P.preservePublished(professional,saved).length,4);
console.log('PASS professionnels : quatre annonces indépendantes, dates, tâches optionnelles et stylo réservé à la préparation.');
