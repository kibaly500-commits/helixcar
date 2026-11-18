const L = require('./lib');
(async () => {
  const browser = await L.launch();
  try {
    for (const width of [375, 390, 720, 1280]) {
      const page = await L.newPage(browser);
      await page.setViewportSize({width, height:844});
      await L.fillStep1(page, 'particulier');
      await L.chooseService(page, 'convoyage');
      const r = await page.evaluate(() => {
        document.getElementById('nb-vehicules').value='2';rendreFichesVehicules();
        const pc=document.getElementById('veh-0-pc-date'), liv=document.getElementById('veh-0-liv-date');
        pc.value='2027-10-08';liv.value='';
        _hcOuvrirCalendrier(liv);
        const forbidden=document.querySelector('#hc-cal-grille [data-jour="7"]');
        const disabled=forbidden.disabled;
        forbidden.dispatchEvent(new MouseEvent('click',{bubbles:true}));
        const clickBlocked=liv.value==='';
        _hcSelectionnerJour(7);
        const handlerBlocked=liv.value==='';
        // A changed dependency must be checked even before the grid rerenders.
        pc.value='2027-10-10';_hcSelectionnerJour(9);
        const staleBlocked=liv.value==='';
        _hcSelectionnerJour(10);
        const sameDay=liv.value==='2027-10-10';
        const question=document.getElementById('veh-restit-question-0');
        const clearQuestion=question.textContent.includes('un autre véhicule')&&question.textContent.includes('Non, uniquement la livraison');
        document.querySelector('[name="veh-0-restit-active"][value="oui"]').click();
        const yesShows=document.getElementById('veh-restit-0').style.display!=='none';
        document.querySelector('[name="veh-0-restit-active"][value="non"]').click();
        const noHides=document.getElementById('veh-restit-0').style.display==='none';
        const font=parseFloat(getComputedStyle(document.getElementById('client-email')).fontSize);
        return {disabled,clickBlocked,handlerBlocked,staleBlocked,sameDay,clearQuestion,yesShows,noHides,font};
      });
      for(const [key,val] of Object.entries(r)) if(key!=='font')L.check(width+'px '+key,val);
      if(width<=720)L.check(width+'px saisie sans zoom automatique',r.font>=16,r.font);
      const periods=await page.evaluate(()=>{
        document.getElementById('stock-debut').value='2027-10-08';
        document.getElementById('stock-fin').value='';
        _hcOuvrirCalendrier(document.getElementById('stock-fin'));
        _hcSelectionnerJour(7);const blocked=!document.getElementById('stock-fin').value;
        _hcSelectionnerJour(8);const allowed=document.getElementById('stock-fin').value==='2027-10-08';
        _hcFermerCalendrier();return {blocked,allowed};
      });
      L.check(width+'px période de stockage : fin antérieure bloquée',periods.blocked);
      L.check(width+'px période de stockage : même jour autorisé',periods.allowed);
      await page.waitForTimeout(300);
      await page.evaluate(()=>{
        window.__mutations=0;window.__observer=new MutationObserver(ms=>window.__mutations+=ms.length);
        __observer.observe(document.getElementById('modal-client'),{childList:true,subtree:true,attributes:true});
      });
      await page.waitForTimeout(300);
      const mutations=await page.evaluate(()=>{__observer.disconnect();return __mutations;});
      L.check(width+'px formulaire au repos sans boucle de mutations',mutations===0,mutations);
      await page.close();
    }
  } finally {await browser.close();}
  process.exitCode=L.results()?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
