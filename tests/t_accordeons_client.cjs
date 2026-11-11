const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),acorn=require('acorn'),walk=require('acorn-walk');
function extraire(source,name){let result;walk.simple(acorn.parse(source,{ecmaVersion:'latest'}),{FunctionDeclaration(n){if(n.id.name===name)result=source.slice(n.start,n.end)}});assert.ok(result,name);return result;}
const html=fs.readFileSync('dashboard.html','utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
async function rendu(){
 let groupes=[],rows=[];
 const zone={innerHTML:'',querySelectorAll:()=>groupes,querySelector:()=>groupes[0]||null};
 const c={window:{},document:{getElementById:()=>zone},_demandesClientGeneration:0,chargerDemandesClient:async()=>rows,chargerDevisClient:async()=>[],chargerInformationsDemande:async()=>[],_presentationDemandeClient:d=>({groupe:d.groupe,message:'Test',texte:'Test'}),_aStockage:()=>false,_etatDevisClient:()=>null,_badgesSuiviDemandeClient:()=>[],escapeHtml:String,_libelleServiceClient:()=> 'Convoyage automobile',actionHtml:()=>'',Map};
 vm.createContext(c);vm.runInContext(extraire(scripts,'loadDemandesClient'),c);
 await c.loadDemandesClient();
 const ordre=['devis','demandes','preparation','en-cours','cloture'];
 assert.deepEqual([...zone.innerHTML.matchAll(/data-groupe-demandes="([^"]+)"/g)].map(m=>m[1]),ordre);
 assert.equal((zone.innerHTML.match(/hc-demandes-compteur">0</g)||[]).length,5);
 assert.equal((zone.innerHTML.match(/<details class="hc-demandes-accordeon">/g)||[]).length,5);
 rows=[{id:'a',groupe:'preparation'},{id:'b',groupe:'preparation'},{id:'c',groupe:'cloture'}];
 groupes=[{dataset:{groupeDemandes:'preparation'},querySelector:()=>({open:true})}];
 await c.loadDemandesClient();
 assert.match(zone.innerHTML,/data-groupe-demandes="preparation"><details class="hc-demandes-accordeon" open>/);
 assert.equal((zone.innerHTML.match(/hc-demandes-accordeon" open/g)||[]).length,1);
 assert.match(zone.innerHTML,/Prestations en préparation <span class="hc-demandes-compteur">2</);
 assert.match(zone.innerHTML,/Vos devis <span class="hc-demandes-compteur">0</);
}
// Double DOM limité aux conteneurs et événements utilisés par le marquage.
function cible(){return {badge:null,querySelector(){return this.badge},append(b){this.badge=b;b.remove=()=>this.badge=null}};}
function carte(id,etat='preparation',lu='false'){
 const summary=cible(),details={open:false,isConnected:true,dataset:{},addEventListener(type,fn){this.listener=fn}};
 return {isConnected:true,addEventListener(type,fn){this.click=fn},contains:()=>true,dataset:{demande:id,etatDemande:etat,devisLu:lu},summary,details,querySelector:s=>s==='.hc-demande-summary'?summary:details};
}
async function badges(){
 const a=carte('a'),b=carte('b'),consulte=carte('c','devis','true'),heading=cible(),vide=cible(),devis=cible();
 const groupes=[{querySelectorAll:()=>[a,b],querySelector:()=>heading},{querySelectorAll:()=>[],querySelector:()=>vide},{querySelectorAll:()=>[consulte],querySelector:()=>devis}];
 let panne=false,saves=0;
 const c={uid:'compte-A',currentRole:'client',prefs:{nouveautes_lues:{}},document:{querySelectorAll:()=>groupes,createElement:()=>({})},sauver:async()=>{saves++;if(panne)throw Error('indisponible')}};
 vm.createContext(c);vm.runInContext(extraire(fs.readFileSync('assets/parcours-comptes.js','utf8'),'marquerNouveaux'),c);
 c.marquerNouveaux();assert.ok(heading.badge);assert.ok(a.summary.badge);assert.ok(b.summary.badge);assert.equal(vide.badge,null);assert.equal(devis.badge,null);
 await a.details.listener();assert.equal(saves,0);assert.ok(heading.badge);
 await a.click({target:{closest:()=>({disabled:true})}});assert.equal(saves,0);
 await a.click({target:{closest:()=>({disabled:false})}});assert.equal(a.summary.badge,null);assert.ok(heading.badge);
 panne=true;b.details.open=true;await b.details.listener();assert.ok(b.summary.badge);assert.ok(heading.badge);
 panne=false;await b.details.listener();assert.equal(heading.badge,null);
 c.marquerNouveaux();assert.equal(heading.badge,null);
 c.prefs.nouveautes_lues={};c.uid='compte-B';await b.details.listener();assert.equal(Object.keys(c.prefs.nouveautes_lues).length,0);
}
(async()=>{await rendu();await badges();console.log('PASS cinq rubriques à zéro, ordre, fermeture initiale, conservation ouverture, compteurs, badges agrégés, consultation individuelle, échec/reprise et changement de compte');})().catch(e=>{console.error(e);process.exitCode=1});
