const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const P=require('../assets/preparation-missions.js');
const p={category:'convoyage',title:'Convoyage',remuneration:295,distance:224,motorisation:'Diesel',restit_motorisation:'Essence',mission:{restitution:true},rows:[
 ['Départ','Paris'],['Arrivée','Lille'],['Prise en charge','2026-11-17 · 14:30'],['Livraison','2026-11-22 · 14:30'],['Véhicule','berline · Peugeot 508'],['Restitution','citadine · Renault Clio'],['Trajet de restitution','Lille · Paris'],['Restitution prévue','2026-11-27 · 14:30'],['Garde du véhicule','120 h'],['Garde du véhicule récupéré','5 jours']].map(([label,value])=>({label,value}))};
const data=P.publicData(p);assert.equal(data.remuneration,295);assert.ok(!JSON.stringify(data).includes('Garde du véhicule'));
const source=fs.readFileSync('assets/preparation-missions-ui.js','utf8');
const code=source.slice(source.indexOf('  function card('),source.indexOf('  window.hcPreparationCarteOpportunite='));
const ctx={esc:String,display:v=>String(v||''),money:v=>v==null?'À définir':v+' €'};vm.createContext(ctx);vm.runInContext(code,ctx);
const html=ctx.card(data);assert.ok(html.includes('295 €'));assert.ok(html.includes('224 km'));
assert.ok(html.includes('Véhicule à récupérer à'));assert.ok(html.includes('À livrer à'));assert.ok(html.includes('Premier véhicule'));assert.ok(html.includes('Véhicule à restituer'));
assert.ok(!html.includes('Garde du véhicule'));assert.equal((html.match(/2026-11-22/g)||[]).length,2);
const historical=ctx.card({...data,rows:[...data.rows,{label:'Garde du véhicule',value:'120 h'}]});assert.ok(!historical.includes('120 h'));
assert.ok(source.includes('card(linked?(p.saved?.annonce||HCPreparation.publicData(p)):HCPreparation.publicData(p))'));
console.log('PASS aperçu : prix, distance, étapes explicites, date de récupération retour, aucune ligne de garde, brouillon actuel prioritaire.');
