// Recette isolée : vrais formulaires et générateur PDF, Auth/RPC simulés.
const L=require('./lib'),fs=require('fs');
const {urlFichier}=require('./env');
const authSource=fs.readFileSync(__dirname+'/t_rattachement.js','utf8');
const init=new Function(authSource.slice(authSource.indexOf('function init('),authSource.indexOf('async function deposerCompteSeul'))+';return init;')();
const pdfSource=fs.readFileSync(__dirname+'/t_devis.js','utf8');
const pdfStub=pdfSource.split('const STUB = `')[1].split('`;')[0];
(async()=>{const {construirePdfServeur}=await import('../supabase/functions/_shared/devis-pdf.mjs');const {jsPDF}=require('jspdf');const browser=await L.launch();try{
const dash=await browser.newPage();await dash.addInitScript(init(true,false,false)+pdfStub);await dash.goto(urlFichier('dashboard.html'));dash.on('dialog',d=>d.dismiss());
const captured=[];
const cases=[
 {name:'Particulier, convoyage mono',service:'convoyage',nb:1},
 {name:'Professionnel, 3 véhicules, remplacement du 2',service:'convoyage',nb:3,pro:true,replace:1},
 {name:'Stockage avec transport et restitution remplacée',service:'stockage',nb:2,replace:0,restitution:true},
 {name:'Créneau puis heure précise, véhicule remplacé',service:'convoyage',nb:1,replace:0,range:true},
 {name:'Restitution ajoutée puis retirée',service:'convoyage',nb:1,removeRestit:true},
 {name:'Stockage, dépôt et récupération client',service:'stockage',nb:1,self:true}
];
for(const c of cases){const p=await browser.newPage({viewport:{width:c.pro?1280:390,height:1000}});p.on('dialog',d=>d.accept());await p.addInitScript(init(true,false,false));await p.goto(L.FILE);await L.fillStep1(p,c.pro?'pro':'particulier');await L.chooseService(p,c.service);
const expected=await p.evaluate(c=>{
 const set=(id,v)=>{const e=document.getElementById(id);if(!e)return;e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
 const radio=(name,v)=>{const e=document.querySelector('input[name="'+name+'"][value="'+v+'"]');if(e)e.checked=true;};
 if(c.service==='stockage'){set('stock-debut','2027-10-07');set('stock-fin','2027-10-30');radio('stock-acheminement',c.self?'depot_client':'helixcar');radio('stock-sortie',c.self?'recuperation_client':'helixcar');onAcheminementStockage();onSortieStockage();if(c.self){set('stock-heure-entree','10:00');set('stock-heure-sortie','16:00');}}
 set('nb-vehicules',String(c.nb));onNbVehiculesChange();rendreFichesVehicules();
 function fill(i,tag){const pre='veh-'+i+'-';const v=(suffix,val)=>set(pre+suffix,val);v('type','berline');v('marque',tag+' Modele');v('immat',tag+'-123');v('vin',tag+'VIN123456789012');v('motorisation','Hybride');
 if(!c.self){radio(pre+'liv-active','oui');if(typeof basculerLivraisonVehicule==='function')basculerLivraisonVehicule(i);
 for(const [part,day,time]of [['pc','07','09:00'],['liv','30','16:00']]){v(part+'-rue',tag+' Rue '+part);v(part+'-cp','75001');v(part+'-ville',tag+' Ville '+part);v(part+'-contact',tag+' Contact '+part);v(part+'-tel','+33600000001');radio(pre+part+'-htype','precise');v(part+'-date','2027-10-'+day);v(part+'-heure',time);}
 radio(pre+'transport','route');
 if(c.restitution||c.removeRestit){radio(pre+'restit-active','oui');basculerRestitVehicule(i);v('restit-vtype','suv');v('restit-marque',tag+' Retour');v('restit-immat',tag+'-RET');v('restit-vin',tag+'RETVIN12345678');v('restit-motorisation','Diesel');v('restit-rue',tag+' Rue retour');v('restit-cp','69001');v('restit-ville',tag+' Ville retour');v('restit-contact',tag+' Contact retour');v('restit-tel','+33600000002');v('restit-date','2027-10-31');v('restit-heure','10:00');}
 }
 }
 for(let i=0;i<c.nb;i++)fill(i,c.replace===i?'ANCIEN'+i:'FINAL'+i);
 if(c.replace!==undefined){effacerVehicule(c.replace);fill(c.replace,'NOUVEAU'+c.replace);}
 if(c.range){radio('veh-0-liv-htype','creneau');basculerHoraire(0,'liv');set('veh-0-liv-cdeb','14:30');set('veh-0-liv-cfin','16:45');radio('veh-0-liv-htype','precise');basculerHoraire(0,'liv');set('veh-0-liv-heure','18:00');}
 if(c.removeRestit){radio('veh-0-restit-active','non');basculerRestitVehicule(0);}
 return _lireFichesVehicules().map(_normaliserVehiculePourEnvoi);
},c);
await p.evaluate(async()=>{await submitClientForm();});
const data=await p.evaluate(()=>({signup:window.__journal.filter(j=>j.op==='signUp'),rpc:window.__journal.filter(j=>j.op==='rpc'&&j.nom==='creer_demande_avec_vehicules'),debug:(document.getElementById('supabase-debug')||{}).textContent}));
L.check(c.name+' : inscription appelée une fois',data.signup.length===1);L.check(c.name+' : demande transmise une fois',data.rpc.length===1,data.debug);
if(data.rpc.length){const payload=data.rpc[0].params;captured.push({name:c.name,payload});const vehicles=payload.p_vehicules;L.check(c.name+' : toutes les fiches transmises',vehicles.length===c.nb);L.check(c.name+' : champs identiques à la dernière saisie',JSON.stringify(vehicles)===JSON.stringify(expected));L.check(c.name+' : identité client conservée',payload.p_demande.prenom==='TEST-QA'&&payload.p_demande.email==='test-qa@example.invalid');L.check(c.name+' : aucune ancienne donnée',!JSON.stringify(payload).includes('ANCIEN'));
if(c.replace!==undefined)L.check(c.name+' : nouveau modèle et plaque',vehicles[c.replace].marque_modele==='NOUVEAU'+c.replace+' Modele'&&vehicles[c.replace].immatriculation==='NOUVEAU'+c.replace+'-123');
L.check(c.name+' : VIN et motorisation finaux',vehicles.every((v,i)=>{const tag=c.replace===i?'NOUVEAU'+i:'FINAL'+i;return v.vin===tag+'VIN123456789012'&&v.motorisation==='Hybride';}));
if(!c.self)L.check(c.name+' : adresses, contacts, dates et heures conservés',vehicles.every((v,i)=>{const tag=c.replace===i?'NOUVEAU'+i:'FINAL'+i;return v.adresse_depart_rue===tag+' Rue pc'&&v.pc_contact_nom===tag+' Contact pc'&&v.pc_contact_tel==='+33600000001'&&v.date_prise_en_charge==='2027-10-07'&&v.heure_prise_en_charge==='09:00'&&v.adresse_arrivee_rue===tag+' Rue liv'&&v.liv_contact_nom===tag+' Contact liv'&&v.date_livraison==='2027-10-30';}));
if(c.restitution)L.check(c.name+' : restitution finale complète',vehicles.every((v,i)=>{const tag=c.replace===i?'NOUVEAU'+i:'FINAL'+i;return v.restit_marque_modele===tag+' Retour'&&v.restit_immatriculation===tag+'-RET'&&v.restit_motorisation==='Diesel'&&v.restit_date==='2027-10-31'&&v.restit_heure==='10:00';}));
if(c.range)L.check(c.name+' : ancienne plage non transmise',vehicles[0].heure_livraison==='18:00'&&!vehicles[0].liv_creneau_debut&&!vehicles[0].liv_creneau_fin);
if(c.removeRestit)L.check(c.name+' : restitution supprimée',!vehicles[0].restitution_concernee&&!vehicles[0].restit_marque_modele&&!vehicles[0].restit_date);
if(c.self)L.check(c.name+' : horaires stockage conservés',payload.p_demande.stockage_heure_entree==='10:00'&&payload.p_demande.stockage_heure_sortie==='16:00');
const pdf=await dash.evaluate(({d,v})=>{const client=Object.assign({},d,{id:'qa-demande',_vehicules:v,created_at:'2026-10-04T10:00:00Z'});_construirePdfDevis(client,{reference:'DEV-QA',client_id:client.id,prix:400,statut:'genere',date_generation:'2026-10-04T10:00:00Z'});return window.__pdfTextes.join(' | ');},{d:payload.p_demande,v:vehicles});
const serverTexts=[];function PDF(...args){const doc=new jsPDF(...args),text=doc.text;doc.text=function(t,...rest){serverTexts.push(String(t));return text.call(this,t,...rest);};return doc;}
construirePdfServeur(PDF,Object.assign({},payload.p_demande,{id:'qa-demande',_vehicules:vehicles}),{reference:'DEV-QA',prix:400,date_generation:'2026-10-04T10:00:00Z'});
const serverPdf=serverTexts.join(' | ');L.check(c.name+' : PDF serveur conserve les dernières identités',vehicles.every(v=>serverPdf.includes(v.marque_modele)&&serverPdf.includes(v.immatriculation))&&!serverPdf.includes('ANCIEN'));
L.check(c.name+' : devis sans ancienne saisie',!pdf.includes('ANCIEN'));L.check(c.name+' : devis reprend les modèles finaux',vehicles.every(v=>pdf.includes(v.marque_modele)),pdf.slice(-900));L.check(c.name+' : devis reprend les plaques finales',vehicles.every(v=>pdf.includes(v.immatriculation)));if(!c.self)L.check(c.name+' : devis reprend les dernières villes',vehicles.every(v=>pdf.includes(v.ville_depart)&&pdf.includes(v.ville_arrivee)));
}
await p.close();}
if(process.env.HC_QA_CAPTURE)fs.writeFileSync(process.env.HC_QA_CAPTURE,JSON.stringify(captured));
await dash.close();}finally{await browser.close();}process.exitCode=L.results()?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});
