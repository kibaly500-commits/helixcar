// Non-régression — retours utilisateur PR6 après contrôle visuel.
const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const dashboard=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
const migration=fs.readFileSync(path.join(root,'migrations/133_vue_recapitulatifs_donnees_reelles.sql'),'utf8');
let pass=0,fail=0;
function check(label,ok){if(ok){console.log('PASS - '+label);pass++;}else{console.log('FAIL - '+label);fail++;}}

check('Logo blanc sur la barre latérale sombre',
 dashboard.includes('.sidebar .hc-logo-officiel img{filter:brightness(0) invert(1)}'));
check('Évaluer conserve une étoile dédiée',
 dashboard.includes("'⭐':'etoile'") && dashboard.includes("etoile:'<path"));
check('Fidélité conserve un cadeau dédié',
 dashboard.includes("'🎁':'cadeau'") && dashboard.includes("cadeau:'<rect"));
check('Les icônes Candidatures, Devis et Informations sont distinctes',
 dashboard.includes("'📋':'pressePapiers'") &&
 dashboard.includes("'📄':'fichier'") &&
 dashboard.includes("'📝':'edition'"));
check('Le menu client ne réutilise pas deux pictogrammes',
 dashboard.includes("icon: '⭐', label: 'Évaluer'") &&
 dashboard.includes("icon: '🎁', label: 'Fidélité'"));

check('Aucun type de véhicule n’est présélectionné',
 index.includes('Sélectionner le type</option>') &&
 index.includes("(!selection ? ' selected' : '')"));
check('Une fiche sans choix explicite du type reste incomplète',
 index.includes("var req=['type'];") &&
 index.includes("if (!el || !(el.value || '').trim()) return false;"));

check('Le bandeau intégré apparaît dès qu’un brouillon existe',
 index.includes('function _actualiserNoticeBrouillonIntegre()') &&
 index.includes('if (_hcModeIntegre()) _actualiserNoticeBrouillonIntegre();'));
check('Le bandeau ne peut pas être ajouté deux fois',
 index.includes("if (document.getElementById('notice-brouillon-restaure')) return;"));
check('Le Dashboard redemande le bandeau lors du retour au formulaire',
 dashboard.includes('cadre.contentWindow._hcAfficherBrouillonIntegre()'));
check('Les deux actions de brouillon restent visibles',
 index.includes("btnReprendre.textContent = 'Reprendre'") &&
 index.includes("btnRecommencer.textContent = 'Supprimer et recommencer'"));

check('La vue expose les vraies données nettoyage et professionnel',
 migration.includes('c.nettoyage_details') &&
 migration.includes('c.professionnel_details'));
check('La vue exclut les notes internes et les prix',
 !migration.includes('c.notes') &&
 !/\bc\.prix\b/.test(migration));
check('La vue reste limitée au compte connecté',
 migration.includes('where c.auth_user_id = auth.uid()'));

console.log('\n=== '+pass+' PASS / '+fail+' FAIL ===');
if(fail)process.exit(1);
