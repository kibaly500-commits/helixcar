// Civilité partenaire : saisie, persistance et accords du dashboard.
const L = require('./lib.js');
const fs = require('fs');

(async () => {
  const index = fs.readFileSync(L.fichier('index.html'), 'utf8');
  const dashboard = fs.readFileSync(L.fichier('dashboard.html'), 'utf8');

  const browser = await L.launch();
  const page = await L.newPage(browser);
  await page.evaluate(() => { openModal('convoyeur'); });
  await page.waitForTimeout(100);

  const champ = await page.evaluate(() => {
    const e = document.getElementById('conv-civilite');
    return {
      avantEmail: !!e && !!document.getElementById('conv-email')
        && !!(e.compareDocumentPosition(document.getElementById('conv-email')) & Node.DOCUMENT_POSITION_FOLLOWING),
      valeurs: e ? Array.from(e.options).map(o => o.value) : [],
      obligatoire: !!e && /\*/.test((document.querySelector('label[for="conv-civilite"]') || {}).textContent || '')
    };
  });
  L.check('A1 : la civilité est proposée au-dessus de l’email', champ.avantEmail, JSON.stringify(champ));
  L.check('A2 : les trois choix demandés sont les seuls choix actifs',
    champ.valeurs.join(',') === ',madame,monsieur,non_precise', champ.valeurs.join(','));
  L.check('A3 : la civilité est obligatoire pour une nouvelle candidature', champ.obligatoire);
  L.check('A4 : la valeur choisie est envoyée avec la candidature',
    /civilite\s*:\s*civilite/.test(index));

  await browser.close();

  const browserDash = await L.launch();
  const dash = await L.newPage(browserDash);
  await dash.goto(L.urlFichier('dashboard.html'), { waitUntil: 'load' });
  const accords = await dash.evaluate(() => {
    const femme = { civilite: 'madame' };
    const homme = { civilite: 'monsieur' };
    const neutre = { civilite: 'non_precise' };
    const ancien = {};
    _appliquerCiviliteEspacePartenaire(femme);
    return {
      femme: [_accordPartenaire(femme, 'Convoyeur', 'Convoyeuse'), _libEtatCandidature('retenu', femme)],
      homme: [_accordPartenaire(homme, 'Convoyeur', 'Convoyeuse'), _libEtatCandidature('retenu', homme)],
      neutre: [_accordPartenaire(neutre, 'Convoyeur', 'Convoyeuse'), _libEtatCandidature('retenu', neutre)],
      ancien: [_accordPartenaire(ancien, 'Convoyeur', 'Convoyeuse'), _libEtatCandidature('retenu', ancien)],
      badgeFemme: _badgeEtatPartenaire({ civilite: 'madame', bloque: true }),
      role: document.getElementById('sb-role').textContent,
      profil: document.getElementById('profil-partenaire-titre').textContent
    };
  });
  L.check('B1 : Madame déclenche les accords féminins',
    accords.femme.join('|') === 'Convoyeuse|Retenue', JSON.stringify(accords.femme));
  L.check('B2 : Monsieur conserve les accords masculins',
    accords.homme.join('|') === 'Convoyeur|Retenu', JSON.stringify(accords.homme));
  L.check('B3 : « Je préfère ne pas préciser » conserve le masculin',
    accords.neutre.join('|') === 'Convoyeur|Retenu', JSON.stringify(accords.neutre));
  L.check('B4 : les anciennes candidatures sans civilité conservent le masculin',
    accords.ancien.join('|') === 'Convoyeur|Retenu', JSON.stringify(accords.ancien));
  L.check('B5 : les badges et l’espace personnel suivent aussi le féminin',
    /Bloquée/.test(accords.badgeFemme) && accords.role === 'Convoyeuse' && accords.profil === 'Mon profil convoyeuse',
    JSON.stringify(accords));
  L.check('B6 : le dashboard récupère la civilité dans les candidatures d’opportunité',
    /select=id,prenom,nom,civilite,activites,statut,bloque/.test(dashboard));
  L.check('B7 : la validation transmet la civilité au traitement et à l’email',
    /validerConvoyeur[^\n]+c\.civilite/.test(dashboard)
      && /function validerConvoyeur\(id, name, email, civilite\)/.test(dashboard));

  await browserDash.close();
  process.exit(L.results() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
