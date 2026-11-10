import test from 'node:test';import assert from 'node:assert/strict';import {once} from 'node:events';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';import {createService} from './server.mjs';import {identity,grantFor,signal} from './test-helpers.mjs';
async function appFor(t){const app=createService();const address=await app.listen();t.after(()=>app.close());const base=`http://127.0.0.1:${address.port}`;
 const request=async(path,body,token,options={})=>{const res=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{}),...options.headers},body:body!==undefined?JSON.stringify(body):undefined});return {status:res.status,body:await res.json()};};
 const login=async()=>{const key=identity(),c=(await request('/v1/challenges',{publicKey:key.publicKey})).body;const session=(await request('/v1/auth',{challengeId:c.challengeId,signature:key.sign('auth',c)})).body;assert.ok(session.token);return {key,...session};};
 return {app,base,request,login};}
function socketClient(url,ticket){const ws=new WebSocket(url,['devicebridge.v1','ticket.'+ticket]),queue=[],waiters=[];
 ws.on('message',data=>{const e=JSON.parse(data);const i=waiters.findIndex(w=>w.type===e.type);if(i>=0){const [w]=waiters.splice(i,1);clearTimeout(w.timer);w.resolve(e);}else queue.push(e);});
 return {ws,event:type=>{const i=queue.findIndex(e=>e.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={type,resolve,timer:setTimeout(()=>{const i=waiters.indexOf(w);if(i>=0)waiters.splice(i,1);reject(Error('Timed out waiting for '+type));},3000)};waiters.push(w);});}};
}

test('the public client can load its fullscreen stylesheet and controller module',async t=>{
 execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/build-client.mjs',import.meta.url))]);
 const app=createService({serveClient:true}),address=await app.listen();t.after(()=>app.close());
 for(const asset of ['/','/app.mjs','/fullscreen.css','/controller-display.mjs']){const response=await fetch(`http://127.0.0.1:${address.port}`+asset);assert.equal(response.status,200,asset+' must load before pairing');assert.ok((await response.text()).length>100);}
});
test('HTTP authentication and host approval produce a verifiable grant across real sockets',async t=>{
 const {request,login}=await appFor(t),host=await login(),phone=await login();assert.equal((await request('/v1/grants')).status,401);
 const p=(await request('/v1/pairings',{permissions:['view','input'],reconnect:true},host.token)).body,r=(await request('/v1/requests',{code:p.code},phone.token)).body;
 assert.equal(r.status,'pending');assert.equal((await request('/v1/grants',undefined,phone.token)).body.grants.length,0);
 const grant=grantFor(r),approved=await request(`/v1/requests/${r.requestId}/approve`,{grant,signature:host.key.sign('grant',grant)},host.token);assert.equal(approved.status,200);
 assert.equal((await request('/v1/grants',undefined,phone.token)).body.grants[0].signature,approved.body.signature);
});
test('WebSocket transport delivers signed signaling, presence loss and return, and revocation',async t=>{
 const {request,login,base}=await appFor(t),host=await login(),phone=await login();const p=(await request('/v1/pairings',{permissions:['view'],reconnect:true},host.token)).body,r=(await request('/v1/requests',{code:p.code},phone.token)).body,g=grantFor(r);
 const record=(await request(`/v1/requests/${r.requestId}/approve`,{grant:g,signature:host.key.sign('grant',g)},host.token)).body;
 const connect=async client=>{const ticket=(await request('/v1/socket-ticket',{},client.token)).body.ticket;const s=socketClient(base.replace('http:','ws:')+'/v1/ws',ticket);await s.event('ready');return s;};
 const h=await connect(host),c=await connect(phone);let presence=await c.event('presence');assert.equal(presence.online,true);await h.event('presence');await h.event('presence');
 const offer=signal(phone,host,record);c.ws.send(JSON.stringify({type:'signal',signed:offer}));assert.equal((await h.event('signal')).signed.signature,offer.signature);await c.event('signal-accepted');
 const close=once(h.ws,'close');h.ws.close();await close;presence=await c.event('presence');assert.equal(presence.online,false);
 const resumed=await connect(host);assert.equal((await c.event('presence')).online,true);
 const next=signal(phone,host,record,{generation:2});c.ws.send(JSON.stringify({type:'signal',signed:next}));assert.equal((await resumed.event('signal')).signed.message.generation,2);await c.event('signal-accepted');
 await request(`/v1/grants/${g.id}/revoke`,{},host.token);assert.equal((await c.event('grant-revoked')).grantId,g.id);
 c.ws.send(JSON.stringify({type:'signal',signed:signal(phone,host,record,{generation:3})}));assert.equal((await c.event('error')).error,'grant-unavailable');
});
test('WebSocket upgrade refuses missing credentials, query tokens and replayed tickets',async t=>{
 const {request,login,base}=await appFor(t),host=await login(),ticket=(await request('/v1/socket-ticket',{},host.token)).body.ticket,url=base.replace('http:','ws:')+'/v1/ws';
 const valid=socketClient(url,ticket);await valid.event('ready');
 for(const [path,protocols]of [[url,undefined],[url+'?token=secret',['devicebridge.v1','ticket.'+ticket]],[url,['devicebridge.v1','ticket.'+ticket]]]){
  const ws=new WebSocket(path,protocols);await assert.rejects(once(ws,'open'));ws.terminate();
 }
});
test('HTTP denies hostile origins, unknown fields and excessive bodies without exposing details',async t=>{
 const {request,base}=await appFor(t);assert.equal((await request('/v1/challenges',{publicKey:identity().publicKey},null,{headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await request('/v1/challenges',{publicKey:identity().publicKey,command:'run'})).status,400);
 const res=await fetch(base+'/v1/challenges',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({publicKey:'x'.repeat(70000)})});assert.equal(res.status,413);assert.equal((await res.json()).error,'body-too-large');
 assert.equal((await request('/health')).body.storage,'ephemeral-development');
});
test('public binds require an explicit HTTPS deployment configuration',async()=>{
 const app=createService();await assert.rejects(app.listen(0,'0.0.0.0'),/HTTPS/);await app.close();assert.throws(()=>createService({publicOrigin:'http://insecure.example'}),/HTTPS/);
});
test('browser CORS permits only configured origins and the minimal request headers',async t=>{
 const app=createService({allowedOrigins:['https://devicebridge.local']}),address=await app.listen();t.after(()=>app.close());const url=`http://127.0.0.1:${address.port}/v1/challenges`;
 let res=await fetch(url,{method:'OPTIONS',headers:{origin:'https://devicebridge.local','access-control-request-method':'POST','access-control-request-headers':'content-type,authorization'}});assert.equal(res.status,204);assert.equal(res.headers.get('access-control-allow-origin'),'https://devicebridge.local');
 res=await fetch(url,{method:'OPTIONS',headers:{origin:'https://evil.example'}});assert.equal(res.status,403);assert.equal(res.headers.get('access-control-allow-origin'),null);
 res=await fetch(url,{method:'OPTIONS',headers:{origin:'https://devicebridge.local','access-control-request-headers':'x-evil'}});assert.equal(res.status,403);
});
