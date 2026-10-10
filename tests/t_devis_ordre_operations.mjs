import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {jsPDF} from 'jspdf';
import {construirePdfServeur} from '../supabase/functions/_shared/devis-pdf.mjs';
const base={type_vehicule:'berline',marque_modele:'Véhicule de test',immatriculation:'AB-101-AA',mode_transport:'route',adresse_depart_rue:'1 rue de Test',code_postal_depart:'75001',ville_depart:'Paris',date_prise_en_charge:'2026-11-18',heure_prise_en_charge:'14:30',adresse_arrivee_rue:'2 rue de Test',code_postal_arrivee:'94000',ville_arrivee:'Créteil',date_livraison:'2026-11-22',heure_livraison:'14:30',restitution_concernee:true,restit_destination:'stockage',restit_recuperation_client:true,restit_adresse_rue:'Point de stockage HelixCar',restit_code_postal:'93160',restit_ville:'Noisy-le-Grand',restit_date:'2026-11-27',restit_heure:'14:30'};
function render(vehicles,service='stockage'){
 const dossier={id:'test',prenom:'TEST',nom:'Présentation',type_service:service,nb_vehicules:vehicles.length,trajet_commun:false,stockage_acheminement:'helixcar',stockage_sortie:'helixcar',stockage_date_debut:'2026-11-18',stockage_date_fin:'2026-11-22',_vehicules:vehicles};
 const before=JSON.stringify(dossier),lines=new Map();
 function PDF(...args){const doc=new jsPDF(...args),text=doc.text;doc.text=function(t,x,y,...rest){const key=doc.internal.getCurrentPageInfo().pageNumber+':'+y;lines.set(key,(lines.get(key)||'')+' '+String(t));return text.call(this,t,x,y,...rest);};return doc;}
 const doc=construirePdfServeur(PDF,dossier,{reference:'TEST-PRESENTATION',prix:500,date_generation:'2026-10-10T12:00:00Z'});
 assert.equal(JSON.stringify(dossier),before);return {doc,text:[...lines.values()].join('\n').replace(/ +/g,' ')};
}
test('ordre prise en charge, stockage, livraison dans chaque carte',()=>{
 const {text}=render([{...base,position:1},{...base,position:2}]);
 const cards=text.split(/VÉHICULE \d+/).slice(1);
 assert.equal(cards.length,2);
 for(const card of cards){assert(card.indexOf('Prise en charge :')<card.indexOf('Stockage :'));assert(card.indexOf('Stockage :')<card.indexOf('Livraison :'));assert(card.indexOf('RESTITUTION PRÉVUE')>card.indexOf('Livraison :'));assert.match(card,/Stockage du véhicule récupéré : 22\/11\/2026 au 27\/11\/2026 \(5 jours\)/);}
});
for(const [name,changes] of Object.entries({deuxJours:{restit_date:'2026-11-24'},autreAdresse:{restit_destination:'adresse'},depart:{restit_destination:'depart'},sansRetour:{restitution_concernee:false}}))test(name+' : aucune ligne de stockage du véhicule récupéré',()=>{assert(!render([{...base,...changes}]).text.includes('Stockage du véhicule récupéré'));});
test('récupération client sans livraison conserve son ordre',()=>{const {text}=render([{...base,date_livraison:null,restitution_concernee:false,heure_recuperation_client:'14:30'},{...base,position:2}]);const card=text.split(/VÉHICULE \d+/)[1];assert(!card.includes('Livraison :'));assert(card.indexOf('Stockage :')<card.indexOf('Récupération du véhicule par le client'));});
if(process.env.PDF_PROOF){
 const vehicles=[{...base,position:1,date_livraison:null,restitution_concernee:false,heure_recuperation_client:'14:30'}, {...base,position:2,restitution_concernee:false}, {...base,position:3,restit_destination:'depart',restit_recuperation_client:false,restit_date:'2026-11-23'}, {...base,position:4,restit_destination:'adresse',restit_recuperation_client:false,restit_date:'2026-11-24'}, {...base,position:5}];
 const {doc}=render(vehicles);fs.writeFileSync(process.env.PDF_PROOF,Buffer.from(doc.output('arraybuffer')));
}
