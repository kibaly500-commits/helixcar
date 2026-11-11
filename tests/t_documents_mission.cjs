'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const docs=require('../assets/documents-mission');
let passed=0;function ok(name){passed++;console.log('PASS '+name);}
(async()=>{
 for(const [phase,suffix] of Object.entries(docs.suffixes)){
  assert.deepEqual(docs.lireCode(docs.code('HC-2026-0019',phase)),{reference:'HC-2026-0019',phase});
  assert.throws(()=>docs.lireCode('HC-2026-0019/'+suffix,phase==='depart'?'arrivee':'depart'));
  ok('code distinct et contrôle de phase '+phase);
 }
 assert.throws(()=>docs.lireCode('HC-2026-0019/NOPE'));assert.throws(()=>docs.lireCode('%'));assert.throws(()=>docs.lireCode('*'));assert.throws(()=>docs.lireCode(''));ok('codes vides et jokers refusés');
 let calls=[];
 const old={reference:'M-b8ffd2575b1c401a',reference_courte:'HC-2026-0019'};
 const lookup=async path=>{calls.push(path);const u=new URL(path,'https://example.test/');const key=u.searchParams.has('reference_courte')?'reference_courte':'reference';const pattern=u.searchParams.get(key).slice(6).replace(/\\_/g,'_');return old[key].toLowerCase()===pattern.toLowerCase()?[old]:[];};
 assert.equal(await docs.chercher(lookup,'M-B8FFD2575B1C401A'),old);ok('ancienne référence insensible à la casse');
 assert.equal(await docs.chercher(lookup,'hc-2026-0019/DEP','depart'),old);ok('référence publique et code d’étape');
 assert.equal(await docs.chercher(lookup,'HC-2026-9999'),null);ok('référence inconnue sans substitution');
 await assert.rejects(docs.chercher(async()=>[old,old],'HC-2026-0019'));ok('références ambiguës refusées');
 for(const file of ['edl.html','lettre-voiture.html','dashboard.html']){
  for(const script of fs.readFileSync(file,'utf8').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(!/src=|application\/ld\+json/.test(script[1]))new vm.Script(script[2],{filename:file});}
  ok('syntaxe '+file);
 }
 const dashboard=fs.readFileSync('dashboard.html','utf8');
 const offerLoader=dashboard.slice(dashboard.indexOf('async function chargerOpportunitesPartenaire()'),dashboard.indexOf('async function loadOpportunitesPartenaire()'));
 const offers=[{id:'past',statut:'a_pourvoir',date_fin:'2000-01-01'},{id:'assigned',statut:'a_pourvoir',mission_id:'mine'},{id:'closed',statut:'pourvue'},{id:'retained',statut:'a_pourvoir',ma_candidature_etat:'retenu'},{id:'future',statut:'a_pourvoir',date_debut:'2099-01-01'},{id:'ongoing',statut:'a_pourvoir',date_debut:'2000-01-01',date_fin:'2099-01-01'}];
 const offerContext={Intl,Date,Set,_sbAuthPret:()=>true,window:{_currentConvoyeur:{id:'partner'}},sbAuth:{from:table=>({select:()=>({order:async()=>({data:offers}),eq:async()=>({data:[{id:'mine',statut:'acceptee'}]})})})}};
 const visible=await vm.runInNewContext(offerLoader+';chargerOpportunitesPartenaire()',offerContext);
 assert.equal(JSON.stringify(visible.map(o=>o.id)),JSON.stringify(['future','ongoing']));ok('offres : obsolètes, attribuées et closes retirées ; période en cours conservée');
 const edlSource=fs.readFileSync('edl.html','utf8');
 const validator=edlSource.slice(edlSource.indexOf('async function validateMissionCode()'),edlSource.indexOf('// Si l’URL')>0?edlSource.indexOf('// Si l’URL'):edlSource.indexOf('// Si l\'URL'));
 async function checkEdl(phase,status,assigned=true){
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'HC-2026-0019/'+docs.suffixes[phase],style:{},textContent:'',insertAdjacentHTML(){}});return nodes.get(id);};
  const context={HCDocumentsMission:docs,URLSearchParams,console,encodeURIComponent,PHASE:phase,IS_RESTIT:phase.startsWith('restitution'),convoyeurSessionReady:Promise.resolve(),window:{_currentConvoyeur:{id:'own'}},location:{search:'?phase='+phase},document:{getElementById:node,querySelector:node},sbFetch:async()=>[{id:'m1',reference:'M-old',reference_courte:'HC-2026-0019',convoyeur_id:assigned?'own':'other',statut:status}],edlHtml:String,chargerPhotosPrecedentesPourComparaison(){},restaurerBrouillonEdl:async()=>{},updProg(){}};
  await vm.runInNewContext('let currentMission=null,missionCode="";'+validator+';validateMissionCode()',context);return node;
 }
 for(const [phase,status] of Object.entries({depart:'acceptee',arrivee:'en_cours',restitution_depart:'restitution_requise',restitution_arrivee:'restitution_en_cours'})){
  let node=await checkEdl(phase,status);assert.equal(node('step-1').style.display,'block');
  node=await checkEdl(phase,'terminee');assert.notEqual(node('step-1').style.display,'block');assert.equal(node('code-error').style.display,'block');
  node=await checkEdl(phase,status,false);assert.notEqual(node('step-1').style.display,'block');
  ok('EDL '+phase+' : ouverture, ordre et affectation');
 }
 const source=fs.readFileSync('lettre-voiture.html','utf8');
 const loader=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 async function letter({session=true,assigned=true,found=true,restitution=false,fail=false}={}){
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true,disabled:true,classList:{toggle(){}}});return elements.get(id);};
  const m={id:'mission-1',reference:'M-old',reference_courte:'HC-2026-0019',convoyeur_id:assigned?'p1':'p2',restitution:true,marque_modele:'Aller',immatriculation:'AA-001-AA',vin:'VIN-ALLER',restit_marque_modele:'Retour',restit_immatriculation:'BB-002-BB',restit_vin:'VIN-RETOUR',adresse_depart:'Paris',adresse_arrivee:'Lyon',adresse_restitution:'Lille',contact_depart_nom:'Départ',contact_arrivee_nom:'Arrivée',restit_contact_nom:'Restitution'};
  const context={URLSearchParams,URL,Date,console,HCDocumentsMission:docs,location:{search:'?mission=HC-2026-0019'+(restitution?'&trajet=restitution':'')},document:{getElementById:element,querySelector:element},window:{supabase:{createClient:()=>({auth:{getSession:async()=>({data:{session:session?{access_token:'TEST',user:{id:'user'}}:null}})}})}},fetch:async url=>{
   if(fail)return{ok:false,status:503,text:async()=> 'indisponible'};
   let result=[];
   if(url.includes('/missions?'))result=found?[m]:[];
   if(url.includes('/convoyeurs?'))result=[{id:'p1',nom:'Recette',prenom:'Test'}];
   if(url.includes('/etats_des_lieux?'))result=[{phase:'depart',km:0,created_at:'2026-11-01T10:00:00Z'},{phase:'restitution_depart',km:100,created_at:'2026-11-02T10:00:00Z'}];
   return{ok:true,status:200,text:async()=>JSON.stringify(result)};
  }};
  await vm.runInNewContext(loader,context);return element;
 }
 let el=await letter();assert.equal(el('f-reference').textContent,'HC-2026-0019');assert.equal(el('f-modele').textContent,'Aller');assert.equal(el('f-km-depart').textContent,'0');assert.equal(el('f-nom-conv').textContent,'Recette');assert.equal(el('.page').hidden,false);assert.equal(el('print-btn').disabled,false);ok('lettre aller préremplie, kilométrage zéro conservé');
 el=await letter({restitution:true});assert.equal(el('f-modele').textContent,'Retour');assert.equal(el('f-immat').textContent,'BB-002-BB');assert.equal(el('f-lieu-depart').textContent,'Lyon');assert.equal(el('f-lieu-arrivee').textContent,'Lille');assert.equal(el('f-km-depart').textContent,100);ok('lettre restitution : véhicule, trajet et EDL séparés');
 for(const options of [{session:false},{assigned:false},{found:false},{fail:true}]){el=await letter(options);assert.equal(el('.page').hidden,true);assert.equal(el('print-btn').disabled,true);assert.ok(el('document-status').textContent);ok('document bloqué '+JSON.stringify(options));}
 console.log(passed+' contrôles réussis');
})().catch(e=>{console.error(e);process.exitCode=1;});
