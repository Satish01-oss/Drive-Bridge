// Only the isolated Windows workflow can upload these assets. It never publishes
// a release or replaces an existing published download.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const repository='Satish01-oss/Drive-Bridge';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.GITHUB_REPOSITORY!==repository)throw Error('This publisher runs only in the repository’s isolated GitHub workflow.');
const source=process.env.DEVICEBRIDGE_SOURCE_REF,tag=process.env.DEVICEBRIDGE_PREVIEW_TAG;
if(!/^[a-f0-9]{40}$/.test(source||'')||!/^v\d+\.\d+\.\d+-preview\.\d+$/.test(tag||''))throw Error('Exact source commit and preview tag required.');
if(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()!==source)throw Error('Checkout differs from the requested preview source.');
const version=fs.readFileSync('app/DeviceBridge/DeviceBridge.csproj','utf8').match(/<Version>(\d+\.\d+\.\d+)<\/Version>/)?.[1];
if(!tag.startsWith('v'+version+'-preview.'))throw Error('Preview tag and Windows version differ.');
const token=process.env.GH_TOKEN;if(!token)throw Error('Workflow upload token is missing.');
const headers={Accept:'application/vnd.github+json',Authorization:'Bearer '+token,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'DeviceBridge-preview-CI'};
async function api(route){const response=await fetch('https://api.github.com/repos/'+repository+'/'+route,{headers,signal:AbortSignal.timeout(30000)});const value=await response.json();if(!response.ok)throw Error('GitHub request failed: '+response.status);return value;}
let release=await api('releases/tags/'+tag);
if(!release.draft||!release.prerelease||release.target_commitish!==source)throw Error('An unpublished preview draft for this exact commit must already exist.');
const filename='DeviceBridge-Setup-'+version+'.exe',directory='app/DeviceBridge/installer-output',file=path.join(directory,filename),bytes=fs.readFileSync(file);
if(bytes.length<20*1024*1024||bytes.length>512*1024*1024||bytes.toString('ascii',0,2)!=='MZ')throw Error('Invalid Windows installer.');
const digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
const checksumFile=path.join(directory,'SHA256-Windows.txt');fs.writeFileSync(checksumFile,digest.slice(7)+'  '+filename+'\n');
for(const [name,filePath,expected]of [[filename,file,digest],['SHA256-Windows.txt',checksumFile,null]]){
 const content=fs.readFileSync(filePath),wanted=expected||'sha256:'+createHash('sha256').update(content).digest('hex');
 release=await api('releases/'+release.id);if(!release.draft)throw Error('Preview was published while the build was running.');
 const existing=release.assets.find(asset=>asset.name===name);
 if(existing){if(existing.state!=='uploaded'||existing.digest!==wanted||existing.size!==content.length)throw Error('The draft already contains a different '+name);}
 else execFileSync('gh',['release','upload',tag,filePath,'--repo',repository],{stdio:'inherit',timeout:600000});
 const saved=(await api('releases/'+release.id)).assets.find(asset=>asset.name===name);
 if(saved?.state!=='uploaded'||saved.digest!==wanted||saved.size!==content.length)throw Error('Uploaded asset integrity failed: '+name);
 console.log('Verified preview asset: '+name+' · '+content.length+' bytes · '+wanted);
}
console.log('Windows assets are ready in the draft. The signed Android APK and final publication are separate steps.');
