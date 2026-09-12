const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'creer-compte-convoyeur.html'), 'utf8');
let pass = 0;
let fail = 0;

function check(nom, condition) {
  if (condition) {
    console.log('PASS - ' + nom);
    pass++;
  } else {
    console.log('FAIL - ' + nom);
    fail++;
  }
}

check('logo HelixCar avec X dédié',
  /HELI<span class="logo-x">X<\/span>CAR/.test(source));
check('ancien badge jaune HC retiré',
  !/logo-badge|background\s*:\s*#F5C518/.test(source));
check('X affiché dans le rouge HelixCar',
  /\.logo-x\s*\{[^}]*color\s*:\s*#C8102E/i.test(source));
check('texte et bordure du message d erreur en rouge',
  /\.alert-error\s*\{[^}]*color\s*:\s*#C8102E[^}]*border[^;]*#C8102E/is.test(source));

console.log('\n=== ' + pass + ' PASS / ' + fail + ' FAIL ===');
process.exitCode = fail ? 1 : 0;
