const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('dashboard.html','utf8');
const a=source.indexOf('function missionSurPlace('),b=source.indexOf('\nfunction loadMissions()',a);
let timer;const c={Intl,Date,Map,Set,document:{querySelectorAll:()=>[]},setInterval:fn=>timer=fn,escapeHtml:s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),_dvDate:s=>s};vm.createContext(c);vm.runInContext(source.slice(a,b),c);
let n=0;function check(name,ok){assert.ok(ok,name);console.log('PASS '+name);n++}
const m={id:'m',convoyeur_id:'p',type_mission:'professionnel',statut:'acceptee',date_intervention:'2026-11-20',date_fin_intervention:'2026-11-30',heure_debut_intervention:'08:30',heure_fin_intervention:'17:30',ville_intervention:'Paris',consignes:'Consignes privées <script>',prestation:'Diagnostic',remuneration_prevue:300};
for(const [time,key] of [['2026-11-20T07:29Z','a_venir'],['2026-11-20T07:30Z','en_cours'],['2026-11-20T20:00Z','en_cours'],['2026-11-30T08:00Z','en_cours'],['2026-11-30T16:29Z','en_cours'],['2026-11-30T16:30Z','a_confirmer'],['2026-12-01T08:00Z','a_confirmer']])check(time,c.statutIntervention(m,new Date(time)).cle===key);
check('Heure été Paris',c.statutIntervention({...m,date_intervention:'2026-07-20',date_fin_intervention:'2026-07-20'},new Date('2026-07-20T15:30Z')).cle==='a_confirmer');
check('Créneau historique texte',c.statutIntervention({...m,heure_debut_intervention:null,heure_fin_intervention:null,heure_intervention:'08:30 - 17:30'},new Date('2026-11-30T16:30Z')).cle==='a_confirmer');
check('Pas de date : à planifier',c.statutIntervention({...m,date_intervention:null}).cle==='a_planifier');
check('Mission annulée conservée',c.statutIntervention({...m,statut:'annulee'}).cle==='annulee');
check('Mission confirmée conservée',c.statutIntervention({...m,statut:'terminee'}).cle==='terminee');
check('Aucune affectation : à attribuer',c.statutIntervention({...m,convoyeur_id:null}).texte==='À attribuer');
check('Aucun bouton professionnel',c.actionsIntervention(m)==='');
const html=c.ligneIntervention(m,false,'');check('Consignes derrière détails fermés',html.includes('<details>')&&!html.includes('<details open')&&html.includes('Voir les détails'));check('Échappement conservé',html.includes('&lt;script&gt;')&&!html.includes('<script>'));
check('Sans colonnes transport',!/Livraison|Prise en charge|Restitution|Lettre de voiture/.test(html));
check('Admin confirme mission attribuée',source.includes("actionHtml('confirmerMissionTerminee',[m.id])+'>Confirmer la réalisation"));
check('Rubriques distinctes',source.includes('Missions de convoyage')&&source.includes('Autres missions'));
console.log(n+' PASS / 0 FAIL');
