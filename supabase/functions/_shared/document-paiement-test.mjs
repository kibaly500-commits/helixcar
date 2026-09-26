import {normal,bold} from './document-fonts.mjs';
// Document de recette : aucune facture fiscale, aucune TVA inventée.
export function creerDocumentPaiementTest(jsPDF, f) {
 const doc=new jsPDF({unit:'mm',format:'a4'});
 doc.addFileToVFS('HC-Regular.ttf',normal);doc.addFont('HC-Regular.ttf','HC','normal');
 doc.addFileToVFS('HC-Bold.ttf',bold);doc.addFont('HC-Bold.ttf','HC','bold');
 doc.setCreationDate(new Date(f.cree_le));
 doc.setFileId(f.id.replaceAll('-','').toUpperCase());
 const s=f.snapshot;
 doc.setFillColor(20,24,29); doc.rect(0,0,210,43,'F');
 doc.setTextColor(255); doc.setFont('HC','bold');doc.setFontSize(24);doc.text('HELIXCAR',18,23);
 doc.setFontSize(10);doc.text('SERVICES AUTOMOBILES',18,32);
 doc.setTextColor(163,58,58);doc.setFontSize(16);doc.text('DOCUMENT DE PAIEMENT TEST',18,58);
 doc.setFontSize(10);doc.text('SANS VALEUR FISCALE - AUCUN DEBIT REEL',18,66);
 doc.setTextColor(30);doc.setFontSize(11);
 let y=80;
 const ligne=(label,value)=>{
   const lines=doc.splitTextToSize(String(value??'Non renseigne'),174);
   if(y+lines.length*5+12>270){doc.addPage();y=25;}
   doc.setFont('HC','bold');doc.text(label,18,y);y+=6;
   doc.setFont('HC','normal');doc.text(lines,18,y);y+=lines.length*5+7;
 };
 ligne('Reference du document',f.numero);
 ligne('Devis regle',s.reference);
 ligne('Client',s.nom_client);ligne('E-mail',s.email);
 ligne('Confirmation Stripe (UTC)',new Date(s.paiement_confirme_le).toISOString().replace('T',' ').slice(0,19));
 ligne('Prestation',`${s.devis?.type_service||'Convoyage'} - ${s.devis?.nombre_vehicules||1} vehicule(s)`);
 const montant=(Number(f.montant_centimes)/100).toFixed(2).replace('.',',')+' EUR';
 doc.setFillColor(241,244,242);doc.roundedRect(18,y,174,24,3,3,'F');
 doc.setFont('HC','bold');doc.setFontSize(14);doc.text('Montant paye en test',24,y+15);doc.text(montant,186,y+15,{align:'right'});
 y+=38;doc.setFontSize(10);
 ligne('Document de recette uniquement',"Ce document confirme un paiement simule dans l'environnement de test Stripe. Il ne constitue pas une facture. Les informations legales du vendeur et l'adresse de facturation du client doivent etre validees avant toute facturation reelle.");
 doc.setTextColor(100);doc.setFontSize(9);doc.text('HelixCar - Parcours de recette',18,286);
 return new Uint8Array(doc.output('arraybuffer'));
}
