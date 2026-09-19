const {lancerNavigateur,urlFichier}=require('./env.js');const assert=require('node:assert/strict');
(async()=>{const browser=await lancerNavigateur();try{
for(const width of [320,390,640,1280]){
const page=await browser.newPage({viewport:{width,height:1000}});
await page.addInitScript(()=>{
 const snapshot={prix:1200,client:{nom_complet:'TEST-QA PARCOURS-FINAL-01'},vehicules:[1,2].map(position=>({position,marque_modele:'Peugeot 308 — TEST QA',trajet:{adresse_depart_rue:'12 rue de la Paix',code_postal_depart:'75002',ville_depart:'Paris',adresse_arrivee_rue:'8 avenue Berthelot',code_postal_arrivee:'69007',ville_arrivee:'Lyon',date_prise_en_charge:'2026-09-23',horaire_prise_en_charge:'14h30',date_livraison:'2026-09-25',horaire_livraison:'14h30',mode_transport:'route'},restitution:{adresse:'12 rue de la Paix, 75002 Paris',date:'2026-09-26',horaire:'14h30'}}))};
 window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{access_token:'test'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}})};
 window.fetch=async()=>Response.json({ok:true,devis:{id:'11111111-1111-4111-8111-111111111111',reference:'DEV-2026-0081',statut:'envoye',snapshot,pdf_disponible:true,pdf_url:'https://zsetmqnmmupqbkgqbjbo.supabase.co/storage/v1/object/sign/devis/test.pdf'}});
});
await page.goto(urlFichier('devis.html')+'?id=11111111-1111-4111-8111-111111111111');await page.waitForSelector('#bouton-refuser-devis');
assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
if(width<=640){assert.ok(await page.locator('.resume-mobile').isVisible());assert.ok(await page.locator('.pdf-cadre').isHidden());assert.equal(await page.locator('.resume-vehicule').count(),2);}
const colors=await page.locator('#bouton-refuser-devis').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el).color}));assert.equal(colors.bg,'rgb(163, 58, 58)');assert.equal(colors.fg,'rgb(255, 255, 255)');
if(width===390)await page.screenshot({path:'/tmp/helixcar-devis-premium.png',fullPage:true});
console.log('PASS mobile/premium '+width);await page.close();
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
