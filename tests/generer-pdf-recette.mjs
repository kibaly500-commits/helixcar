// PDFs réels issus du moteur commun, données locales identifiables.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import * as acorn from 'acorn';
import {jsPDF} from 'jspdf';
import {construirePdfServeur} from '../supabase/functions/_shared/devis-pdf.mjs';
const source=fs.readFileSync('tests/t_devis_commun.js','utf8');
const ast=acorn.parse(source,{ecmaVersion:'latest'});
const declaration=ast.body.find(n=>n.type==='VariableDeclaration'&&n.declarations[0].id.name==='DEMANDES').declarations[0].init;
const demandes=vm.runInNewContext('('+source.slice(declaration.start,declaration.end)+')');
const mission='Diagnostic électronique complet de plusieurs véhicules présentant des défauts intermittents, contrôle des calculateurs, vérification des systèmes d’aide à la conduite';
const type='Gestion administrative temporaire de dossiers clients, contrôle des documents, mise à jour des statuts de préparation et coordination des entrées et sorties';
if([...mission].length!==166||[...type].length!==156)throw Error('Références C01 invalides');
demandes.professionnel.professionnel_details.description=mission;
demandes.renfort=JSON.parse(JSON.stringify(demandes.professionnel));
Object.assign(demandes.renfort.professionnel_details,{categorie:'renfort',mission:'autre',mission_autre:'TEST-QA-CLAUDE-HELIXCAR',description:type});
Object.assign(demandes.nettoyage.nettoyage_details,{date_fin:'2026-11-04',creneau_debut:'08:00',creneau_fin:'17:30',type_nettoyage:'preparation_complete'});
const sortie=process.argv[2]||'tests/preuves/finalisation/pdf';fs.mkdirSync(sortie,{recursive:true});
let numero=0;
for(const [service,c] of Object.entries(demandes)){
 Object.assign(c,{prenom:'TEST-QA-CLAUDE-HELIXCAR',nom:service,email:'test-qa-claude-helixcar@example.invalid',telephone:'',adresse_rue:'Lieu de recette autorisé',adresse_cp:'75000',adresse_ville:'Paris'});
 for(const champ of ['professionnel_details','nettoyage_details'])if(c[champ]){c[champ].informations_complementaires='TEST-QA-CLAUDE-HELIXCAR — accès au site à confirmer.';c[champ].contact_sur_place={type:'autre',nom:'TEST-QA-CLAUDE-HELIXCAR',telephone:''};}
 if(['convoyage','stockage'].includes(service))c._vehicules=Array.from({length:service==='stockage'?5:1},(_,i)=>({id:'TEST-QA-CLAUDE-HELIXCAR-'+i,ordre:i+1,immatriculation:'TEST-QA-'+(i+1),marque_modele:'Véhicule de recette '+(i+1),type_vehicule:'berline',mode_transport:i%2?'plateau':'route',ville_depart:'Paris',ville_arrivee:'Lyon',date_prise_en_charge:'2026-11-01',heure_prise_en_charge:'09:00',date_livraison:'2026-11-02',heure_livraison:'17:00'}));
 const d={reference:'TEST-QA-CLAUDE-HELIXCAR-'+(++numero),client_id:c.id,prix:480,statut:'genere',date_generation:'2026-09-10T10:00:00Z'};
 const doc=construirePdfServeur(jsPDF,c,d);const fichier=path.join(sortie,'TEST-QA-CLAUDE-HELIXCAR-'+service+'.pdf');fs.writeFileSync(fichier,Buffer.from(doc.output('arraybuffer')));console.log(service+': '+doc.getNumberOfPages()+' page(s)');
}
