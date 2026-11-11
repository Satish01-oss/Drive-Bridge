import test from 'node:test';
import assert from 'node:assert/strict';
import {Recovery} from './recovery.mjs';
const grant=()=>({hostId:'host_device_00000001',grantId:'grant_random_0000001',revision:1,expiresAt:10000000,reconnect:true,permissions:['view','input','speaker','microphone']});
function fixture(options={}){
 let time=1000;const r=new Recovery({now:()=>time,random:()=>0.5});
 r.setAvailability({hostOnline:true});r.approve({...grant(),...options});
 const ready=permissions=>({hostId:grant().hostId,grantId:grant().grantId,revision:1,permissions:permissions??grant().permissions});
 const connect=()=>{const [effect]=r.tick();assert.equal(effect?.type,'connect');r.connected(effect.attemptId,ready());return effect.attemptId;};
 return {r,advance:ms=>{time+=ms;},setTime:ms=>{time=ms;},ready,connect};
}
const cleanup=effects=>assert.deepEqual(effects.slice(0,4).map(e=>e.type),['cancel-transport','release-input','restore-pointer','stop-media']);

test('host internet outage recovers with the approved grant and no new key',()=>{
 const {r,connect,advance,ready}=fixture();connect();cleanup(r.setAvailability({hostOnline:false}));assert.equal(r.snapshot.state,'host-offline');advance(60000);assert.deepEqual(r.tick(),[]);
 r.setAvailability({hostOnline:true});const [attempt]=r.tick();assert.equal(attempt.grantId,grant().grantId);assert.equal(r.connected(attempt.attemptId,ready())[0].type,'session-ready');assert.equal(r.snapshot.state,'connected');
});
test('phone internet and mobile-data changes recover independently of host availability',()=>{
 const {r,connect}=fixture();connect();r.setAvailability({phoneOnline:false});assert.equal(r.snapshot.state,'phone-offline');assert.deepEqual(r.tick(),[]);r.setAvailability({phoneOnline:true});assert.equal(r.tick()[0].type,'connect');
});
test('unapproved devices cannot connect just because a host appears online',()=>{
 const r=new Recovery();r.setAvailability({hostOnline:true});assert.deepEqual(r.tick(),[]);assert.equal(r.snapshot.state,'idle');
});
test('reconnection disabled requires approval after disconnection',()=>{
 const {r,connect}=fixture({reconnect:false});connect();r.setAvailability({hostOnline:false});assert.equal(r.snapshot.state,'approval-required');r.setAvailability({hostOnline:true});assert.deepEqual(r.tick(),[]);
});
test('a failed initial transport does not become unattended access without reconnect consent',()=>{
 const {r}=fixture({reconnect:false});const [e]=r.tick();r.failed(e.attemptId);assert.equal(r.snapshot.state,'approval-required');
});
test('retry delays increase and are capped at thirty seconds',()=>{
 const {r,advance}=fixture();let previous=0;
 for(let i=0;i<12;i++){const [e]=r.tick();r.failed(e.attemptId);const delay=r.snapshot.nextAttemptAt-(1000+previous);assert.equal(delay,Math.min(30000,1000*2**Math.min(i,5)));advance(delay);previous+=delay;}
});
test('fifteen-second attempt timeout cleans up and schedules one retry',()=>{
 const {r,advance}=fixture();const [e]=r.tick();advance(14999);assert.deepEqual(r.tick(),[]);advance(1);cleanup(r.tick());assert.equal(r.snapshot.state,'waiting');assert.deepEqual(r.failed(e.attemptId),[]);
});
test('a stopped connection cannot be resurrected by a late success or presence update',()=>{
 const {r,ready}=fixture();const [e]=r.tick();cleanup(r.stop());assert.equal(r.connected(e.attemptId,ready())[0].type,'discard-transport');r.setAvailability({hostOnline:false});r.setAvailability({hostOnline:true});assert.deepEqual(r.tick(),[]);assert.equal(r.snapshot.state,'stopped');
});
test('revocation cancels attempts and rejects late completions',()=>{
 const {r,ready}=fixture();const [e]=r.tick();cleanup(r.revoke());assert.equal(r.connected(e.attemptId,ready())[0].type,'discard-transport');assert.equal(r.snapshot.state,'approval-required');
});
test('a stale transport close cannot disconnect a newer session',()=>{
 const {r,advance,ready}=fixture();const [old]=r.tick();r.failed(old.attemptId);advance(1000);const [next]=r.tick();r.connected(next.attemptId,ready());assert.deepEqual(r.disconnected(old.attemptId),[]);assert.equal(r.snapshot.state,'connected');
});
test('duplicate connected notifications do not discard the active transport',()=>{
 const {r,ready,connect}=fixture();const id=connect();assert.deepEqual(r.connected(id,ready()),[]);assert.equal(r.snapshot.state,'connected');
});
test('retry jitter stays within bounds and never exceeds the maximum delay',()=>{
 for(const random of [()=>0,()=>0.999999]){
  let time=1000;const r=new Recovery({now:()=>time,random});r.setAvailability({hostOnline:true});r.approve(grant());
  for(let i=0;i<10;i++){const [e]=r.tick();r.failed(e.attemptId);const delay=r.snapshot.nextAttemptAt-time;assert.ok(delay>=800&&delay<=30000);time+=delay;}
 }
});
test('new approval invalidates previous attempts and limits their permissions',()=>{
 const {r,ready}=fixture();const [old]=r.tick();r.approve({...grant(),revision:2,permissions:['view']});assert.equal(r.connected(old.attemptId,ready())[0].type,'discard-transport');const [next]=r.tick();assert.deepEqual(next.permissions,['view']);assert.equal(next.revision,2);
});
test('identity, grant revision and permission mismatches reject the session',()=>{
 for(const change of [{hostId:'different_host_00001'},{grantId:'different_grant_0001'},{revision:2},{permissions:['view','shell']},{permissions:['view','view']}]){
  const {r,ready}=fixture();const [e]=r.tick();cleanup(r.connected(e.attemptId,{...ready(),...change}));assert.equal(r.snapshot.state,'approval-required');
 }
});
test('a reduced grant does not regain microphone permission on a later reconnect',()=>{
 const {r,ready}=fixture();const [e]=r.tick();r.connected(e.attemptId,ready(['view']));r.disconnected(e.attemptId);assert.deepEqual(r.tick()[0].permissions,['view']);
});
test('expired permission stops an active connection and cannot be renewed by presence',()=>{
 const {r,advance,connect}=fixture({expiresAt:2000});connect();advance(1000);cleanup(r.tick());assert.equal(r.snapshot.state,'approval-required');assert.deepEqual(r.reconnectNow(),[]);
});
test('expiry is checked again when an authentication attempt completes',()=>{
 const {r,advance,ready}=fixture({expiresAt:2000});const [e]=r.tick();advance(1000);cleanup(r.connected(e.attemptId,ready()));assert.equal(r.snapshot.state,'approval-required');
});
test('Reconnect now bypasses retry delay but cannot create parallel attempts',()=>{
 const {r}=fixture();const [first]=r.tick();r.failed(first.attemptId);const [second]=r.reconnectNow();assert.notEqual(first.attemptId,second.attemptId);assert.deepEqual(r.reconnectNow(),[]);assert.deepEqual(r.tick(),[]);
});
test('repeated offline hints are idempotent and explicit quit still wins',()=>{
 const {r,connect}=fixture();connect();r.setAvailability({hostOnline:false});const generation=r.snapshot.generation;assert.deepEqual(r.setAvailability({hostOnline:false}),[]);assert.equal(r.snapshot.generation,generation);r.stop();r.setAvailability({hostOnline:true});assert.deepEqual(r.tick(),[]);
});
test('invalid grants are rejected before replacing current authorization',()=>{
 const {r}=fixture();for(const change of [{permissions:['input']},{expiresAt:0},{hostId:'short'},{revision:0},{reconnect:'yes'}])assert.throws(()=>r.approve({...grant(),...change}),/Invalid host grant/);assert.equal(r.tick()[0].type,'connect');
});
test('grant arrays and returned actions do not expose mutable internal permissions',()=>{
 const {r}=fixture();const g=grant();r.approve(g);g.permissions.push('shell');const [e]=r.tick();assert.equal(e.permissions.includes('shell'),false);e.permissions.push('shell');r.failed(e.attemptId);const [retry]=r.reconnectNow();assert.equal(retry.permissions.includes('shell'),false);assert.equal(Object.isFrozen(r.snapshot),true);
});
test('backward clock changes cannot revive an expired grant',()=>{
 const {r,setTime}=fixture({expiresAt:2000});r.tick();setTime(2000);r.tick();setTime(1000);assert.equal(r.snapshot.state,'approval-required');assert.deepEqual(r.tick(),[]);
});
import {reconnectDelay,shouldRestartNetwork} from './recovery.mjs';
test('repeated failures back off with bounded jitter instead of reconnecting every three seconds',()=>{assert.deepEqual([0,1,2,3,4,5,6].map(n=>reconnectDelay(n,.5)),[1000,2000,4000,8000,16000,30000,30000]);assert.throws(()=>reconnectDelay(-1));});
test('duplicate online/capability notifications do not restart a working session',()=>{assert.equal(shouldRestartNetwork(true,true,false),false);assert.equal(shouldRestartNetwork(false,false,true),false);assert.equal(shouldRestartNetwork(true,false),true);assert.equal(shouldRestartNetwork(false,true),true);assert.equal(shouldRestartNetwork(true,true,true),true);});
