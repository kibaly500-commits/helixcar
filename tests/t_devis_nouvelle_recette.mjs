// Deux nouvelles demandes isolées : vrai serveur PDF, base et e-mails simulés.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {creerDouble,etatDeBase,appeler,ID_DEVIS,ID_CLIENT,pdfFictif} from './t_devis_securite.mjs';
const dir='/tmp/helixcar-recette-pdf';fs.mkdirSync(dir,{recursive:true});
const base={dossier_id:ID_CLIENT,type_vehicule:'berline',marque_modele:'TEST véhicule',immatriculation:'AB-901-AA',mode_transport:'standard',adresse_depart_rue:'1 rue de Test',code_postal_depart:'75001',ville_depart:'Paris',date_prise_en_charge:'2027-01-04',heure_prise_en_charge:'09:00',adresse_arrivee_rue:'2 rue de Test',code_postal_arrivee:'94000',ville_arrivee:'Créteil',date_livraison:'2027-01-08',heure_livraison:'11:00',restitution_concernee:true,restit_destination:'stockage',restit_recuperation_client:true,restit_adresse_rue:'Point de stockage HelixCar',restit_code_postal:'93160',restit_ville:'Noisy-le-Grand',restit_date:'2027-01-13',restit_heure:'16:00',restit_type_vehicule:'citadine',restit_marque_modele:'TEST véhicule repris'};
let checks=0;function ok(value,label){assert.ok(value,label);checks++;console.log('PASS '+label);}
for(const service of ['stockage','convoyage']){
 const e=etatDeBase();Object.assign(e.tables.clients[0],{type_service:service,trajet_commun:false,stockage_acheminement:'helixcar',stockage_sortie:'helixcar',...(service==='stockage'?{stockage_date_debut:'2027-01-04',stockage_date_fin:'2027-01-08'}:{})});
 const vs=service==='stockage'?[
 {...base,date_livraison:null,restitution_concernee:false,heure_recuperation_client:'16:00'},
 {...base,restitution_concernee:false},
 {...base,restit_destination:'depart',restit_recuperation_client:false,restit_adresse_rue:'1 rue de Test',restit_ville:'Paris',restit_date:'2027-01-12'},
 {...base,restit_destination:'adresse',restit_recuperation_client:false,restit_adresse_rue:'3 rue de Test',restit_ville:'Versailles'},
 {...base}
 ]:[
 {...base,date_livraison:'2027-01-05',restitution_concernee:false},
 {...base,restit_destination:'depart',restit_recuperation_client:false,restit_ville:'Paris'},
 {...base,date_livraison:'2027-01-05',restit_date:'2027-01-07'}
 ];
 e.tables.vehicules=vs.map((v,i)=>({...v,id:'test-'+i,position:i+1,marque_modele:'TEST '+service+' '+(i+1)}));e.tables.clients[0].nb_vehicules=vs.length;
 const d=creerDouble(e);const before=JSON.stringify(e.tables.vehicules);
 const p=await appeler(d,{action:'prepare',devis_id:ID_DEVIS,envoi_cle:service,pdf_base64:pdfFictif()},{jwt:'jwt-admin'});
 ok(p.statut===200,service+' nouvelle préparation serveur');
 const path=e.tables.devis[0].pdf_path;const bytes=d.journal.pdfs[path];
 ok(bytes.length>10000,service+' ancien PDF navigateur ignoré');
 fs.writeFileSync(dir+'/'+service+'.pdf',bytes);
 const text=execFileSync('pdftotext',['-layout',dir+'/'+service+'.pdf','-'],{encoding:'utf8'}).replace(/\s+/g,' ');
 const cards=text.split(/VÉHICULE \d+/).slice(1);ok(cards.length===vs.length,service+' nombre exact de véhicules');
 for(let i=0;i<cards.length;i++){
 const c=cards[i],v=vs[i];
 if(service==='stockage'||i===1){ok(c.indexOf('Prise en charge :')>=0&&c.indexOf('Stockage :')>c.indexOf('Prise en charge :'),service+' V'+(i+1)+' stockage après prise en charge');if(v.date_livraison)ok(c.indexOf('Livraison :')>c.indexOf('Stockage :'),service+' V'+(i+1)+' stockage avant livraison');}
 if(service==='stockage'&&i===4)ok(c.includes('Stockage du véhicule récupéré : 08/01/2027 au 13/01/2027 (5 jours)'),service+' 5 jours de restitution Noisy');
 else ok(!c.includes('Stockage du véhicule récupéré'),service+' V'+(i+1)+' aucun faux stockage de restitution');
 if(service==='convoyage'&&i!==1)ok(!c.includes('Stockage :'),service+' V'+(i+1)+' pas de stockage sur trajet court');
 }
 const sent=await appeler(d,{action:'send_email',devis_id:ID_DEVIS,token:p.json.token,envoi_cle:service},{jwt:'jwt-admin'},{RESEND_API_KEY:'fake-local-only'});
 ok(sent.statut===200,service+' envoi simulé');
 const client=await appeler(d,{action:'get',devis_id:ID_DEVIS},{jwt:'jwt-client'});
 const admin=await appeler(d,{action:'admin_pdf',devis_id:ID_DEVIS},{jwt:'jwt-admin'});
 ok(client.statut===200&&admin.statut===200&&client.json.devis.pdf_url===admin.json.pdf_url,service+' admin et client même archive PDF');
 ok(JSON.stringify(e.tables.vehicules)===before,service+' données véhicules intactes');
 ok(e.tables.devis[0].paiement_statut==='aucun',service+' aucun paiement déclenché');
}
console.log(checks+' contrôles validés. Tests isolés : aucun dossier ni e-mail réel créé.');
