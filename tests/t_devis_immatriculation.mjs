import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {jsPDF} from 'jspdf';
import {construirePdfServeur} from '../supabase/functions/_shared/devis-pdf.mjs';

for (const service of ['convoyage','stockage']) test(service+' : immatriculation présente pour chaque véhicule, même inconnue',()=>{
 const valeurs=[null,'','   ','QA-123-AA'];
 const dossier={id:'qa',prenom:'TEST',nom:'Immatriculation',type_service:service,nb_vehicules:4,trajet_commun:false,
  stockage_date_debut:'2026-10-01',stockage_date_fin:'2026-10-12',stockage_acheminement:'helixcar',stockage_sortie:'recuperation_client',
  _vehicules:valeurs.map((immatriculation,i)=>({id:'qa-'+i,position:i+1,immatriculation,marque_modele:'Véhicule QA '+(i+1),type_vehicule:'break',mode_transport:'route',ville_depart:'Paris',ville_arrivee:'Lyon',date_prise_en_charge:'2026-10-01',date_livraison:'2026-10-02'}))};
 const textes=[];
 function PDF(...args){const doc=new jsPDF(...args),original=doc.text;doc.text=function(t,x,y,...rest){textes.push({t:String(t),x,y,page:doc.internal.getCurrentPageInfo().pageNumber});return original.call(this,t,x,y,...rest);};return doc;}
 const doc=construirePdfServeur(PDF,dossier,{reference:'TEST-IMMATRICULATION',prix:220,date_generation:'2026-09-27T10:00:00Z'});
 const labels=textes.filter(t=>t.t==='IMMATRICULATION');assert.equal(labels.length,4);
 labels.forEach((label,i)=>{const valeur=textes.find(t=>t.page===label.page&&t.x===label.x&&Math.abs(t.y-label.y-5)<0.01);assert.equal(valeur?.t,i===3?'QA-123-AA':'—');assert.ok(valeur.y<280);});
 assert.ok(textes.some(t=>t.t.includes('220,00')));
 if(process.env.HC_PDF_RECETTE&&service==='stockage')fs.writeFileSync(process.env.HC_PDF_RECETTE,Buffer.from(doc.output('arraybuffer')));
});
