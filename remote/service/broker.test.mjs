import test from 'node:test';import assert from 'node:assert/strict';
import {Broker} from './broker.mjs';import {publicIdentity,verifiedSignature,randomId} from './identity.mjs';
import {identity,login,pair,grantFor,approve,signal} from './test-helpers.mjs';
function fixture(){let time=Date.now();const broker=new Broker({now:()=>time}),host=login(broker),phone=login(broker);return {broker,host,phone,advance:ms=>{time+=ms;},now:()=>time};}
test('identity-derived device IDs authenticate by signed, single-use challenges',()=>{
 const b=new Broker(),key=identity(),challenge=b.challenge(key.publicKey),signature=key.sign('auth',challenge);assert.equal(challenge.deviceId,publicIdentity(key.publicKey).id);
 const session=b.authenticate(challenge.challengeId,signature);assert.equal(b.authorize(session.token).deviceId,challenge.deviceId);assert.throws(()=>b.authenticate(challenge.challengeId,signature),/authentication-failed/);
});
test('forged or expired authentication fails without registering access',()=>{
 const {broker,advance}=fixture(),key=identity(),attacker=identity();let c=broker.challenge(key.publicKey);assert.throws(()=>broker.authenticate(c.challengeId,attacker.sign('auth',c)),/authentication-failed/);
 c=broker.challenge(key.publicKey);advance(60000);assert.throws(()=>broker.authenticate(c.challengeId,key.sign('auth',c)),/authentication-failed/);
 assert.throws(()=>broker.challenge('not-a-key'),/public-key/);assert.throws(()=>broker.authorize('bad'),/unauthorized/);
});
test('purpose binding rejects a valid signature from a different operation',()=>{
 const key=identity(),c={nonce:randomId()};assert.equal(verifiedSignature(key.publicKey,'grant',c,key.sign('auth',c)),false);
});
test('bearer sessions and websocket tickets expire; tickets cannot be replayed',()=>{
 const {broker,host,advance}=fixture(),ticket=broker.socketTicket(host.auth);assert.equal(broker.consumeTicket(ticket.ticket).deviceId,host.deviceId);assert.throws(()=>broker.consumeTicket(ticket.ticket),/unauthorized/);
 const next=broker.socketTicket(host.auth);advance(30000);assert.throws(()=>broker.consumeTicket(next.ticket),/unauthorized/);advance(30*60000);assert.throws(()=>broker.authorize(host.token),/unauthorized/);
});
test('six-character pairing waits for host approval before creating any grant',()=>{
 const {broker,host,phone}=fixture(),{invitation,request}=pair(broker,host,phone);assert.match(invitation.code,/^[2-9A-HJ-NP-Z]{6}$/);assert.equal(request.status,'pending');assert.equal(broker.grants(phone.auth).length,0);assert.equal(broker.requests(host.auth)[0].controllerKey,phone.key.publicKey);
 assert.throws(()=>broker.requestPairing(host.auth,invitation.code),/unavailable/);
});
test('approved grants are host-signed and visible only to the two approved identities',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request);assert.equal(verifiedSignature(host.key.publicKey,'grant',record.grant,record.signature),true);
 assert.equal(broker.grants(phone.auth).length,1);const stranger=login(broker);assert.equal(broker.grants(stranger.auth).length,0);assert.deepEqual(broker.requests(stranger.auth),[]);
});
test('a controller cannot approve its own access or forge the host grant',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),g=grantFor(request);
 assert.throws(()=>broker.approve(phone.auth,request.requestId,g,phone.key.sign('grant',g)),/unavailable/);
 assert.throws(()=>broker.approve(host.auth,request.requestId,g,phone.key.sign('grant',g)),/signature/);
 assert.equal(broker.grants(host.auth).length,0);
});
test('approval cannot expand capabilities or reconnect consent',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone,{permissions:['view'],reconnect:false});
 for(const change of [{permissions:['view','input']},{reconnect:true},{controllerId:host.deviceId},{expiresAt:Date.now()+9*86400000}]){const g={...grantFor(request),...change};assert.throws(()=>broker.approve(host.auth,request.requestId,g,host.key.sign('grant',g)),/invalid-grant/);}
});
test('expired or replaced pairing codes cannot authorize requests',()=>{
 const {broker,host,phone,advance}=fixture();const p=broker.createPairing(host.auth,{permissions:['view'],reconnect:true});advance(120000);assert.throws(()=>broker.requestPairing(phone.auth,p.code),/unavailable/);
 const first=pair(broker,host,phone);broker.createPairing(host.auth,{permissions:['view'],reconnect:true});const g=grantFor(first.request);assert.throws(()=>broker.approve(host.auth,first.request.requestId,g,host.key.sign('grant',g)),/unavailable/);
});
test('rejecting or consuming a request prevents later approval and key reuse',()=>{
 const {broker,host,phone}=fixture();const rejected=pair(broker,host,phone);broker.reject(host.auth,rejected.request.requestId);assert.throws(()=>approve(broker,host,rejected.request),/unavailable/);
 const next=pair(broker,host,phone);approve(broker,host,next.request);assert.throws(()=>broker.requestPairing(phone.auth,next.invitation.code),/unavailable/);assert.throws(()=>approve(broker,host,next.request),/unavailable/);
});
test('an accepted key leaves five minutes for approval while expired keys cannot start new requests',()=>{
 const {broker,host,phone,advance}=fixture(),{invitation,request}=pair(broker,host,phone);advance(120001);assert.throws(()=>broker.requestPairing(phone.auth,invitation.code),/unavailable/);assert.equal(approve(broker,host,request).grant.controllerId,phone.deviceId);
});
test('guessing attempts and global state have bounded limits',()=>{
 const {broker,phone}=fixture();for(let i=0;i<5;i++)assert.throws(()=>broker.requestPairing(phone.auth,'AAAAAA'),/unavailable/);assert.throws(()=>broker.requestPairing(phone.auth,'AAAAAA'),/rate-limited/);
 const small=new Broker({capacity:1});small.challenge(identity().publicKey);assert.throws(()=>small.challenge(identity().publicKey),/capacity/);
});
test('signed signaling forwards only between the granted identities and prevents replay',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request),events=[];broker.on('device',(id,e)=>events.push([id,e]));
 const offer=signal(phone,host,record);assert.deepEqual(broker.forward(phone.auth,offer),{forwarded:true});assert.equal(events[0][0],host.deviceId);assert.equal(events[0][1].signed.signature,offer.signature);assert.throws(()=>broker.forward(phone.auth,offer),/replayed/);
 const answer=signal(host,phone,record,{sessionId:offer.message.sessionId,type:'answer'});broker.forward(host.auth,answer);assert.equal(events[1][0],phone.deviceId);
});
test('tampered signals, wrong peers and unapproved sessions fail closed',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request),offer=signal(phone,host,record);
 assert.throws(()=>broker.forward(phone.auth,{...offer,message:{...offer.message,seq:2}}),/signature/);
 const attacker=login(broker);assert.throws(()=>broker.forward(attacker.auth,signal(attacker,host,record)),/forbidden/);
 assert.throws(()=>broker.forward(phone.auth,signal(phone,host,record,{type:'candidate'})),/session-rejected/);
});
test('trusted resume requires a newer generation and no old session reuse',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request),old=signal(phone,host,record);broker.forward(phone.auth,old);
 assert.throws(()=>broker.forward(phone.auth,signal(phone,host,record)),/session-rejected/);
 const next=signal(phone,host,record,{generation:2});broker.forward(phone.auth,next);assert.throws(()=>broker.forward(phone.auth,{...old}),/session-rejected/);
 assert.throws(()=>broker.forward(phone.auth,signal(phone,host,record,{generation:3,sessionId:next.message.sessionId})),/session-rejected/);
});
test('reconnect-disabled grants cannot open a replacement session',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone,{reconnect:false}),record=approve(broker,host,request);broker.forward(phone.auth,signal(phone,host,record));assert.throws(()=>broker.forward(phone.auth,signal(phone,host,record,{generation:2})),/session-rejected/);
});
test('revocation immediately denies further signaling and emits a stop notification',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request),events=[];broker.on('device',(id,e)=>events.push([id,e]));assert.throws(()=>broker.revoke(phone.auth,record.grant.id),/unavailable/);
 broker.revoke(host.auth,record.grant.id);assert.equal(events.filter(([,e])=>e.type==='grant-revoked').length,2);assert.throws(()=>broker.forward(phone.auth,signal(phone,host,record)),/grant-unavailable/);
});
test('expired grants cannot signal or appear in the trusted-device list',()=>{
 const {broker,host,phone,advance,now}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request,now()+1000);advance(1000);assert.equal(broker.grants(phone.auth).length,0);assert.throws(()=>broker.forward(phone.auth,signal(phone,host,record)),/grant-unavailable/);
});
test('the host can restore its signed saved consent after an ephemeral service restart',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request),fresh=new Broker(),newHost=login(fresh,host.key),newPhone=login(fresh,phone.key);
 assert.throws(()=>fresh.restore(newPhone.auth,record),/host-restore-only/);fresh.restore(newHost.auth,record);assert.equal(fresh.grants(newPhone.auth)[0].grant.id,record.grant.id);
 assert.deepEqual(fresh.restore(newHost.auth,record).grant,record.grant);
});
test('restoration cannot revive revoked grants, expand permissions or add reconnect consent',()=>{
 const {broker,host,phone}=fixture(),{request}=pair(broker,host,phone),record=approve(broker,host,request);assert.throws(()=>new Broker().restore(host.auth,{...record,grant:{...record.grant,permissions:['view','input','speaker']}}),/signature/);
 broker.revoke(host.auth,record.grant.id);assert.throws(()=>broker.restore(host.auth,record),/grant-revoked/);
 const fresh=new Broker(),next=pair(fresh,host,phone,{reconnect:false}),oneTime=approve(fresh,host,next.request);assert.throws(()=>new Broker().restore(host.auth,oneTime),/invalid-restore/);
});
