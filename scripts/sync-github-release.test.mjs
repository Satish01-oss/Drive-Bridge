import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { selectAsset, validateExe, syncRelease, repository } from './sync-github-release.mjs';

function fixture() {
  // Larger than one part so ordering and chunk reconstruction are exercised.
  const exe = Buffer.alloc(8*1024*1024+713, 0x5a);
  exe.write('MZ'); exe.writeUInt32LE(128,60); exe.writeUInt32LE(0x4550,128);
  exe.writeUInt16LE(0x8664,132); exe.writeUInt16LE(0x20b,152);
  const release = {tag_name:'v0.8.0',draft:false,prerelease:false,published_at:'2026-11-10T12:00:00Z',assets:[{
    name:'DeviceBridge-0.8.0.exe',state:'uploaded',size:exe.length,
    digest:'sha256:'+createHash('sha256').update(exe).digest('hex'),
    browser_download_url:`https://github.com/${repository}/releases/download/v0.8.0/DeviceBridge-0.8.0.exe`
  }]};
  return {exe,release};
}
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(),'devicebridge-release-test-'));
  t.after(async () => { await rm(root,{recursive:true,force:true}); });
  for (const name of ['index.html','test.html','release.json','test-release.json']) await writeFile(join(root,name),await readFile(resolve('dist',name)));
  await mkdir(join(root,'downloads'));
  await writeFile(join(root,'downloads/old.part'),'old download');
  return root;
}
function mockFetch(release,exe) {
  const requests=[];
  const fetcher=async (url,options={}) => {
    requests.push({url,options});
    if (url === `https://api.github.com/repos/${repository}/releases/latest`) return Response.json(release);
    assert.equal(url,release.assets[0].browser_download_url);
    assert.equal(options.headers,undefined,'API token must never be forwarded to the public download');
    return new Response(exe);
  };
  return {fetcher,requests};
}

test('new published release updates both downloads and every visible version, date and notes link',async t=>{
  const root=await workspace(t); const {release,exe}=fixture();
  const {fetcher,requests}=mockFetch(release,exe);
  const manifest=await syncRelease({root,fetcher,token:'fixture-token'});
  assert.equal(requests[0].options.headers.Authorization,'Bearer fixture-token');
  assert.equal(manifest.version,'0.8.0');
  assert.equal(manifest.parts.length,2);
  assert.deepEqual(JSON.parse(await readFile(join(root,'test-release.json'))),manifest);
  const chunks=await Promise.all(manifest.parts.map(p=>readFile(join(root,p))));
  assert.deepEqual(Buffer.concat(chunks),exe,'download must reconstruct the exact released EXE');
  assert.equal(validateExe(Buffer.concat(chunks),release.assets[0]),manifest.sha256);
  assert.equal((await readdir(join(root,'downloads'))).length,2,'stale download parts must not remain');
  for (const page of ['index.html','test.html']) {
    const html=await readFile(join(root,page),'utf8');
    assert.doesNotMatch(html,/0\.7\.0/,'old visible version must not remain');
    assert.match(html,/data-release-version>0\.8\.0</);
  }
  const home=await readFile(join(root,'index.html'),'utf8');
  assert.match(home,/data-release-date>10 Nov 2026</);
  assert.match(home,/releases\/tag\/v0\.8\.0/);
  assert.doesNotMatch(home,/71 local regression checks/,'old testing claims must not carry into a new release');
  assert.doesNotMatch(home,/WINDOWS PREVIEW/);
});

test('no stable release preserves the checked-in working download without any writes',async t=>{
  const root=await workspace(t);
  const before=await readFile(join(root,'release.json'));
  let requests=0;
  assert.equal(await syncRelease({root,fetcher:async()=>{requests++;return new Response('',{status:404});}}),null);
  assert.equal(requests,1);
  assert.deepEqual(await readFile(join(root,'release.json')),before);
  assert.equal(await readFile(join(root,'downloads/old.part'),'utf8'),'old download');
});

test('installer is preferred to a portable app and its standard launcher updates installation guidance',async t=>{
  const root=await workspace(t); const {release,exe}=fixture();
  const installer=Buffer.from(exe);
  installer.writeUInt16LE(0x14c,132); installer.writeUInt16LE(0x10b,152);
  const asset={...release.assets[0],name:'DeviceBridge-Setup-0.8.0.exe',digest:'sha256:'+createHash('sha256').update(installer).digest('hex'),browser_download_url:`https://github.com/${repository}/releases/download/v0.8.0/DeviceBridge-Setup-0.8.0.exe`};
  release.assets.unshift(asset);
  assert.equal(selectAsset(release).kind,'installer');
  const {fetcher}=mockFetch(release,installer);
  const manifest=await syncRelease({root,fetcher});
  assert.equal(manifest.filename,asset.name);
  assert.equal(manifest.kind,'installer');
  assert.match(await readFile(join(root,'index.html'),'utf8'),/Run the installer once on each PC/);
  assert.deepEqual(Buffer.concat(await Promise.all(manifest.parts.map(p=>readFile(join(root,p))))),installer);
});

test('missing EXE, drafts, prereleases, wrong version and foreign assets are rejected',()=>{
  const {release}=fixture();
  for (const change of [{assets:[]},{draft:true},{prerelease:true},{tag_name:'latest'},
    {assets:[{...release.assets[0],state:'starter'}]},
    {assets:[{...release.assets[0],name:'DeviceBridge-0.9.0.exe'}]},
    {assets:[{...release.assets[0],browser_download_url:'https://example.com/DeviceBridge-0.8.0.exe'}]},
    {assets:[{...release.assets[0],digest:'md5:bad'}]}]) assert.throws(()=>selectAsset({...release,...change}));
});

test('wrong checksum, truncated download, non-EXE and wrong architecture fail without changing the website',async t=>{
  for (const scenario of ['checksum','truncated','html','x86']) {
    const root=await workspace(t); const {release,exe}=fixture();
    let bad=Buffer.from(exe);
    if(scenario==='checksum') bad[1000]^=1;
    if(scenario==='truncated') bad=bad.subarray(0,bad.length-1);
    if(scenario==='html') bad.write('<html>');
    if(scenario==='x86') bad.writeUInt16LE(0x14c,132);
    const before=await readFile(join(root,'release.json'));
    const {fetcher}=mockFetch(release,bad);
    await assert.rejects(syncRelease({root,fetcher}));
    assert.deepEqual(await readFile(join(root,'release.json')),before);
    assert.equal(await readFile(join(root,'downloads/old.part'),'utf8'),'old download');
  }
});

test('API or asset download failure blocks publication instead of silently reverting to an old version',async t=>{
  const root=await workspace(t); const {release}=fixture();
  await assert.rejects(syncRelease({root,fetcher:async()=>new Response('',{status:503})}),/HTTP 503/);
  let n=0;
  await assert.rejects(syncRelease({root,fetcher:async()=>++n===1?Response.json(release):new Response('',{status:404})}),/HTTP 404/);
  assert.equal(await readFile(join(root,'downloads/old.part'),'utf8'),'old download');
});
