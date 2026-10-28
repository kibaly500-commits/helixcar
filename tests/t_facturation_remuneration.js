const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const html = fs.readFileSync('dashboard.html', 'utf8');
const wanted = new Set(['remunerationFacturable','recalculerTotalFactureConvoyeur','genererFactureConvoyeur','loadFacturationConvoyeur']);
let source = '';
for (const block of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
 const js = block[1];
 for (const n of acorn.parse(js, {ecmaVersion:'latest',sourceType:'script'}).body) {
  if (n.type === 'FunctionDeclaration' && wanted.has(n.id.name)) source += js.slice(n.start,n.end)+'\n';
 }
}
const button = {}, total = {}, alerts = [], posts = [], elements = {};
let missions = [], invoices = []; 
let checks = [];
const ctx = {window:{_currentConvoyeur:{id:'partner-test'}}, document:{querySelectorAll:()=>checks,getElementById:id=>id==='fc-conv-total'?total:id==='fc-conv-generer-btn'?button:(elements[id] ||= {style:{}})}, sbFetchToutePage:async path=>path.startsWith('missions?')?missions:invoices,missionSurPlace:m=>['professionnel','nettoyage'].includes(m.type_mission),escapeHtml:s=>String(s),referenceMission:m=>m.id,_dvDate:s=>s,FACTURE_STATUT_BADGE:{},compterJoursOuvresEntre:()=>10,alert:m=>alerts.push(m),confirm:()=>true,console,loadFacturationConvoyeur:()=>{},sbFetch:async(path,opts)=>posts.push(JSON.parse(opts.body))};
vm.createContext(ctx); vm.runInContext(source, ctx);
for(const [m,expected] of [
 [{prix_ttc:null,remuneration_prevue:'300'},300],
 [{prix_ttc:900,remuneration_prevue:300},300],
 [{prix_ttc:900},450],
 [{prix_ttc:900,remuneration_prevue:0},null],
 [{prix_ttc:900,remuneration_prevue:'invalide'},null],
 [{prix_ttc:null},null],
 [{remuneration_prevue:99.99},99.99]
]) assert.equal(ctx.remunerationFacturable(m),expected);
function select(amount){return {getAttribute:k=>k==='data-mission-id'?'mission-test':String(amount)};}
(async()=>{
 checks=[select(300)];ctx.recalculerTotalFactureConvoyeur();assert.equal(button.disabled,false);assert.match(total.textContent,/300/);
 ctx.genererFactureConvoyeur();await Promise.resolve();assert.equal(posts.length,1);assert.equal(posts[0].montant_total,300);assert.deepEqual(posts[0].mission_ids,['mission-test']);
 checks=[select(0)];ctx.recalculerTotalFactureConvoyeur();assert.equal(button.disabled,true);ctx.genererFactureConvoyeur();assert.equal(posts.length,1);
 checks=[select(300),select(0)];ctx.genererFactureConvoyeur();assert.equal(posts.length,1);
 checks=[select(99.99),select(0.01)];ctx.genererFactureConvoyeur();await Promise.resolve();assert.equal(posts[1].montant_total,100);
 ctx.window._factureBloqueeJusquau=new Date();ctx.genererFactureConvoyeur();assert.equal(posts.length,2);
 ctx.window._factureBloqueeJusquau=null;
 missions=[{id:'diagnostic',type_mission:'professionnel',prix_ttc:null,remuneration_prevue:300,validee_paiement:true},
 {id:'sans-validation',type_mission:'professionnel',remuneration_prevue:400},
 {id:'sans-lettre',type_mission:'convoyage',remuneration_prevue:200,validee_paiement:true},
 {id:'sans-prix',type_mission:'professionnel',validee_paiement:true}];
 await ctx.loadFacturationConvoyeur();
 let list=elements['fc-conv-missions-list'].innerHTML;
 assert.match(list,/data-mission-id="diagnostic" data-montant="300"/);
 assert.doesNotMatch(list,/data-mission-id="(?:sans-validation|sans-lettre|sans-prix)"/);
 invoices=[{mission_ids:['diagnostic'],reference:'FAC-TEST',montant_total:300}];
 await ctx.loadFacturationConvoyeur();assert.doesNotMatch(elements['fc-conv-missions-list'].innerHTML,/data-mission-id="diagnostic"/);
 console.log('PASS rémunération explicite, diagnostic 300 €, compatibilité historique, montants invalides, total exact et délai de facturation');
})().catch(e=>{console.error(e);process.exitCode=1;});
