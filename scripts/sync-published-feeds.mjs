import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {validateExe,renderRelease} from './sync-github-release.mjs';
import {validateDescriptor} from './sync-android-update.mjs';
const origin='https://satish01-oss.github.io/Drive-Bridge/';
async function read(response,limit){
 if(!response.ok)throw Error('Published feed unavailable: HTTP '+response.status);
 const reader=response.body.getReader(),parts=[];let length=0;
 for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw Error('Published feed exceeds size limit');}parts.push(Buffer.from(value));}return Buffer.concat(parts,length);
}
const newer=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;};
export async function syncPublishedFeeds({root,fetcher=fetch}){
 root=resolve(root);const get=async(path,limit)=>read(await fetcher(new URL(path,origin),{signal:AbortSignal.timeout(90000)}),limit);
 const m=JSON.parse((await get('release.json',65536)).toString()),current=JSON.parse(await readFile(join(root,'release.json'),'utf8'));
 if(!/^\d+\.\d+\.\d+$/.test(m.version)||!['installer','portable'].includes(m.kind)||m.filename!==`DeviceBridge-${m.kind==='installer'?'Setup-':''}${m.version}.exe`||!Number.isSafeInteger(m.bytes)||m.bytes<512||m.bytes>512*1024*1024||!/^[a-f0-9]{64}$/.test(m.sha256)||m.releaseUrl!==`https://github.com/Satish01-oss/Drive-Bridge/releases/tag/v${m.version}`||!Number.isFinite(Date.parse(m.publishedAt))||!Array.isArray(m.parts)||!m.parts.length||m.parts.length>64||m.parts.some(p=>!/^downloads\/[A-Za-z0-9_.-]+\.part$/.test(p)))throw Error('Invalid published Windows feed');
 const localAndroid=validateDescriptor(JSON.parse(await readFile(join(root,'android-update.json'),'utf8'))),publishedAndroid=validateDescriptor(JSON.parse((await get('android-update.json',32768)).toString()));
 if(publishedAndroid.android.versionCode===localAndroid.android.versionCode&&(publishedAndroid.tag!==localAndroid.tag||publishedAndroid.source!==localAndroid.source||publishedAndroid.android.sha256!==localAndroid.android.sha256))throw Error('Conflicting published Android update');
 const android=publishedAndroid.android.versionCode>localAndroid.android.versionCode?publishedAndroid:localAndroid;
 if(android===publishedAndroid&&android.android.versionCode>localAndroid.android.versionCode){const apk=await read(await fetcher(android.android.url,{signal:AbortSignal.timeout(90000)}),100*1024*1024);if(apk.length!==android.android.bytes||createHash('sha256').update(apk).digest('hex')!==android.android.sha256)throw Error('Published Android APK checksum mismatch');}
 if(!newer(current.version,m.version)){
  const parts=[];for(const path of m.parts)parts.push(await get(path,8*1024*1024));
  validateExe(Buffer.concat(parts),{name:m.filename,size:m.bytes,digest:'sha256:'+m.sha256});
  const pages=await Promise.all(['index.html','test.html'].map(name=>readFile(join(root,name),'utf8')));
  // Only replace generated files after all mirror and asset integrity checks pass.
  const downloads=resolve(root,'downloads');if(dirname(downloads)!==root)throw Error('Invalid mirror output directory');
  await rm(downloads,{recursive:true,force:true});await mkdir(downloads,{recursive:true});
  for(let i=0;i<m.parts.length;i++)await writeFile(join(root,m.parts[i]),parts[i]);
  for(const name of ['release.json','test-release.json'])await writeFile(join(root,name),JSON.stringify(m,null,2)+'\n');
  for(const [i,name]of ['index.html','test.html'].entries())await writeFile(join(root,name),renderRelease(pages[i],m));
 }
 await writeFile(join(root,'android-update.json'),JSON.stringify(android,null,2)+'\n');
 console.log('GitHub API limited: verified the public GitHub Pages release feeds and asset checksums.');
}
