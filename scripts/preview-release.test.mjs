import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {previewRelease,renderPreview} from '../frontend/site/preview-release.mjs';
const current=JSON.parse(await readFile(new URL('../frontend/site/remote-preview.json',import.meta.url),'utf8'));
const home=await readFile(new URL('../frontend/site/index.html',import.meta.url),'utf8');
test('homepage offers the actual matching Windows and Android preview downloads together',()=>{
 const rendered=renderPreview(home,current),info=previewRelease(current);
 assert.equal(rendered,home,'checked-in links and version labels should already be current');
 assert.ok(rendered.includes(`href="${current.windows.url}" data-preview-download="windows"`));
 assert.ok(rendered.includes(`href="${current.android.url}" data-preview-download="android"`));
 const labels=[...rendered.matchAll(/data-preview-version>([^<]*)</g)];assert.ok(labels.length>=6);assert.ok(labels.every(x=>x[1]===info.label));
 assert.ok(!rendered.includes('remote-preview.html'));assert.ok(!rendered.includes('data-download'));
});
test('a new paired preview updates both downloads, filenames, version badges and release notes atomically',()=>{
 const next=structuredClone(current);next.version='0.10.0';next.preview=2;next.tag='v0.10.0-preview.2';next.url=`https://github.com/Satish01-oss/Drive-Bridge/releases/tag/${next.tag}`;
 for(const platform of ['windows','android']){const a=next[platform];a.filename=platform==='windows'?'DeviceBridge-Setup-0.10.0.exe':'DeviceBridge-Android-0.10.0-preview.apk';a.url=`https://github.com/Satish01-oss/Drive-Bridge/releases/download/${next.tag}/${a.filename}`;}
 next.android.versionName=next.tag.slice(1);next.android.versionCode++;
 const rendered=renderPreview(home,next);assert.ok(rendered.includes(next.windows.url));assert.ok(rendered.includes(next.android.url));assert.ok(rendered.includes(next.url));assert.ok(!rendered.includes(current.tag));assert.ok(!rendered.includes(current.windows.filename));assert.ok(!rendered.includes(current.android.filename));assert.ok(!rendered.includes('0.9.0 · Preview 11'));
});
test('mixed versions, foreign download URLs and invalid checksums cannot replace working links',()=>{
 for(const change of [m=>m.android.versionName='0.9.0-preview.1',m=>m.android.url='https://example.com/app.apk',m=>m.windows.filename='DeviceBridge-Setup-0.8.0.exe',m=>m.windows.sha256='invalid',m=>m.url='https://example.com/notes']){const bad=structuredClone(current);change(bad);assert.throws(()=>renderPreview(home,bad));}
});
