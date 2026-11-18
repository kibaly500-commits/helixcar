const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('assets/synchronisation-espaces.js','utf8');
const wrapper=source.slice(source.indexOf('  var originalFetch ='),source.indexOf('  window.HCSync ='));
async function scenario(status,body,{success=true,editing=false}={}){
 const dirty=new Set(['convoyeur-facturation']),requests=[];
 const ctx={dirty,revision:1,SUPABASE_URL:'https://example.test',page:()=> 'convoyeur-facturation',request:n=>requests.push(n),window:{fetch:async()=>{if(editing)ctx.revision++;return new Response(status===204?null:body,{status:success?status:400});}}};
 vm.runInNewContext(wrapper,ctx);
 await ctx.window.fetch('https://example.test/rest/v1/factures_convoyeur',{method:'POST'});
 await new Promise(resolve=>setTimeout(resolve,30));
 return {dirty:dirty.size,requests:requests.length};
}
(async()=>{
 for(const [status,body] of [[201,''],[204,null],[200,'{}'],[200,'null']])assert.deepEqual(await scenario(status,body),{dirty:0,requests:1},'sauvegarde réussie '+status);
 for(const body of ['false','0','[]','{"ok":false}','{"error":"refus"}'])assert.deepEqual(await scenario(200,body),{dirty:1,requests:0},'échec métier protège la saisie');
 assert.deepEqual(await scenario(201,'',{editing:true}),{dirty:1,requests:1},'nouvelle saisie pendant la sauvegarde conservée');
 assert.deepEqual(await scenario(200,'{}',{success:false}),{dirty:1,requests:0},'échec HTTP conserve la saisie');
 console.log('PASS réponses vides 201/204, succès JSON, échec métier/HTTP et saisie concurrente');
})().catch(e=>{console.error(e);process.exitCode=1;});
