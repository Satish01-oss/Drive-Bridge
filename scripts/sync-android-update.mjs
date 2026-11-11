import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository='Satish01-oss/Drive-Bridge',limit=32768;
export function validateDescriptor(value){
 const a=value?.android;
 if(value?.schema!==1||!/^v\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(value.tag)||!/^[a-f0-9]{40}$/.test(value.source)||!a)throw Error('Invalid Android update descriptor');
 const base=value.tag.slice(1).split('-')[0],expected='DeviceBridge-Android-'+base+(value.tag.includes('-preview.')?'-preview':'')+'.apk';
 if(a.filename!==expected||a.url!==`https://github.com/${repository}/releases/download/${value.tag}/${expected}`||a.versionName!==value.tag.slice(1)||!Number.isSafeInteger(a.versionCode)||a.versionCode<1||a.versionCode>2147483647||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>100*1024*1024||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid Android update asset');
 return value;
}
async function limited(response,maximum){
 if(!response.ok){const error=Error('Android update fetch failed: '+response.status);error.status=response.status;throw error;}
 const reader=response.body.getReader(),parts=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maximum){await reader.cancel();throw Error('Android update response is too large');}parts.push(Buffer.from(value));}
 return Buffer.concat(parts,size);
}
export async function syncAndroidUpdate({directory='frontend/site',fetchImpl=fetch,token=process.env.GITHUB_TOKEN}={}){
 const file=resolve(directory,'android-update.json');let best=validateDescriptor(JSON.parse(await readFile(file,'utf8')));
 const headers={Accept:'application/vnd.github+json','User-Agent':'DeviceBridge-Android-update-sync',...(token?{Authorization:'Bearer '+token}:{})};
 const response=await fetchImpl(`https://api.github.com/repos/${repository}/releases?per_page=30`,{headers,signal:AbortSignal.timeout(30000)});
 const releases=JSON.parse((await limited(response,1024*1024)).toString());if(!Array.isArray(releases))throw Error('Invalid GitHub release listing');
 for(const release of releases){
  if(release.draft)continue;const metadata=release.assets?.filter(a=>a.name==='Android-update.json')||[];if(!metadata.length)continue;
  if(metadata.length!==1)throw Error('Duplicate Android update metadata');const asset=metadata[0];
  if(asset.state!=='uploaded'||asset.size<1||asset.size>limit||asset.browser_download_url!==`https://github.com/${repository}/releases/download/${release.tag_name}/Android-update.json`||!/^sha256:[a-f0-9]{64}$/.test(asset.digest||''))throw Error('Invalid published Android metadata asset');
  const bytes=await limited(await fetchImpl(asset.browser_download_url,{signal:AbortSignal.timeout(30000)}),limit);
  if(bytes.length!==asset.size||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==asset.digest)throw Error('Android metadata integrity mismatch');
  const candidate=validateDescriptor(JSON.parse(bytes.toString()));if(candidate.tag!==release.tag_name)throw Error('Android descriptor and release disagree');
  const apks=release.assets.filter(a=>a.name===candidate.android.filename),apk=apks[0];
  if(apks.length!==1||apk.state!=='uploaded'||apk.browser_download_url!==candidate.android.url||apk.size!==candidate.android.bytes||apk.digest!=='sha256:'+candidate.android.sha256)throw Error('Android descriptor does not match the published APK');
  if(candidate.android.versionCode>best.android.versionCode)best=candidate;
 }
 await writeFile(file,JSON.stringify(best,null,2)+'\n');console.log('Android update feed: '+best.android.versionName+' (code '+best.android.versionCode+')');return best;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await syncAndroidUpdate();
