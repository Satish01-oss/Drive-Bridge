import fs from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function buildImprovements({output='frontend/site/improvements.html',offline}={}){
const data=JSON.parse(fs.readFileSync('docs/improvements-status.json','utf8'));
const ids=new Set();
for(const item of data.items){
 if(ids.has(item.id))throw Error('Duplicate improvement: '+item.id);ids.add(item.id);
 for(const key of ['id','group','title','plan','acceptance','evidence'])if(typeof item[key]!=='string'||!item[key].trim())throw Error('Missing '+key);
 if(!['planned','in_progress','done','blocked','deferred'].includes(item.status))throw Error('Invalid status');
 if(item.status==='done'&&item.evidence==='Not implemented or verified yet.')throw Error('Completion requires evidence');
}
const template=fs.readFileSync('docs/improvements-template.html','utf8');
if(!template.includes('PROJECT_DATA_PLACEHOLDER'))throw Error('Missing data placeholder');
const html=template.replace('PROJECT_DATA_PLACEHOLDER',JSON.stringify(data).replaceAll('<','\\u003c'));
for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g))if(!match[1].includes('application/json'))new vm.Script(match[2]);
fs.writeFileSync(output,html);
if(offline)fs.writeFileSync(offline,html);
console.log(JSON.stringify({tasks:data.items.length,verified:data.items.filter(t=>t.status==='done').length,output}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))buildImprovements({offline:process.argv[2]});
