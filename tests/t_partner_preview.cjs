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
assert.ok(source.includes('card(linked?(p.saved?.annonce||HCPreparation.publicData(p)):HCPreparation.publicData(p))'));
console.log('PASS aperçu : prix, distance, étapes explicites, date de récupération retour, aucune ligne de garde, brouillon actuel prioritaire.');

const noisy={...p,retour_helixcar:{},retour_reception:'2026-11-18T17:45',rows:p.rows.map(r=>r.label==='Restitution prévue'?{...r,value:'Réception chez HelixCar à fixer'}:r)};
const noisyHtml=ctx.card(P.publicData(noisy));assert.ok(noisyHtml.includes('2026-11-18'));assert.ok(noisyHtml.includes('17:45'));
assert.ok(!noisyHtml.includes('Date à préciser'));
console.log('PASS retour Noisy : rendez-vous saisi prioritaire sur ancienne ligne d’affichage.');

const feesHtml=ctx.card(P.publicData({...p,carburant_peages:73.92}));assert.ok(feesHtml.replace(/\u00a0/g,' ').includes('dont 73 €'));assert.ok(!feesHtml.includes('73,92'));
