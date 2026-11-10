import {cp,mkdir,rm,realpath} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {buildImprovements} from '../scripts/build-improvements.mjs';
import {syncRelease} from '../scripts/sync-github-release.mjs';
import {syncAndroidUpdate} from '../scripts/sync-android-update.mjs';

const frontend=dirname(fileURLToPath(import.meta.url)),repo=resolve(frontend,'..'),output=join(frontend,'dist');
process.chdir(repo);
if(dirname(output)!==frontend||output!==join(repo,'frontend','dist'))throw Error('Invalid generated frontend directory');
try{if(await realpath(output)!==output)throw Error('Refusing to replace a linked output directory');}catch(error){if(error.code!=='ENOENT')throw error;}
await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});
await cp(join(frontend,'site'),output,{recursive:true});
buildImprovements({output:join(output,'improvements.html')});
await syncRelease({root:output});
await syncAndroidUpdate({directory:output});
execFileSync(process.execPath,[join(repo,'scripts','verify-site.mjs'),output],{stdio:'inherit'});
execFileSync(process.execPath,['--check',join(output,'app.js')],{stdio:'inherit'});
console.log('Frontend ready: frontend/dist. Static website only; connection backend remains on Render.');
