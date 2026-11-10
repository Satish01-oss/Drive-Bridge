import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const data=JSON.parse(fs.readFileSync(path.join(root,'docs/project-status.json'),'utf8'));
const template=fs.readFileSync(path.join(root,'docs/checklist-template.html'),'utf8');
const html=template.replace('PROJECT_DATA_PLACEHOLDER',JSON.stringify(data).replaceAll('<','\\u003c'));
const output=process.argv[2]?path.resolve(process.argv[2]):path.join(root,'docs/DeviceBridge-Checklist.html');
fs.writeFileSync(output,html);
console.log(output);
