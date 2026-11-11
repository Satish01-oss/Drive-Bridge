import {validateTcpFrame} from '../core/tcp-frame.mjs';
import {EventEmitter} from 'node:events';
import {randomInt} from 'node:crypto';
import {randomId,digest,publicIdentity,verifiedSignature} from './identity.mjs';
import {PERMISSIONS,validateMessage} from '../core/protocol.mjs';
export class ServiceError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const deny=(condition,code,status=400)=>{if(!condition)throw new ServiceError(code,status);};
const permissions=p=>Array.isArray(p)&&p.length>0&&p.includes('view')&&new Set(p).size===p.length&&p.every(x=>PERMISSIONS.includes(x));
export function exact(value,keys){deny(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k)),'invalid-fields');}
const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export class Broker extends EventEmitter{
 #now; #challenges=new Map(); #auth=new Map(); #tickets=new Map(); #pairings=new Map(); #requests=new Map(); #grants=new Map(); #revoked=new Map(); #restoresDisabled=false; #sessions=new Map(); #rates=new Map();
 constructor({now=()=>Date.now(),capacity=5000}={}){super();this.#now=now;this.capacity=capacity;}
 #prune(){const now=this.#now();for(const map of [this.#challenges,this.#auth,this.#tickets,this.#pairings,this.#requests,this.#grants,this.#revoked,this.#rates])for(const [id,row]of map)if(row.expiresAt<=now){map.delete(id);if(map===this.#grants)this.#sessions.delete(id);}}
 #room(map){this.#prune();deny(map.size<this.capacity,'capacity-reached',503);}
 limit(key,max=30){this.#prune();let row=this.#rates.get(key);if(!row){this.#room(this.#rates);this.#rates.set(key,row={count:0,expiresAt:this.#now()+60000});}deny(++row.count<=max,'rate-limited',429);}
 challenge(publicKey){
  let identity;try{identity=publicIdentity(publicKey);}catch{throw new ServiceError('invalid-public-key');}
  this.limit('auth:'+identity.id,10);this.#room(this.#challenges);
  const challenge={challengeId:randomId(),nonce:randomId(),deviceId:identity.id,expiresAt:this.#now()+60000};
  this.#challenges.set(challenge.challengeId,{...challenge,publicKey});return challenge;
 }
 authenticate(challengeId,signature){
  this.#prune();const row=this.#challenges.get(challengeId);this.#challenges.delete(challengeId);
  deny(row,'authentication-failed',401);const {publicKey,...challenge}=row;
  deny(verifiedSignature(publicKey,'auth',challenge,signature),'authentication-failed',401);this.#room(this.#auth);
  const token=randomId(),expiresAt=this.#now()+30*60000;this.#auth.set(digest(token),{deviceId:row.deviceId,publicKey,expiresAt});
  return {token,deviceId:row.deviceId,expiresAt};
 }
 authorize(token){this.#prune();deny(typeof token==='string'&&token.length<=128,'unauthorized',401);const auth=this.#auth.get(digest(token));deny(auth,'unauthorized',401);return {...auth};}
 socketTicket(auth){this.#room(this.#tickets);const ticket=randomId(),expiresAt=Math.min(auth.expiresAt,this.#now()+30000);this.#tickets.set(digest(ticket),{...auth,authExpiresAt:auth.expiresAt,expiresAt});return {ticket,expiresAt};}
 consumeTicket(ticket){this.#prune();deny(typeof ticket==='string'&&ticket.length<=128,'unauthorized',401);const row=this.#tickets.get(digest(ticket));this.#tickets.delete(digest(ticket));deny(row,'unauthorized',401);return {...row,expiresAt:row.authExpiresAt};}
 createPairing(auth,{permissions:requested,reconnect}){
  deny(permissions(requested)&&typeof reconnect==='boolean','invalid-pairing');this.limit('pair-create:'+auth.deviceId,10);this.#room(this.#pairings);
  for(const [code,p]of this.#pairings)if(p.hostId===auth.deviceId)this.#pairings.delete(code);
  for(const request of this.#requests.values())if(request.hostId===auth.deviceId&&request.status==='pending')request.status='rejected';
  let code;do{code=Array.from({length:6},()=>alphabet[randomInt(alphabet.length)]).join('');}while(this.#pairings.has(code));
  const row={hostId:auth.deviceId,hostKey:auth.publicKey,permissions:[...requested],reconnect,expiresAt:this.#now()+120000};this.#pairings.set(code,row);
  return {code,hostId:auth.deviceId,hostKey:auth.publicKey,expiresAt:row.expiresAt};
 }
 requestPairing(auth,code){
  this.limit('pair-try:'+auth.deviceId,5);deny(typeof code==='string'&&/^[2-9A-HJ-NP-Z]{6}$/.test(code),'pairing-unavailable',404);this.#prune();
  const p=this.#pairings.get(code);deny(p&&p.hostId!==auth.deviceId,'pairing-unavailable',404);
  deny([...this.#requests.values()].filter(r=>r.status==='pending'&&r.hostId===p.hostId).length<5,'pairing-busy',429);this.#room(this.#requests);
  const request={requestId:randomId(),hostId:p.hostId,hostKey:p.hostKey,controllerId:auth.deviceId,controllerKey:auth.publicKey,permissions:[...p.permissions],reconnect:p.reconnect,expiresAt:this.#now()+300000,status:'pending',code};
  this.#requests.set(request.requestId,request);this.emit('device',p.hostId,{type:'pairing-request',request:this.#publicRequest(request)});return this.#publicRequest(request);
 }
 #publicRequest({code,...request}){return structuredClone(request);}
 requests(auth){this.#prune();return [...this.#requests.values()].filter(r=>r.hostId===auth.deviceId||r.controllerId===auth.deviceId).map(r=>this.#publicRequest(r));}
 approve(auth,requestId,grant,signature){
  this.#prune();const r=this.#requests.get(requestId);deny(r&&r.status==='pending'&&r.hostId===auth.deviceId,'request-unavailable',404);
  exact(grant,['version','id','requestId','hostId','controllerId','permissions','reconnect','revision','expiresAt']);
  deny(grant.version===1&&typeof grant.id==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(grant.id)&&!this.#grants.has(grant.id)&&grant.requestId===requestId&&grant.hostId===r.hostId&&grant.controllerId===r.controllerId&&grant.revision===1&&permissions(grant.permissions)&&grant.permissions.every(p=>r.permissions.includes(p))&&typeof grant.reconnect==='boolean'&&(!grant.reconnect||r.reconnect)&&Number.isSafeInteger(grant.expiresAt)&&grant.expiresAt>this.#now()&&grant.expiresAt<=this.#now()+7*86400000,'invalid-grant');
  deny(verifiedSignature(auth.publicKey,'grant',grant,signature),'invalid-signature',401);this.#room(this.#grants);
  const saved={grant:structuredClone(grant),signature,hostKey:r.hostKey,controllerKey:r.controllerKey,expiresAt:grant.expiresAt};this.#grants.set(grant.id,saved);
  for(const pending of this.#requests.values())if(pending.hostId===r.hostId&&pending.code===r.code)pending.status=pending===r?'approved':'rejected';
  if(this.#pairings.get(r.code)?.hostId===r.hostId)this.#pairings.delete(r.code);
  for(const id of [r.hostId,r.controllerId])this.emit('device',id,{type:'grant-approved',record:structuredClone(saved)});return structuredClone(saved);
 }
 reject(auth,requestId){const r=this.#requests.get(requestId);deny(r&&r.hostId===auth.deviceId&&r.status==='pending','request-unavailable',404);r.status='rejected';this.emit('device',r.controllerId,{type:'pairing-rejected',requestId});return {rejected:true};}
 grants(auth){this.#prune();return [...this.#grants.values()].filter(r=>[r.grant.hostId,r.grant.controllerId].includes(auth.deviceId)).map(r=>structuredClone(r));}
 revoke(auth,grantId){const r=this.#grants.get(grantId);deny(r&&r.grant.hostId===auth.deviceId,'grant-unavailable',404);this.#prune();if(this.#revoked.size>=this.capacity)this.#restoresDisabled=true;else this.#revoked.set(grantId,{expiresAt:r.expiresAt});this.#grants.delete(grantId);this.#sessions.delete(grantId);for(const id of [r.grant.hostId,r.grant.controllerId])this.emit('device',id,{type:'grant-revoked',grantId});return {revoked:true};}
 leave(auth,grantId){const r=this.#grants.get(grantId);deny(r&&r.grant.controllerId===auth.deviceId,'grant-unavailable',404);this.#prune();if(this.#revoked.size>=this.capacity)this.#restoresDisabled=true;else this.#revoked.set(grantId,{expiresAt:r.expiresAt});this.#grants.delete(grantId);this.#sessions.delete(grantId);for(const id of [r.grant.hostId,r.grant.controllerId])this.emit('device',id,{type:'grant-revoked',grantId});return {removed:true};}
 restore(auth,record){
  this.#prune();exact(record,['grant','signature','hostKey','controllerKey','expiresAt']);const g=record.grant;exact(g,['version','id','requestId','hostId','controllerId','permissions','reconnect','revision','expiresAt']);
  deny(!this.#restoresDisabled&&!this.#revoked.has(g.id),'grant-revoked',403);
  deny(record.hostKey===auth.publicKey&&g.hostId===auth.deviceId&&g.controllerId!==auth.deviceId,'host-restore-only',403);
  let controller;try{controller=publicIdentity(record.controllerKey);}catch{throw new ServiceError('invalid-controller');}
  deny(g.version===1&&typeof g.id==='string'&&/^[A-Za-z0-9_-]{16,96}$/.test(g.id)&&g.controllerId===controller.id&&g.reconnect===true&&Number.isSafeInteger(g.revision)&&g.revision>=1&&permissions(g.permissions)&&Number.isSafeInteger(g.expiresAt)&&g.expiresAt>this.#now()&&g.expiresAt<=this.#now()+7*86400000,'invalid-restore');
  deny(verifiedSignature(auth.publicKey,'grant',g,record.signature),'invalid-signature',401);
  const existing=this.#grants.get(g.id);if(existing){deny(existing.signature===record.signature,'grant-conflict',409);return structuredClone(existing);}
  this.#room(this.#grants);const saved={grant:structuredClone(g),signature:record.signature,hostKey:record.hostKey,controllerKey:record.controllerKey,expiresAt:g.expiresAt};this.#grants.set(g.id,saved);
  for(const id of [g.hostId,g.controllerId])this.emit('device',id,{type:'grant-restored',record:structuredClone(saved)});return structuredClone(saved);
 }
 peers(auth){return this.grants(auth).map(r=>r.grant.hostId===auth.deviceId?r.grant.controllerId:r.grant.hostId);}
 session(auth,grantId){
  this.#prune();const g=this.#grants.get(grantId)?.grant;deny(g&&[g.hostId,g.controllerId].includes(auth.deviceId),'grant-unavailable',403);
  const s=this.#sessions.get(grantId);return s?{active:true,sessionId:s.id,generation:s.generation}:{active:false};
 }
 forward(auth,signed){
  exact(signed,['grantId','from','to','message','signature']);const {signature,...content}=signed;this.#prune();const record=this.#grants.get(content.grantId);deny(record,'grant-unavailable',403);
  const g=record.grant;deny(content.from===auth.deviceId&&[g.hostId,g.controllerId].includes(content.from)&&content.to===(content.from===g.hostId?g.controllerId:g.hostId),'forbidden',403);
  deny(verifiedSignature(auth.publicKey,'signal',content,signature),'invalid-signature',401);
  try{validateMessage(content.message);}catch{throw new ServiceError('invalid-signal');}const m=content.message;deny(m.kind==='signal','invalid-signal');this.limit('signal:'+auth.deviceId,600);
  let session=this.#sessions.get(g.id);
  if(!session||session.id!==m.sessionId||session.generation!==m.generation){
   deny(content.from===g.controllerId&&m.payload.type==='offer'&&(!session||(g.reconnect&&m.generation>session.generation&&m.sessionId!==session.id)),'session-rejected',403);
   session={id:m.sessionId,generation:m.generation,last:new Map()};this.#sessions.set(g.id,session);
  }
  deny(m.seq>(session.last.get(content.from)??-1),'replayed-signal',409);session.last.set(content.from,m.seq);
  this.emit('device',content.to,{type:'signal',signed:structuredClone(signed)});return {forwarded:true};
 }
 forwardControl(auth,frame){
  this.#prune();try{validateTcpFrame(frame);}catch{throw new ServiceError('invalid-control');}
  const record=this.#grants.get(frame.grantId),g=record?.grant;deny(g&&frame.from===auth.deviceId&&[g.hostId,g.controllerId].includes(frame.from)&&frame.to===(frame.from===g.hostId?g.controllerId:g.hostId)&&g.permissions.includes('input'),'control-not-authorized',403);
  const session=this.#sessions.get(g.id);deny(session&&session.id===frame.sessionId&&session.generation===frame.generation,'session-rejected',403);
  this.limit('control:'+auth.deviceId,9000);session.controlLast??=new Map();deny(frame.seq>(session.controlLast.get(frame.from)??-1),'replayed-control',409);session.controlLast.set(frame.from,frame.seq);
  this.emit('device',frame.to,{type:'control',frame:structuredClone(frame)});return{forwarded:true};
 }

}
