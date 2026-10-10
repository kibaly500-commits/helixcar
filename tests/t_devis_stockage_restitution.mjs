import test from 'node:test';
import assert from 'node:assert/strict';
import {jsPDF} from 'jspdf';
import {construirePdfServeur} from '../supabase/functions/_shared/devis-pdf.mjs';

const vehicle={position:1,type_vehicule:'berline',marque_modele:'Test',date_prise_en_charge:'2026-11-07',date_livraison:'2026-11-08',restitution_concernee:true,restit_destination:'stockage',restit_recuperation_client:true,restit_date:'2026-11-13'};
function render(service,vehicles){
 const c={id:'test',prenom:'Test',nom:'Retour',type_service:service,nb_vehicules:vehicles.length,trajet_commun:false,stockage_date_debut:'2026-11-01',stockage_date_fin:'2026-11-08',stockage_nb_jours:7,_vehicules:vehicles};
 const before=JSON.stringify(c),texts=[];
 function PDF(...args){const doc=new jsPDF(...args),original=doc.text;doc.text=function(t,x,y,...rest){texts.push({t:String(t),x,y});return original.call(this,t,x,y,...rest);};return doc;}
 construirePdfServeur(PDF,c,{reference:'TEST',prix:220,date_generation:'2026-10-10T12:00:00Z'});
 assert.equal(JSON.stringify(c),before,'dates métier inchangées');
 assert(texts.some(v=>v.t.includes('220,00')),'prix inchangé');
 const end=texts.findIndex(v=>v.t.toLowerCase()==='fin du stockage');
 if(end<0)return null;
 return texts.slice(end+1).find(v=>v.x===texts[end].x&&/^\d{2}\/\d{2}\/\d{4}$/.test(v.t))?.t;
}
for(const service of ['stockage','convoyage_stockage','convoyage']){
 test(service+' : dernière récupération Noisy dans la période globale',()=>{
 assert.equal(render(service,[vehicle]),'13/11/2026');
 assert.equal(render(service,[vehicle,{...vehicle,position:2,restit_date:'2026-11-16'}]),'16/11/2026');
 });
}
for(const [name,change] of Object.entries({deuxJours:{restit_date:'2026-11-10'},unJour:{restit_date:'2026-11-09'},autreAdresse:{restit_destination:'adresse'},retourDepart:{restit_destination:'depart'},sansRetour:{restitution_concernee:false},sansDate:{restit_date:''},sansLivraison:{date_livraison:''},dateInversee:{restit_date:'2026-11-06'}})){
 test(name+' : pas de stockage ajouté au convoyage court',()=>assert.equal(render('convoyage',[{...vehicle,...change}]),null));
}
test('stockage existant plus long non raccourci',()=>assert.equal(render('stockage',[vehicle,{...vehicle,position:2,date_livraison:'2026-11-20',restitution_concernee:false}]),'20/11/2026'));
test('ancien convoyage long inchangé',()=>assert.equal(render('convoyage',[{...vehicle,date_prise_en_charge:'2026-11-01',restitution_concernee:false}]),'08/11/2026'));
for(const service of ['nettoyage','professionnel']){
 test(service+' : aucune période de stockage sans restitution',()=>assert.equal(render(service,[]),null));
 test(service+' : anciennes restitutions ignorées',()=>assert.equal(render(service,[vehicle,{...vehicle,position:2,restit_date:'2026-11-16'}]),null));
}
