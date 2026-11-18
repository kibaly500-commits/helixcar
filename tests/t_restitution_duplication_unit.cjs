const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const html = fs.readFileSync('index.html', 'utf8');
const names = ['_hcCopierVehiculeVers','basculerLivraisonVehicule','_viderRestitutionVehicule','_vehiculeARestitutionSpecifique','_lireFichesVehicules'];
const functions = {};
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  const source = match[1];
  const ast = acorn.parse(source, {ecmaVersion:'latest',sourceType:'script',allowReturnOutsideFunction:true});
  for (const n of ast.body) if(n.type==='FunctionDeclaration' && names.includes(n.id.name)) functions[n.id.name]=source.slice(n.start,n.end);
}
function setup() {
  const elements = new Map(), radios=[];
  function element(id,value='') {
    const e={id,value,dataset:{},style:{},classList:{remove(){}},querySelectorAll(){return []},selectedIndex:0};
    elements.set(id,e);return e;
  }
  function radio(name,value,checked=false) {
    const r={name,value,_checked:checked};
    Object.defineProperty(r,'checked',{get(){return this._checked},set(v){if(v)for(const other of radios)if(other.name===name)other._checked=false;this._checked=v;}});
    radios.push(r);return r;
  }
  function select(sel) {
    const name=sel.match(/name="([^"]+)"/)?.[1], value=sel.match(/value="([^"]+)"/)?.[1];
    return radios.filter(r=>r.name===name && (value===undefined||r.value===value) && (!sel.endsWith(':checked')||r.checked));
  }
  const doc={getElementById:id=>elements.get(id)||null,querySelector:sel=>select(sel)[0]||null,querySelectorAll:sel=>sel.startsWith('input[')?select(sel):[]};
  for(let i=0;i<2;i++) {
    for(const suffix of ['type','marque','immat','vin','motorisation','recup-heure','restit-vtype','restit-marque','restit-immat','restit-vin','restit-motorisation','restit-destination'])element(`veh-${i}-${suffix}`);
    elements.get(`veh-${i}-restit-destination`).value='adresse';
    for(const prefix of ['pc','liv','restit'])for(const s of ['rue','cp','ville','contact','tel','date','heure','cdeb','cfin','consignes'])element(`veh-${i}-${prefix}-${s}`);
    for(const prefix of ['liv','restit']){radio(`veh-${i}-${prefix}-active`,'oui',true);radio(`veh-${i}-${prefix}-active`,'non');}
    for(const prefix of ['pc','liv','restit']){radio(`veh-${i}-${prefix}-htype`,'precise',true);radio(`veh-${i}-${prefix}-htype`,'creneau');}
    radio(`veh-${i}-mode`,'standard',true);
    for(const id of [`veh-liv-spec-${i}`,`veh-recup-client-${i}`,`veh-restit-${i}`,`veh-restit-question-${i}`,`veh-${i}-sous-mode`])element(id);
  }
  const ctx={document:doc,window:{},_clearFieldError(){},_majBarreVehicule(){},_majProgressionVehicules(){},basculerHoraire(){},_nbVehicules:()=>2,_livraisonSansObjet:()=>false,
    _vehiculeLivraisonApresStockage:i=>doc.querySelector(`input[name="veh-${i}-liv-active"]:checked`)?.value==='oui',
    _typeHoraire:()=> 'precise',
    _hcRetourDestination(i){const d=elements.get(`veh-${i}-restit-destination`);d.dataset.precedent=d.value;},
    basculerRestitVehicule(i){if(!ctx._vehiculeARestitutionSpecifique(i))ctx._viderRestitutionVehicule(i);}
  };
  vm.createContext(ctx);vm.runInContext(names.map(n=>functions[n]).join('\n'),ctx);
  return {ctx,e:elements,doc};
}
for(const destination of ['adresse','depart','stockage'])test('duplication '+destination+' : choix, mémoire, dates et source conservés',()=>{
 const {ctx,e}=setup();const source=e.get('veh-0-restit-destination');source.value=destination;source.dataset.manuelle=JSON.stringify(['Rue manuelle','75001','Paris']);
 e.get('veh-0-restit-date').value='2026-11-27';e.get('veh-0-restit-heure').value='14:30';e.get('veh-1-immat').value='AB-123-AA';
 ctx._hcCopierVehiculeVers(0,1);
 assert.equal(e.get('veh-1-restit-destination').value,destination);
 assert.equal(e.get('veh-1-restit-destination').dataset.manuelle,source.dataset.manuelle);
 const payload=ctx._lireFichesVehicules()[1];assert.equal(payload.restit_destination,destination);assert.equal(payload.restit_recuperation_client,destination==='stockage');assert.equal(payload.restit_date,'2026-11-27');assert.equal(payload.restit_heure,'14:30');assert.equal(payload.immatriculation,'AB-123-AA');
 e.get('veh-1-restit-destination').dataset.manuelle='[]';assert.notEqual(source.dataset.manuelle,'[]');
});
test('livraison Non : restitution vidée, masquée, absente du payload sans toucher autre véhicule',()=>{
 const {ctx,e,doc}=setup();for(const i of [0,1]){e.get(`veh-${i}-restit-date`).value='2026-11-27';e.get(`veh-${i}-restit-marque`).value='Retour';e.get(`veh-${i}-restit-destination`).value='stockage';}
 doc.querySelector('input[name="veh-0-liv-active"][value="non"]').checked=true;ctx.basculerLivraisonVehicule(0);
 assert.equal(e.get('veh-0-restit-date').value,'');assert.equal(e.get('veh-0-restit-marque').value,'');assert.equal(e.get('veh-restit-0').style.display,'none');assert.equal(doc.querySelector('input[name="veh-0-restit-active"]:checked'),null);
 const p=ctx._lireFichesVehicules()[0];assert.equal(p.restitution_concernee,false);assert.equal(p.restit_date,'');assert.equal(p.restit_recuperation_client,false);assert.equal(e.get('veh-1-restit-date').value,'2026-11-27');
 doc.querySelector('input[name="veh-0-liv-active"][value="oui"]').checked=true;ctx.basculerLivraisonVehicule(0);assert.equal(ctx._vehiculeARestitutionSpecifique(0),false);
});
test('payload défensif : anciennes données de restitution ignorées sans livraison',()=>{
 const {ctx,e,doc}=setup();doc.querySelector('input[name="veh-0-liv-active"][value="non"]').checked=true;e.get('veh-0-restit-date').value='2026-11-27';e.get('veh-0-restit-destination').value='stockage';
 const p=ctx._lireFichesVehicules()[0];assert.equal(p.restitution_concernee,false);assert.equal(p.restit_date,'');assert.equal(p.restit_recuperation_client,false);
});
