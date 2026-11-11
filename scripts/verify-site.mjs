import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { validateDescriptor } from './sync-android-update.mjs';
import { previewRelease } from '../frontend/site/preview-release.mjs';

const root = resolve(process.argv[2]||'frontend/site');
async function localFile(path) {
  const resolved = resolve(path);
  if (relative(root, resolved).startsWith('..')) throw new Error(`File outside website output: ${path}`);
  if (!(await stat(resolved)).isFile()) throw new Error(`Not a file: ${path}`);
  return readFile(resolved);
}
for (const name of ['release.json', 'test-release.json']) {
  const m = JSON.parse(await localFile(resolve(root, name)));
  if (m.filename !== `DeviceBridge-${m.kind==='installer'?'Setup-':''}${m.version}.exe`) throw new Error('Version and filename disagree');
  const hash = createHash('sha256');
  let bytes = 0;
  for (const part of m.parts) {
    const data = await localFile(resolve(root, part));
    hash.update(data);
    bytes += data.length;
  }
  if (bytes !== m.bytes || hash.digest('hex') !== m.sha256) throw new Error(`${name}: EXE integrity failed`);
  console.log(`${name}: ${m.filename}, ${bytes} bytes, SHA-256 verified`);
}
for (const name of ['index.html', 'test.html', 'credits.html', 'remote-preview.html', 'improvements.html']) {
  const path = resolve(root, name);
  const html = (await localFile(path)).toString();
  if(name==='index.html'){
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    if(new Set(ids).size!==ids.length)throw Error('Homepage has duplicate section IDs');
    for(const [,target]of html.matchAll(/href="#([^"]+)"/g))if(!ids.includes(target))throw Error('Homepage link has no target: '+target);
  }
  if (name==='test.html'||name==='index.html'&&!html.includes('data-primary-download="remote-preview"')) {
    const manifest = JSON.parse(await localFile(resolve(root, name === 'test.html' ? 'test-release.json' : 'release.json')));
    const versions = [...html.matchAll(/data-release-version>([^<]*)</g)].map(m => m[1]);
    if (!versions.length || versions.some(v => v !== manifest.version)) throw new Error(`${name}: visible versions differ from the download`);
    const filenames = [...html.matchAll(/data-release-filename>([^<]*)</g)].map(m => m[1]);
    if (filenames.some(f => f !== manifest.filename)) throw new Error(`${name}: filename differs from the download`);
  }
  for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(?:https?:|#|mailto:|data:)/.test(link)) continue;
    if (link.startsWith('/')) throw new Error(`${name}: root-relative link breaks project hosting: ${link}`);
    await localFile(resolve(dirname(path), link.split(/[?#]/)[0]));
  }
  console.log(`${name}: local links and assets verified`);
}
const preview=JSON.parse(await localFile(resolve(root,'remote-preview.json')));
const previewPage=(await localFile(resolve(root,'index.html'))).toString();
const previewReleaseInfo=previewRelease(preview);
const primaryVersions=[...previewPage.matchAll(/data-preview-version>([^<]*)</g)].map(m=>m[1]);
if(!previewPage.includes('data-primary-download="remote-preview"')||!primaryVersions.length||primaryVersions.some(v=>v!==previewReleaseInfo.label)||previewPage.includes('data-download'))throw Error('Homepage primary download/version mismatch');
if(!(await localFile(resolve(root,'remote-preview.html'))).toString().includes('0;url=index.html#download'))throw Error('Old preview link must redirect to the main downloads');
if(!Number.isInteger(preview.android.versionCode)||preview.android.versionCode<1||preview.android.versionName!==preview.tag.slice(1))throw Error('Android update version metadata is invalid');
if(!/^v\d+\.\d+\.\d+-preview\.\d+$/.test(preview.tag)||!/^[a-f0-9]{40}$/.test(preview.source))throw Error('Preview source identity is invalid');
for(const [platform,extension] of [['windows','.exe'],['android','.apk']]){
  const asset=preview[platform];
  const expected='https://github.com/Satish01-oss/Drive-Bridge/releases/download/'+preview.tag+'/'+asset.filename;
  if(!asset.filename.endsWith(extension)||asset.url!==expected||!/^[a-f0-9]{64}$/.test(asset.sha256)||!(asset.bytes>0)||!previewPage.includes('href="'+asset.url+'"'))throw Error('Preview download metadata mismatch: '+platform);
}
console.log('Preview links match source-pinned release metadata');
validateDescriptor(JSON.parse(await localFile(resolve(root,'android-update.json'))));
console.log('Android in-app update feed metadata verified');
