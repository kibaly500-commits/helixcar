import {creerDocumentPaiementTest} from './document-paiement-test.mjs';
import {PREVIEW} from './stripe-payment.mjs';
const bucket='factures-client-test';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const base64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
async function checked(p){const r=await p;if(r.error)throw new Error('PERSISTENCE_FAILED');return r.data;}
export async function suitePaiementTest(devisId,{sb,jsPDF,env,fetchFn=fetch,now=()=>Date.now()}){
 let f=await checked(sb.rpc('preparer_suite_paiement_test',{p_devis_id:devisId}));
 const path=f.id+'/document.pdf';
 let bytes;
 const download=await sb.storage.from(bucket).download(path);
 if(!download.error&&download.data) bytes=new Uint8Array(await download.data.arrayBuffer());
 else {
   bytes=creerDocumentPaiementTest(jsPDF,f);
   const upload=await sb.storage.from(bucket).upload(path,bytes,{contentType:'application/pdf',upsert:false});
   if(upload.error){ // autre worker ou reprise après upload : toujours relire le fichier canonique
     const blob=await checked(sb.storage.from(bucket).download(path));
     bytes=new Uint8Array(await blob.arrayBuffer());
   }
 }
 if(!f.pdf_path) await checked(sb.from('documents_paiement_test').update({pdf_path:path}).eq('id',f.id));
 if(!env.RESEND_API_KEY||!env.RESEND_FROM) throw new Error('EMAIL_CONFIGURATION_MISSING');
 const link=PREVIEW+'/devis.html?id='+encodeURIComponent(f.devis_id);
 const pending=f.informations_attendues.filter(i=>['attendue','a_corriger'].includes(i.statut));
 const needed=pending.length?'<h2>Informations à compléter</h2><ul>'+pending.map(i=>'<li>'+esc(i.libelle)+(i.commentaire?' : '+esc(i.commentaire):'')+'</li>').join('')+'</ul><p>Complétez ces informations dans votre espace client. La mission reste en brouillon jusqu’à validation.</p>':'<p>Votre dossier sera contrôlé par HelixCar avant publication de la mission.</p>';
 const clientPayload={from:env.RESEND_FROM,to:[f.snapshot.email],subject:'[TEST] Votre paiement a bien été accepté — '+f.snapshot.reference,
 html:'<h1>Votre paiement de test a bien été accepté</h1><p>Devis '+esc(f.snapshot.reference)+' — '+(f.montant_centimes/100).toFixed(2)+' €.</p><p>Aucun débit réel. Le document joint est sans valeur fiscale.</p>'+needed+'<p><a href="'+esc(link)+'">Consulter mon devis et mon document</a></p><p><a href="'+PREVIEW+'/dashboard.html">Compléter mes informations</a></p>',
 attachments:[{filename:f.numero+'.pdf',content:base64(bytes)}]};
 const adminPayload={from:env.RESEND_FROM,to:['helixcarpro@gmail.com'],subject:'[TEST] Paiement confirmé — '+f.snapshot.reference,
 html:'<h1>Paiement Stripe de test confirmé</h1><p>'+esc(f.snapshot.reference)+' : '+(f.montant_centimes/100).toFixed(2)+' €.</p><p>Les missions sont en brouillon. '+pending.length+' information(s) restent à compléter. Publication soumise au contrôle du dossier et au tarif convoyeur.</p><p><a href="'+PREVIEW+'/dashboard.html">Ouvrir l’administration</a></p>'};
 for(const [prefix,payload] of [['email',clientPayload],['email_admin',adminPayload]]){
   if(f[prefix+'_id'])continue;
   // Le corps est figé avant l'appel : même clé = exactement la même requête.
   if(!f[prefix+'_premier_essai']){
     await checked(sb.from('documents_paiement_test').update({[prefix+'_payload']:payload,[prefix+'_premier_essai']:new Date(now()).toISOString()}).eq('id',f.id).is(prefix+'_premier_essai',null));
   }
   f=await checked(sb.from('documents_paiement_test').select('*').eq('id',f.id).single());
   if(f[prefix+'_id'])continue;
   // Resend déduplique 24h. Après 23h, rapprochement manuel obligatoire.
   if(now()-Date.parse(f[prefix+'_premier_essai'])>=23*3600000)throw new Error('EMAIL_RECONCILIATION_REQUIRED');
   const response=await fetchFn('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'helixcar-test/'+f.id+'/'+prefix},body:JSON.stringify(f[prefix+'_payload'])});
   const result=await response.json();
   if(!response.ok||!result.id)throw new Error('EMAIL_RETRY_REQUIRED');
   await checked(sb.from('documents_paiement_test').update({[prefix+'_id']:result.id}).eq('id',f.id));
 }
 return {ok:true,numero:f.numero};
}
