// F01 — dates civiles inchangées quel que soit le fuseau du navigateur.
// Le rendu PDF reste testé séparément ; aucun serveur ni e-mail réel ici.
const {lancerNavigateur,urlFichier}=require('./env.js');
let pass=0,fail=0;
function check(label,ok){console.log((ok?'PASS':'FAIL')+' - '+label);ok?pass++:fail++;}
(async()=>{
  const browser=await lancerNavigateur();
  try {
    for(const timeZone of ['Europe/Paris','America/Los_Angeles','UTC','Pacific/Auckland']){
      const contexte=await browser.newContext({timezoneId:timeZone});
      const page=await contexte.newPage();
      await page.goto(urlFichier('dashboard.html'),{waitUntil:'load'});
      const resultat=await page.evaluate(()=>({
        dates:['2026-09-21','2028-02-29','2026-03-29','2026-10-25','2027-01-01'].map(_dvDate),
        ete:_dvDate('2026-07-01T22:30:00Z'),
        hiver:_dvDate('2026-01-01T23:30:00Z'),
        horaire:_dvDateHeure('2026-03-29T01:30:00Z'),
        vide:_dvDate(null),invalide:_dvDate('invalide')
      }));
      check(timeZone+' : dates civiles et bissextile sans décalage',JSON.stringify(resultat.dates)===JSON.stringify(['21/09/2026','29/02/2028','29/03/2026','25/10/2026','01/01/2027']));
      check(timeZone+' : horodatages été/hiver affichés en Europe/Paris',resultat.ete==='02/07/2026'&&resultat.hiver==='02/01/2026');
      check(timeZone+' : changement d’heure Paris explicite',resultat.horaire==='29/03/2026 à 03:30');
      check(timeZone+' : états absents/invalides conservés',resultat.vide==='—'&&resultat.invalide==='invalide');
      await contexte.close();
    }
  } finally {await browser.close();}
  console.log('=== '+pass+' PASS / '+fail+' FAIL ===');process.exitCode=fail?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
