import test from 'node:test';import assert from 'node:assert/strict';import {WebSocket} from 'ws';
import {createService} from '../service/server.mjs';import {ConnectionClient} from './connection.mjs';import {MemoryStore} from './storage.mjs';
import {createIdentity,identityId,signValue,verifyValue,canonical,toBase64Url} from '../shared/signatures.mjs';import {publicIdentity,verifiedSignature} from '../service/identity.mjs';
const id=()=>toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
function events(client){const queue=[],pending=[];client.subscribe(e=>{const i=pending.findIndex(p=>p.type===e.type);if(i>=0){const [p]=pending.splice(i,1);clearTimeout(p.timer);p.resolve(e);}else queue.push(e);});return type=>{const i=queue.findIndex(e=>e.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const entry={type,resolve,timer:setTimeout(()=>{const i=pending.indexOf(entry);if(i>=0)pending.splice(i,1);reject(Error('Timed out: '+type));},3000)};pending.push(entry);});};}
async function fixture(t){const service=createService(),address=await service.listen(),url=`http://127.0.0.1:${address.port}`;t.after(()=>service.close());
 const host=new ConnectionClient({baseUrl:url,store:new MemoryStore(),WebSocketImpl:WebSocket}),phone=new ConnectionClient({baseUrl:url,store:new MemoryStore(),WebSocketImpl:WebSocket}),hostEvent=events(host),phoneEvent=events(phone);t.after(()=>{host.stop();phone.stop();});await Promise.all([host.start(),phone.start()]);return {service,url,host,phone,hostEvent,phoneEvent};}
async function paired(f){const p=await f.host.createPairing({permissions:['view','input','microphone'],reconnect:true}),request=await f.phone.requestPairing(p.code);await f.hostEvent('pairing-request');const record=await f.host.approveRequest(request);await f.phoneEvent('grant-approved');return record;}
const message=(sessionId,generation,seq,type='offer')=>({protocol:'devicebridge.remote',version:1,sessionId,generation,seq,kind:'signal',payload:{type,data:'test-sdp'}});
test('browser and server agree on signed bytes and identity fingerprints',async()=>{
 const key=await createIdentity(),data={z:'👋 नमस्ते',a:[1,true,null]},sig=await signValue(key,'grant',data);assert.equal(verifiedSignature(key.publicKey,'grant',data,sig),true);assert.equal(await verifyValue(key.publicKey,'grant',data,sig),true);assert.equal(await identityId(key.publicKey),publicIdentity(key.publicKey).id);assert.equal(key.keys.privateKey.extractable,false);assert.throws(()=>canonical({n:1.25}));
});
test('two real clients authenticate, pair with approval and verify the host grant',async t=>{
 const f=await fixture(t),record=await paired(f);assert.equal(f.host.grants.length,1);assert.equal(f.phone.grants.length,1);assert.equal(f.phone.grants[0].grant.hostId,f.host.deviceId);assert.equal(await verifyValue(record.hostKey,'grant',record.grant,record.signature),true);
});
test('clients exchange signed offer/answer messages and reject outgoing replay',async t=>{
 const f=await fixture(t),record=await paired(f),session=id(),offer=message(session,1,0);await f.phone.sendSignal(record.grant.id,offer);assert.deepEqual((await f.hostEvent('signal')).signed.message,offer);
 const answer=message(session,1,0,'answer');await f.host.sendSignal(record.grant.id,answer);assert.deepEqual((await f.phoneEvent('signal')).signed.message,answer);await assert.rejects(f.phone.sendSignal(record.grant.id,offer),/Replayed/);
});
test('trusted identity and approval survive client stop/start without a fresh key',async t=>{
 const f=await fixture(t),record=await paired(f),before=f.phone.deviceId;f.phone.stop();await f.phone.start();assert.equal(f.phone.deviceId,before);assert.equal(f.phone.grants[0].grant.id,record.grant.id);
 await f.phone.sendSignal(record.grant.id,message(id(),1,0));assert.equal((await f.hostEvent('signal')).signed.grantId,record.grant.id);
});
test('client revocation removes trust on both peers and blocks more signaling',async t=>{
 const f=await fixture(t),record=await paired(f);await f.host.revoke(record.grant.id);await f.phoneEvent('grant-revoked');assert.equal(f.host.grants.length,0);assert.equal(f.phone.grants.length,0);await assert.rejects(f.phone.sendSignal(record.grant.id,message(id(),1,0)),/trusted/);
});
test('rejecting the host prompt leaves the phone without a trusted grant',async t=>{
 const f=await fixture(t),p=await f.host.createPairing(),r=await f.phone.requestPairing(p.code);await f.host.rejectRequest(r.requestId);assert.equal((await f.phoneEvent('pairing-rejected')).requestId,r.requestId);assert.equal(f.phone.grants.length,0);
});
test('explicit stop cancels an in-flight service authentication request',async()=>{
 let entered;const waiting=new Promise(resolve=>{entered=resolve;}),client=new ConnectionClient({baseUrl:'http://127.0.0.1:12345',store:new MemoryStore(),WebSocketImpl:WebSocket,fetchImpl:async(_,options)=>{entered();return new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});}});
 const start=client.start();await waiting;client.stop();await assert.rejects(start);assert.equal(client.connected,false);
});
test('non-local HTTP service URLs are rejected before any credentials are sent',()=>{
 assert.throws(()=>new ConnectionClient({baseUrl:'http://public.example',store:new MemoryStore(),WebSocketImpl:WebSocket}),/HTTPS/);assert.throws(()=>new ConnectionClient({baseUrl:'https://user:pass@example.com',store:new MemoryStore(),WebSocketImpl:WebSocket}),/origin/);
});
test('browser fetch is invoked with the correct global receiver',async t=>{
 const f=await fixture(t);let calls=0;const client=new ConnectionClient({baseUrl:f.url,store:new MemoryStore(),WebSocketImpl:WebSocket,fetchImpl:function(...args){assert.equal(this,globalThis);calls++;return fetch(...args);}});t.after(()=>client.stop());await client.start();assert.ok(calls>=3);
});
