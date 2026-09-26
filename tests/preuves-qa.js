// Captures facultatives de l'application locale avec fixtures explicites.
// Jamais une preuve de données réelles ni de recette de production.
const fs=require('fs');
const path=require('path');
module.exports=async function capturerQA(page,nom,selecteur){
  if(process.env.HC_CAPTURES_QA!=='1')return;
  if(!/^[a-z0-9-]+$/.test(nom))throw new Error('Nom de capture invalide');
  const dossier=path.join(__dirname,'preuves','reprise-codex');
  fs.mkdirSync(dossier,{recursive:true});
  const cible=page.locator(selecteur);
  if(!(await cible.isVisible()))throw new Error('Capture refusée : composant invisible '+selecteur);
  const dimensions=await cible.boundingBox();
  const options={path:path.join(dossier,nom+'.png'),animations:'disabled'};
  // Une modale défilante peut dépasser la fenêtre. Capturer sa bounding
  // box entière inclurait alors la page située derrière, hors du clip.
  if(dimensions&&dimensions.height>page.viewportSize().height)await page.screenshot(options);
  else await cible.screenshot(options);
};
