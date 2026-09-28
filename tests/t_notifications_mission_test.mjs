import test from 'node:test';import assert from 'node:assert/strict';
import {messageAttribution,envoyerNotificationsMissionTest} from '../supabase/functions/_shared/notifications-mission-test.mjs';
const n={id:'test-notification',mission_id:'test-mission',role_destinataire:'convoyeur',destinataire:'kibaly500+qa-final01@gmail.com',snapshot:{convoyeur_nom:'TEST <QA>',mission:{reference:'TEST-M-1',ville_depart:'Paris',ville_arrivee:'Lyon',remuneration_prevue:300,adresse_depart:'12 rue QA',contact_depart_tel:'0600000000',consignes:'<script>interdit</script>',restitution:true,adresse_restitution:'Retour QA'}}};
test('instructions uniquement dans la confirmation convoyeur, contenu échappé',()=>{
 const p=messageAttribution(n,'test@example.test');assert.match(p.html,/12 rue QA/);assert.match(p.html,/300.00/);assert.match(p.html,/&lt;script&gt;/);assert.doesNotMatch(p.html,/<script>/);
 const client=messageAttribution({...n,role_destinataire:'client'},'test@example.test');assert.doesNotMatch(client.html,/300.00|12 rue QA|0600000000/);assert.match(client.html,/TEST &lt;QA&gt;/);
});
test('notification déjà acceptée : aucun envoi supplémentaire',async()=>{
 const sb={from:()=>({select:()=>({eq:async()=>({data:[{...n,fournisseur_id:'deja-envoye'}]})})})};
 await envoyerNotificationsMissionTest(n.mission_id,{sb,env:{RESEND_API_KEY:'fake',RESEND_FROM:'fake'},fetchFn:()=>{throw Error('ENVOI_INATTENDU');}});
});
test('aucun envoi vers un partenaire extérieur au scénario',async()=>{
 const sb={from:()=>({select:()=>({eq:async()=>({data:[{...n,destinataire:'tiers@example.test'}]})})})};
 await assert.rejects(envoyerNotificationsMissionTest(n.mission_id,{sb,env:{RESEND_API_KEY:'fake',RESEND_FROM:'fake'},fetchFn:()=>{throw Error('ENVOI_INATTENDU');}}),/DESTINATAIRE_HORS_RECETTE/);
});
