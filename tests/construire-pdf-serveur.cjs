// Génère le moteur serveur depuis le générateur PDF validé du Dashboard.
// Aucun code chargé du navigateur à l'exécution serveur, aucun eval.
// --check échoue si une évolution du PDF n'a pas été reportée.
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const scope = require('eslint-scope');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const source = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map(m => m[1]).find(s => s.includes('function _construirePdfDevis'));
const parserOptions = {ecmaVersion:2022, sourceType:'module', ranges:true};
const definitions = new Map();
for (const n of acorn.parse(source, parserOptions).body) {
  if (n.type === 'FunctionDeclaration') definitions.set(n.id.name, source.slice(n.start,n.end));
  if (n.type === 'VariableDeclaration') for(const d of n.declarations) {
    if(d.id.name) definitions.set(d.id.name, n.kind+' '+source.slice(d.start,d.end)+';');
  }
}
const allowed = new Set(['window','Math','String','Number','Boolean','Date','Array','Object','undefined','Error','isNaN','parseInt','parseFloat','Intl','JSON']);
const selected = new Map(); const pending = ['_construirePdfDevis'];
while(pending.length) {
  const name=pending.pop(); if(selected.has(name)||allowed.has(name)) continue;
  const code=definitions.get(name);
  if(!code) throw new Error('Dépendance PDF non résolue : '+name);
  selected.set(name,code);
  const ast=acorn.parse(code,parserOptions);
  pending.push(...scope.analyze(ast,parserOptions).globalScope.through.map(r=>r.identifier.name));
}
const output='// GÉNÉRÉ par tests/construire-pdf-serveur.cjs. Ne pas modifier à la main.\n'
  +'// Source : moteur PDF du Dashboard ; rendu identique, données relues serveur.\n'
  +'export function construirePdfServeur(jsPDF, dossier, devis) {\n'
  +'  const window = { jspdf: { jsPDF } };\n'
  +[...selected.values()].reverse().join('\n\n')
  +'\nreturn _construirePdfDevis(dossier, devis);\n}\n';
const target=path.join(root,'supabase/functions/_shared/devis-pdf.mjs');
if(process.argv.includes('--check')) {
  if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==output) throw new Error('Moteur PDF serveur non synchronisé. Exécuter node tests/construire-pdf-serveur.cjs');
  console.log('Moteur PDF serveur conforme à la source du Dashboard.');
} else {fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,output);console.log('Moteur PDF serveur généré ('+selected.size+' définitions).');}
