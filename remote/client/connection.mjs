import {validateTcpFrame} from '../core/tcp-frame.mjs';
import {createIdentity,identityId,signValue,verifyValue,canonical,toBase64Url} from '../shared/signatures.mjs';
import {PERMISSIONS,validateMessage} from '../core/protocol.mjs';
const id=()=>toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
export class ConnectionClient{
 #now;#interval;#clearInterval;#lastSocketMessage=0;
 #base;#store;#fetch;#WebSocket;#identity;#identityProvider;#deviceId;#token;#socket;#generation=0;#stopper=null;#starting=null;#queue=Promise.resolve();#heartbeat;#listeners=new Set();#requests=new Map();#grants=new Map();#sessions=new Map();#revoked=new Set();#pairingOperation=null;
 constructor({baseUrl,store,identityProvider=null,fetchImpl=fetch,WebSocketImpl=WebSocket,now=()=>Date.now(),interval=setInterval,cancelInterval=clearInterval}){
  this.#now=now;this.#interval=interval.bind(globalThis);this.#clearInterval=cancelInterval.bind(globalThis);
  const u=new URL(baseUrl);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('HTTPS required');if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Expected service origin');
  this.#base=u.origin;this.#store=store;this.#identityProvider=identityProvider;this.#fetch=fetchImpl.bind(globalThis);this.#WebSocket=WebSocketImpl;
 }
 get deviceId(){return this.#deviceId;}
 get connected(){return this.#socket?.readyState===1;}
 get grants(){return [...this.#grants.values()].map(r=>structuredClone(r));}
 subscribe(listener){this.#listeners.add(listener);return()=>this.#listeners.delete(listener);}
 #emit(event){for(const listener of [...this.#listeners])try{listener(event);}catch{}}
 #current(generation){if(generation!==this.#generation)throw new DOMException('Connection cancelled','AbortError');}
 #trusted(record,generation){this.#current(generation);const saved=this.#grants.get(record.grant.id);if(this.#revoked.has(record.grant.id)||!saved||canonical(saved.grant)!==canonical(record.grant)||record.grant.expiresAt<=Date.now())throw Error('Approval expired or was removed');}
 async #post(path,body){return this.#http(path,body);}
 async #sign(purpose,value){return this.#identityProvider?this.#identityProvider.sign(purpose,value):signValue(this.#identity,purpose,value);}
 async #http(path,body){
  const generation=this.#generation,signal=AbortSignal.any([this.#stopper?.signal||new AbortController().signal,AbortSignal.timeout(90000)]);
  const res=await this.#fetch(this.#base+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.#token?{Authorization:'Bearer '+this.#token}:{})},body:body!==undefined?JSON.stringify(body):undefined,signal,credentials:'omit',cache:'no-store'});
  const value=await res.json();if(generation!==this.#generation)throw new DOMException('Connection cancelled','AbortError');if(!res.ok)throw Error(value.error||'Connection request failed');return value;
 }
 async #knownGrant(record){
  const g=record?.grant;if(!g||g.version!==1||!Number.isSafeInteger(g.revision)||g.revision<1||!Number.isSafeInteger(g.expiresAt)||g.expiresAt<=Date.now()||![g.hostId,g.controllerId].includes(this.#deviceId)||!Array.isArray(g.permissions)||!g.permissions.includes('view')||new Set(g.permissions).size!==g.permissions.length||g.permissions.some(p=>!PERMISSIONS.includes(p))||typeof g.reconnect!=='boolean')throw Error('Invalid host grant');
  if(await identityId(record.hostKey)!==g.hostId||await identityId(record.controllerKey)!==g.controllerId||!await verifyValue(record.hostKey,'grant',g,record.signature))throw Error('Host grant signature mismatch');if(g.expiresAt<=Date.now())throw Error('Approval expired');return record;
 }
 async #saveGrant(record,generation=this.#generation){await this.#knownGrant(record);this.#current(generation);if(this.#revoked.has(record.grant.id))throw Error('Approval was removed');this.#grants.set(record.grant.id,structuredClone(record));await this.#store.set('grants',this.grants);if(this.#revoked.has(record.grant.id)){await this.#store.set('grants',this.grants);throw Error('Approval was removed');}this.#current(generation);}
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
   for(const record of this.#grants.values())if(record.grant.hostId===this.#deviceId&&record.grant.reconnect){try{await this.#post('/v1/grants/restore',{record});}catch(error){if(error.message!=='grant-revoked')throw error;current();this.#revoked.add(record.grant.id);this.#grants.delete(record.grant.id);this.#sessions.delete(record.grant.id);await this.#store.set('grants',this.grants);current();this.#emit({type:'grant-revoked',grantId:record.grant.id});}}
   const {ticket}=await this.#post('/v1/socket-ticket',{});current();
   await new Promise((resolve,reject)=>{
    const ws=new this.#WebSocket(this.#base.replace(/^http/,'ws')+'/v1/ws',['devicebridge.v1','ticket.'+ticket]);this.#socket=ws;
    const timeout=setTimeout(()=>{ws.close();reject(Error('Connection service timed out'));},15000);
    const fail=()=>{clearTimeout(timeout);reject(Error('Connection service disconnected'));};
    ws.addEventListener('error',fail,{once:true});ws.addEventListener('close',()=>{fail();if(generation!==this.#generation)return;this.#clearInterval(this.#heartbeat);this.#emit({type:'status',status:'service-offline'});});
    ws.addEventListener('message',event=>{this.#queue=this.#queue.then(async()=>{
     if(generation!==this.#generation||this.#socket!==ws)return;
     this.#lastSocketMessage=this.#now();const data=JSON.parse(event.data);if(data.type==='ready'){if(data.deviceId!==this.#deviceId)throw Error('Socket identity mismatch');clearTimeout(timeout);resolve();return;}
     await this.#process(data,generation);
    }).catch(error=>{if(generation===this.#generation)this.#emit({type:'error',message:error.message});});});
   });current();
   this.#lastSocketMessage=this.#now();this.#heartbeat=this.#interval(()=>{if(!this.connected)return;if(this.#now()-this.#lastSocketMessage>60000){this.#socket.close(4000,'heartbeat-timeout');return;}this.#socket.send(JSON.stringify({type:'heartbeat'}));},20000);this.#heartbeat.unref?.();
   this.#emit({type:'status',status:'service-connected'});
   const requests=await this.#http('/v1/requests');for(const request of requests.requests){this.#requests.set(request.requestId,request);if(request.hostId===this.#deviceId&&request.status==='pending')this.#emit({type:'pairing-request',request});}
   // Server listings never silently grant new trust. Only locally approved records persist.
   const remote=await this.#http('/v1/grants');for(const record of remote.grants){const saved=this.#grants.get(record.grant.id);if(saved&&canonical(saved.grant)===canonical(record.grant))await this.#knownGrant(record);}
  })().catch(error=>{if(generation===this.#generation){this.#clearInterval(this.#heartbeat);this.#socket?.close();this.#emit({type:'status',status:'service-offline'});}throw error;}).finally(()=>{if(generation===this.#generation)this.#starting=null;});
  return this.#starting;
 }
 async #process(event,generation){
  const emit=()=>{this.#current(generation);this.#emit(event);};this.#current(generation);
  if(event.type==='pairing-request'){this.#requests.set(event.request.requestId,event.request);emit();return;}
  if(event.type==='grant-approved'){
   let request=this.#requests.get(event.record?.grant?.requestId);
   if(!request&&this.#pairingOperation){try{await this.#pairingOperation;}catch{}this.#current(generation);request=this.#requests.get(event.record?.grant?.requestId);}if(!request||request.hostKey!==event.record.hostKey||request.controllerKey!==event.record.controllerKey)throw Error('Unrequested grant rejected');
   await this.#saveGrant(event.record,generation);emit();return;
  }
  if(event.type==='grant-revoked'){this.#revoked.add(event.grantId);this.#grants.delete(event.grantId);this.#sessions.delete(event.grantId);await this.#store.set('grants',this.grants);emit();return;}
  if(event.type==='grant-restored'){
   const saved=this.#grants.get(event.record?.grant?.id);if(!saved||canonical(saved.grant)!==canonical(event.record.grant))throw Error('Unknown restored grant');await this.#knownGrant(event.record);emit();return;
  }
  if(event.type==='control'){
   // This private record was signature-verified on save/load. Recheck its
   // current trust and expiry without a native signature RPC per pointer.
   const frame=validateTcpFrame(event.frame),record=this.#grants.get(frame.grantId);if(!record)throw Error('Untrusted TCP control');this.#trusted(record,generation);const g=record.grant,state=this.#sessions.get(g.id),other=this.#deviceId===g.hostId?g.controllerId:g.hostId;
   if(frame.to!==this.#deviceId||frame.from!==other||state?.id!==frame.sessionId||state.generation!==frame.generation||!g.permissions.includes('input'))throw Error('Wrong TCP control session');emit();return;
  }
  if(event.type==='signal'){

   const signed=event.signed,record=this.#grants.get(signed?.grantId);if(!record)throw Error('Untrusted signal');await this.#knownGrant(record);
   const {signature,...content}=signed,g=record.grant,peer=this.#deviceId===g.hostId?g.controllerId:g.hostId,key=peer===g.hostId?record.hostKey:record.controllerKey;
   if(content.to!==this.#deviceId||content.from!==peer||!await verifyValue(key,'signal',content,signature))throw Error('Signal identity mismatch');validateMessage(content.message);if(content.message.kind!=='signal')throw Error('Invalid signaling payload');
   this.#trusted(record,generation);this.#acceptSignal(g,content.message,content.from);emit();return;
  }
  if(['presence','pairing-rejected','error','heartbeat-ack','signal-accepted'].includes(event.type))emit();
 }
 #acceptSignal(grant,message,from){
  let state=this.#sessions.get(grant.id);
  if(!state||state.id!==message.sessionId||state.generation!==message.generation){
   if(from!==grant.controllerId||message.payload.type!=='offer'||(state&&(!grant.reconnect||message.generation<=state.generation||message.sessionId===state.id)))throw Error('Stale or unrequested session');
   state={id:message.sessionId,generation:message.generation,last:new Map()};this.#sessions.set(grant.id,state);
  }
  if(message.seq<=(state.last.get(from)??-1))throw Error('Replayed signal');state.last.set(from,message.seq);
 }
 async sessionAvailable(grantId,sessionId,generation){
  const record=this.#grants.get(grantId);if(!record)return false;const epoch=this.#generation;this.#trusted(record,epoch);
  const result=await this.#http('/v1/sessions/'+grantId);this.#trusted(record,epoch);
  return result.active===true&&result.sessionId===sessionId&&result.generation===generation;
 }
 async createPairing({permissions=['view','input'],reconnect=false}={}){return this.#post('/v1/pairings',{permissions,reconnect});}
 async requestPairing(code){
  if(this.#pairingOperation)throw Error('A pairing request is already waiting');const generation=this.#generation;
  const operation=this.#post('/v1/requests',{code:code.trim().toUpperCase()}).then(request=>{this.#current(generation);this.#requests.set(request.requestId,request);return request;});this.#pairingOperation=operation;
  try{return await operation;}finally{if(this.#pairingOperation===operation)this.#pairingOperation=null;}
 }
 async approveRequest(request,{permissions=request.permissions,reconnect=request.reconnect,expiresAt=Date.now()+86400000}={}){
  const generation=this.#generation;if(request.hostId!==this.#deviceId)throw Error('This computer cannot approve that request');
  this.#requests.set(request.requestId,request);const grant={version:1,id:id(),requestId:request.requestId,hostId:request.hostId,controllerId:request.controllerId,permissions,reconnect,revision:1,expiresAt};
  const signature=await this.#sign('grant',grant);this.#current(generation);const record=await this.#post('/v1/requests/'+request.requestId+'/approve',{grant,signature});await this.#saveGrant(record,generation);return record;
 }
 async rejectRequest(requestId){return this.#post('/v1/requests/'+requestId+'/reject',{});}
 async revoke(grantId){this.#revoked.add(grantId);this.#grants.delete(grantId);this.#sessions.delete(grantId);await this.#store.set('grants',this.grants);this.#emit({type:'grant-revoked',grantId});await this.#post('/v1/grants/'+grantId+'/revoke',{});}
 async forget(grantId){
  const record=this.#grants.get(grantId);if(!record||record.grant.controllerId!==this.#deviceId)throw Error('Only this phone can remove its saved computer');
  this.#revoked.add(grantId);this.#grants.delete(grantId);this.#sessions.delete(grantId);
  try{await this.#store.set('grants',this.grants);}catch{this.#emit({type:'grant-revoked',grantId});this.stop();throw Error('Sharing stopped, but this phone could not save the removal. Restart the app and remove the PC again.');}this.#emit({type:'grant-revoked',grantId});
  try{await this.#post('/v1/grants/'+grantId+'/leave',{});return {removed:true,computerNotified:true};}catch{return {removed:true,computerNotified:false};}
 }
 async sendSignal(grantId,message){
  const generation=this.#generation,record=this.#grants.get(grantId);if(!record||!this.connected)throw Error('No active trusted connection');await this.#knownGrant(record);this.#trusted(record,generation);validateMessage(message);if(message.kind!=='signal')throw Error('Invalid signal');
  const g=record.grant,content={grantId,from:this.#deviceId,to:this.#deviceId===g.hostId?g.controllerId:g.hostId,message};
  this.#acceptSignal(g,message,this.#deviceId);const signature=await this.#sign('signal',content);this.#trusted(record,generation);if(!this.connected)throw Error('Service disconnected');this.#socket.send(JSON.stringify({type:'signal',signed:{...content,signature}}));
 }
 sendControl(frame){
  validateTcpFrame(frame);const generation=this.#generation,record=this.#grants.get(frame.grantId);if(!record||!this.connected)throw Error('Control service disconnected');this.#trusted(record,generation);const g=record.grant,state=this.#sessions.get(g.id),other=this.#deviceId===g.hostId?g.controllerId:g.hostId;
  if(frame.from!==this.#deviceId||frame.to!==other||state?.id!==frame.sessionId||state.generation!==frame.generation||!g.permissions.includes('input'))throw Error('Control is not authorized');
  if(this.#socket.bufferedAmount>128*1024)throw Error('Control connection is congested');this.#socket.send(JSON.stringify({type:'control',frame}));
 }
 stop(){this.#generation++;this.#starting=null;this.#pairingOperation=null;this.#stopper?.abort();this.#clearInterval(this.#heartbeat);this.#socket?.close();this.#socket=null;this.#token=null;this.#emit({type:'status',status:'stopped'});}
}
