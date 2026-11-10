import {createIdentity,identityId,signValue,verifyValue,canonical,toBase64Url} from '../shared/signatures.mjs';
import {PERMISSIONS,validateMessage} from '../core/protocol.mjs';
const id=()=>toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
export class ConnectionClient{
 #base;#store;#fetch;#WebSocket;#identity;#identityProvider;#deviceId;#token;#socket;#generation=0;#stopper=null;#starting=null;#queue=Promise.resolve();#heartbeat;#listeners=new Set();#requests=new Map();#grants=new Map();#sessions=new Map();
 constructor({baseUrl,store,identityProvider=null,fetchImpl=fetch,WebSocketImpl=WebSocket}){
  const u=new URL(baseUrl);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('HTTPS required');if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Expected service origin');
  this.#base=u.origin;this.#store=store;this.#identityProvider=identityProvider;this.#fetch=fetchImpl.bind(globalThis);this.#WebSocket=WebSocketImpl;
 }
 get deviceId(){return this.#deviceId;}
 get connected(){return this.#socket?.readyState===1;}
 get grants(){return [...this.#grants.values()].map(r=>structuredClone(r));}
 subscribe(listener){this.#listeners.add(listener);return()=>this.#listeners.delete(listener);}
 #emit(event){for(const listener of [...this.#listeners])try{listener(event);}catch{}}
 async #post(path,body){return this.#http(path,body);}
 async #sign(purpose,value){return this.#identityProvider?this.#identityProvider.sign(purpose,value):signValue(this.#identity,purpose,value);}
 async #http(path,body){
  const generation=this.#generation,signal=AbortSignal.any([this.#stopper?.signal||new AbortController().signal,AbortSignal.timeout(90000)]);
  const res=await this.#fetch(this.#base+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.#token?{Authorization:'Bearer '+this.#token}:{})},body:body!==undefined?JSON.stringify(body):undefined,signal,credentials:'omit',cache:'no-store'});
  const value=await res.json();if(generation!==this.#generation)throw new DOMException('Connection cancelled','AbortError');if(!res.ok)throw Error(value.error||'Connection request failed');return value;
 }
 async #knownGrant(record){
  const g=record?.grant;if(!g||g.version!==1||!Number.isSafeInteger(g.revision)||g.revision<1||!Number.isSafeInteger(g.expiresAt)||g.expiresAt<=Date.now()||![g.hostId,g.controllerId].includes(this.#deviceId)||!Array.isArray(g.permissions)||!g.permissions.includes('view')||new Set(g.permissions).size!==g.permissions.length||g.permissions.some(p=>!PERMISSIONS.includes(p))||typeof g.reconnect!=='boolean')throw Error('Invalid host grant');
  if(await identityId(record.hostKey)!==g.hostId||await identityId(record.controllerKey)!==g.controllerId||!await verifyValue(record.hostKey,'grant',g,record.signature))throw Error('Host grant signature mismatch');return record;
 }
 async #saveGrant(record){await this.#knownGrant(record);this.#grants.set(record.grant.id,structuredClone(record));await this.#store.set('grants',this.grants);}
 async start(){
  if(this.#starting)return this.#starting;if(this.connected)return;
  const generation=++this.#generation;this.#stopper=new AbortController();
  const current=()=>{if(generation!==this.#generation)throw new DOMException('Connection cancelled','AbortError');};
  this.#starting=(async()=>{
   this.#emit({type:'status',status:'connecting-service'});
   this.#identity=this.#identityProvider?await this.#identityProvider.getOrCreate():await this.#store.get('identity');current();
   if(!this.#identity){this.#identity=await createIdentity();current();await this.#store.set('identity',this.#identity);current();}
   this.#deviceId=await identityId(this.#identity.publicKey);current();
   this.#grants.clear();for(const record of await this.#store.get('grants')||[]){try{await this.#knownGrant(record);this.#grants.set(record.grant.id,record);}catch{}}
   current();const challenge=await this.#post('/v1/challenges',{publicKey:this.#identity.publicKey});if(challenge.deviceId!==this.#deviceId||challenge.expiresAt<=Date.now())throw Error('Invalid identity challenge');
   const session=await this.#post('/v1/auth',{challengeId:challenge.challengeId,signature:await this.#sign('auth',challenge)});if(session.deviceId!==this.#deviceId)throw Error('Identity mismatch');this.#token=session.token;
   for(const record of this.#grants.values())if(record.grant.hostId===this.#deviceId&&record.grant.reconnect)await this.#post('/v1/grants/restore',{record});
   const {ticket}=await this.#post('/v1/socket-ticket',{});current();
   await new Promise((resolve,reject)=>{
    const ws=new this.#WebSocket(this.#base.replace(/^http/,'ws')+'/v1/ws',['devicebridge.v1','ticket.'+ticket]);this.#socket=ws;
    const timeout=setTimeout(()=>{ws.close();reject(Error('Connection service timed out'));},15000);
    const fail=()=>{clearTimeout(timeout);reject(Error('Connection service disconnected'));};
    ws.addEventListener('error',fail,{once:true});ws.addEventListener('close',()=>{fail();if(generation!==this.#generation)return;clearInterval(this.#heartbeat);this.#emit({type:'status',status:'service-offline'});});
    ws.addEventListener('message',event=>{this.#queue=this.#queue.then(async()=>{
     if(generation!==this.#generation||this.#socket!==ws)return;
     const data=JSON.parse(event.data);if(data.type==='ready'){if(data.deviceId!==this.#deviceId)throw Error('Socket identity mismatch');clearTimeout(timeout);resolve();return;}
     await this.#process(data);
    }).catch(error=>{if(generation===this.#generation)this.#emit({type:'error',message:error.message});});});
   });current();
   this.#heartbeat=setInterval(()=>{if(this.connected)this.#socket.send(JSON.stringify({type:'heartbeat'}));},20000);this.#heartbeat.unref?.();
   this.#emit({type:'status',status:'service-connected'});
   const requests=await this.#http('/v1/requests');for(const request of requests.requests)this.#requests.set(request.requestId,request);
   // Server listings never silently grant new trust. Only locally approved records persist.
   const remote=await this.#http('/v1/grants');for(const record of remote.grants){const saved=this.#grants.get(record.grant.id);if(saved&&canonical(saved.grant)===canonical(record.grant))await this.#knownGrant(record);}
  })().catch(error=>{if(generation===this.#generation){clearInterval(this.#heartbeat);this.#socket?.close();this.#emit({type:'status',status:'service-offline'});}throw error;}).finally(()=>{if(generation===this.#generation)this.#starting=null;});
  return this.#starting;
 }
 async #process(event){
  if(event.type==='pairing-request'){this.#requests.set(event.request.requestId,event.request);this.#emit(event);return;}
  if(event.type==='grant-approved'){
   const request=this.#requests.get(event.record?.grant?.requestId);if(!request||request.hostKey!==event.record.hostKey||request.controllerKey!==event.record.controllerKey)throw Error('Unrequested grant rejected');
   await this.#saveGrant(event.record);this.#emit(event);return;
  }
  if(event.type==='grant-revoked'){this.#grants.delete(event.grantId);this.#sessions.delete(event.grantId);await this.#store.set('grants',this.grants);this.#emit(event);return;}
  if(event.type==='grant-restored'){
   const saved=this.#grants.get(event.record?.grant?.id);if(!saved||canonical(saved.grant)!==canonical(event.record.grant))throw Error('Unknown restored grant');await this.#knownGrant(event.record);this.#emit(event);return;
  }
  if(event.type==='signal'){
   const signed=event.signed,record=this.#grants.get(signed?.grantId);if(!record)throw Error('Untrusted signal');await this.#knownGrant(record);
   const {signature,...content}=signed,g=record.grant,peer=this.#deviceId===g.hostId?g.controllerId:g.hostId,key=peer===g.hostId?record.hostKey:record.controllerKey;
   if(content.to!==this.#deviceId||content.from!==peer||!await verifyValue(key,'signal',content,signature))throw Error('Signal identity mismatch');validateMessage(content.message);if(content.message.kind!=='signal')throw Error('Invalid signaling payload');
   this.#acceptSignal(g,content.message,content.from);this.#emit(event);return;
  }
  if(['presence','pairing-rejected','error','heartbeat-ack','signal-accepted'].includes(event.type))this.#emit(event);
 }
 #acceptSignal(grant,message,from){
  let state=this.#sessions.get(grant.id);
  if(!state||state.id!==message.sessionId||state.generation!==message.generation){
   if(from!==grant.controllerId||message.payload.type!=='offer'||(state&&(!grant.reconnect||message.generation<=state.generation||message.sessionId===state.id)))throw Error('Stale or unrequested session');
   state={id:message.sessionId,generation:message.generation,last:new Map()};this.#sessions.set(grant.id,state);
  }
  if(message.seq<=(state.last.get(from)??-1))throw Error('Replayed signal');state.last.set(from,message.seq);
 }
 async createPairing({permissions=['view','input'],reconnect=false}={}){return this.#post('/v1/pairings',{permissions,reconnect});}
 async requestPairing(code){const request=await this.#post('/v1/requests',{code:code.trim().toUpperCase()});this.#requests.set(request.requestId,request);return request;}
 async approveRequest(request,{permissions=request.permissions,reconnect=request.reconnect,expiresAt=Date.now()+86400000}={}){
  if(request.hostId!==this.#deviceId)throw Error('This computer cannot approve that request');
  this.#requests.set(request.requestId,request);const grant={version:1,id:id(),requestId:request.requestId,hostId:request.hostId,controllerId:request.controllerId,permissions,reconnect,revision:1,expiresAt};
  const record=await this.#post('/v1/requests/'+request.requestId+'/approve',{grant,signature:await this.#sign('grant',grant)});await this.#saveGrant(record);return record;
 }
 async rejectRequest(requestId){return this.#post('/v1/requests/'+requestId+'/reject',{});}
 async revoke(grantId){this.#grants.delete(grantId);this.#sessions.delete(grantId);await this.#store.set('grants',this.grants);this.#emit({type:'grant-revoked',grantId});await this.#post('/v1/grants/'+grantId+'/revoke',{});}
 async sendSignal(grantId,message){
  const record=this.#grants.get(grantId);if(!record||!this.connected)throw Error('No active trusted connection');await this.#knownGrant(record);validateMessage(message);if(message.kind!=='signal')throw Error('Invalid signal');
  const g=record.grant,content={grantId,from:this.#deviceId,to:this.#deviceId===g.hostId?g.controllerId:g.hostId,message};
  this.#acceptSignal(g,message,this.#deviceId);const signature=await this.#sign('signal',content);if(!this.connected)throw Error('Service disconnected');this.#socket.send(JSON.stringify({type:'signal',signed:{...content,signature}}));
 }
 stop(){this.#generation++;this.#starting=null;this.#stopper?.abort();clearInterval(this.#heartbeat);this.#socket?.close();this.#socket=null;this.#token=null;this.#emit({type:'status',status:'stopped'});}
}
