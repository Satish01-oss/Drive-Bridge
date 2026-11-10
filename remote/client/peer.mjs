import {validateMessage,validateInput,encodeMessage,decodeMessage,SessionGate} from '../core/protocol.mjs';
import {toBase64Url} from '../shared/signatures.mjs';
const randomId=()=>toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
export class RemotePeer{
 #failure=null;
 #receivedSignals=0;
 #client;#record;#role;#pc;#channel;#resources;#acquire;#event;#unsubscribe;#sessionId;#generation;#outgoing=Promise.resolve();#incoming=Promise.resolve();#signalSeq=0;#dataSeq=0;#gate;#closed=false;#ready=false;#permissions=[];#candidates=[];#remoteCount=0;#heartbeat;#deadline;#lastData=Date.now();#microphone;#localMicrophone;
 constructor({client,record,role,acquireHost,event=()=>{},iceServers=[{urls:'stun:stun.cloudflare.com:3478'}],PeerConnection=RTCPeerConnection}){
  if(!['host','controller'].includes(role))throw Error('Invalid role');const g=record.grant;if(client.deviceId!==(role==='host'?g.hostId:g.controllerId))throw Error('Wrong device role');
  this.#client=client;this.#record=record;this.#role=role;this.#acquire=acquireHost;this.#event=event;this.#pc=new PeerConnection({iceServers});
  this.#pc.onicecandidate=e=>{if(e.candidate)this.#signal('candidate',JSON.stringify(e.candidate.toJSON()));};
  this.#pc.onconnectionstatechange=()=>{event({type:'transport',state:this.#pc.connectionState});if(['failed','closed'].includes(this.#pc.connectionState))this.close('transport-failed');};
  this.#pc.ontrack=e=>{
   const allowed=this.#role==='controller'?(e.track.kind==='video'?'view':'speaker'):'microphone';
   if(this.#role==='host'&&e.track.kind!=='audio'||!g.permissions.includes(allowed)){e.track.stop();return;}
   if(this.#role==='host'){this.#resources?.receiveMicrophone?.(e.track);}else event({type:'track',track:e.track});
  };
  this.#pc.ondatachannel=e=>{if(this.#role!=='host'||e.channel.label!=='control'||this.#channel){e.channel.close();return;}this.#bindChannel(e.channel);};
  this.#unsubscribe=client.subscribe(e=>{
   if(e.type==='grant-revoked'&&e.grantId===g.id)this.close('revoked');
   if(e.type==='signal'&&e.signed.grantId===g.id){
    if(++this.#remoteCount>128){this.close('signal-overflow');return;}
    this.#incoming=this.#incoming.then(()=>this.#receiveSignal(e.signed.message)).catch(error=>this.#fail(error.message)).finally(()=>this.#remoteCount--);
   }
  });
  this.#deadline=setTimeout(()=>{if(!this.#ready)this.#fail('The direct connection could not finish. This network may require a relay.');},45000);
 }
 get ready(){return this.#ready&&!this.#closed;}
 get display(){return this.displayInfo;}
 get permissions(){return [...this.#permissions];}
 async diagnostics(){
  const report={ready:this.ready,connection:this.#pc.connectionState||'unknown',ice:this.#pc.iceConnectionState||'unknown',gathering:this.#pc.iceGatheringState||'unknown',signaling:this.#pc.signalingState||'unknown',control:this.#channel?.readyState||'none',outgoingSignals:this.#signalSeq,incomingSignals:this.#receivedSignals,videoFramesReceived:0,videoFramesDecoded:0,videoFramesEncoded:0};
  try{const stats=await this.#pc.getStats();for(const row of stats.values()){
   if(row.type==='inbound-rtp'&&(row.kind==='video'||row.mediaType==='video')){report.videoFramesReceived+=row.framesReceived||0;report.videoFramesDecoded+=row.framesDecoded||0;}
   if(row.type==='outbound-rtp'&&(row.kind==='video'||row.mediaType==='video'))report.videoFramesEncoded+=row.framesEncoded||0;
  }}catch{}
  return report;
 }
 #fail(message){if(this.#closed)return;this.#failure=message;this.#event({type:'error',message});this.close('transport-failed');}
 acceptInitialOffer(message){this.#incoming=this.#incoming.then(()=>this.#receiveSignal(message)).catch(error=>this.#fail(error.message));}
 async begin({generation=Date.now()}={}){
  if(this.#role!=='controller'||this.#sessionId)throw Error('Only the controller can start a session');
  this.#sessionId=randomId();this.#generation=generation;
  this.#pc.addTransceiver('video',{direction:'recvonly'});const audio=this.#pc.addTransceiver('audio',{direction:'sendrecv'});this.#microphone=audio.sender;
  this.#bindChannel(this.#pc.createDataChannel('control',{ordered:true}));
  const offer=await this.#pc.createOffer();if(this.#closed)return;await this.#pc.setLocalDescription(offer);await this.#signal('offer',offer.sdp);
 }
 #signal(type,data){
  // ICE callbacks may run before setLocalDescription returns: reserve offer seq=0.
  if(!this.#sessionId||this.#closed)return Promise.resolve();
  if(type==='candidate'&&!this.#signalStarted){this.pendingLocal??=[];if(this.pendingLocal.length>=64){this.close('signal-overflow');return Promise.resolve();}this.pendingLocal.push(data);return Promise.resolve();}
  this.#signalStarted=true;const message={protocol:'devicebridge.remote',version:1,kind:'signal',sessionId:this.#sessionId,generation:this.#generation,seq:this.#signalSeq++,payload:{type,data}};
  const send=this.#outgoing=this.#outgoing.then(()=>{if(!this.#closed)return this.#client.sendSignal(this.#record.grant.id,message);});
  send.catch(error=>this.#fail(error.message));
  if(type!=='candidate'){const pending=this.pendingLocal||[];this.pendingLocal=[];for(const candidate of pending)this.#signal('candidate',candidate);}
  return send;
 }
 #signalStarted=false;
 async #receiveSignal(message){
  if(this.#closed)return;validateMessage(message);this.#receivedSignals++;const {type,data}=message.payload;
  if(type==='offer'){
   if(this.#role!=='host'||this.#sessionId)throw Error('Unexpected offer');this.#sessionId=message.sessionId;this.#generation=message.generation;
   this.#resources=await this.#acquire(this.#record.grant);if(this.#closed){this.#resources?.dispose?.();return;}
   if(!this.#resources?.videoTrack||!this.#resources.display)throw Error('Screen capture unavailable');
   await this.#pc.setRemoteDescription({type:'offer',sdp:data});
   this.#pc.addTrack(this.#resources.videoTrack,new MediaStream([this.#resources.videoTrack]));
   if(this.#record.grant.permissions.includes('speaker')&&this.#resources.audioTrack)this.#pc.addTrack(this.#resources.audioTrack,new MediaStream([this.#resources.audioTrack]));
   const answer=await this.#pc.createAnswer();if(this.#closed)return;await this.#pc.setLocalDescription(answer);await this.#signal('answer',answer.sdp);
  }else if(type==='answer'){
   if(this.#role!=='controller'||message.sessionId!==this.#sessionId||message.generation!==this.#generation)throw Error('Unexpected answer');await this.#pc.setRemoteDescription({type:'answer',sdp:data});
  }else if(type==='candidate'){
   if(message.sessionId!==this.#sessionId||message.generation!==this.#generation)throw Error('Wrong candidate session');const candidate=JSON.parse(data);if(!this.#pc.remoteDescription){if(this.#candidates.length>=64)throw Error('Too many candidates');this.#candidates.push(candidate);}else await this.#pc.addIceCandidate(candidate);
  }
  if(this.#pc.remoteDescription)for(const candidate of this.#candidates.splice(0))await this.#pc.addIceCandidate(candidate);
 }
 #send(kind,payload){if(this.#closed||this.#channel?.readyState!=='open')return false;if(this.#channel.bufferedAmount>128*1024){this.close('transport-failed');return false;}this.#channel.send(encodeMessage({protocol:'devicebridge.remote',version:1,kind,sessionId:this.#sessionId,generation:this.#generation,seq:this.#dataSeq++,payload}));return true;}
 #bindChannel(channel){
  this.#channel=channel;channel.onclose=()=>this.close('transport-failed');channel.onerror=()=>this.close('transport-failed');
  channel.onopen=()=>{
   if(this.#closed){channel.close();return;}if(this.#role==='controller')this.#send('session.open',{deviceId:this.#client.deviceId,grantId:this.#record.grant.id,permissionRevision:this.#record.grant.revision,permissions:this.#record.grant.permissions});
  };
  channel.onmessage=e=>{
   try{
    const m=decodeMessage(e.data),g=this.#record.grant;if(m.sessionId!==this.#sessionId||m.generation!==this.#generation||g.expiresAt<=Date.now())throw Error('Session mismatch or expired grant');
    if(!this.#ready){
     if(this.#role==='host'){
      if(m.kind!=='session.open'||m.seq!==0||m.payload.deviceId!==g.controllerId||m.payload.grantId!==g.id||m.payload.permissionRevision!==g.revision||m.payload.permissions.some(p=>!g.permissions.includes(p)))throw Error('Control permission rejected');
      this.#permissions=m.payload.permissions.filter(p=>(this.#resources.permissions||g.permissions).includes(p));this.displayInfo=this.#resources.display;this.#send('session.ready',{permissions:this.#permissions,permissionRevision:g.revision,display:this.displayInfo});
     }else{
      if(m.kind!=='session.ready'||m.seq!==0||m.payload.permissionRevision!==g.revision||!m.payload.display||m.payload.permissions.some(p=>!g.permissions.includes(p)))throw Error('Unexpected control acceptance');this.#permissions=[...m.payload.permissions];this.displayInfo=m.payload.display;
     }
     this.#gate=new SessionGate({sessionId:this.#sessionId,generation:this.#generation,permissions:this.#permissions});this.#ready=true;clearTimeout(this.#deadline);this.#lastData=Date.now();
     this.#heartbeat=setInterval(()=>{if(g.expiresAt<=Date.now()||Date.now()-this.#lastData>45000){this.close('expired');return;}this.#send('heartbeat',{nonce:randomId()});},15000);this.#heartbeat.unref?.();this.#event({type:'ready',permissions:this.#permissions,display:this.displayInfo});return;
    }
    if(!this.#gate.accept(m))throw Error('Stale or unauthorized data');this.#lastData=Date.now();
    if(m.kind==='session.stop'){this.close(m.payload.reason);return;}
    if(m.kind==='input'){
     if(this.#role!=='host')throw Error('Controller cannot receive input');if(m.payload.type==='pointer'&&m.payload.point.displayId!==this.displayInfo.id)throw Error('Wrong display');this.#resources.applyInput?.(m.payload);
    }
   }catch(error){this.#fail(error.message);}
  };
 }
 sendInput(input){validateInput(input);if(!this.ready||this.#role!=='controller'||!this.#permissions.includes('input'))return false;return this.#send('input',input);}
 async microphone(enabled){
  if(this.#role!=='controller'||!this.ready||!this.#permissions.includes('microphone'))throw Error('Microphone is not permitted');
  if(!enabled){await this.#microphone.replaceTrack(null);this.#localMicrophone?.getTracks().forEach(t=>t.stop());this.#localMicrophone=null;return;}
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  if(!this.ready){stream.getTracks().forEach(t=>t.stop());return;}this.#localMicrophone=stream;await this.#microphone.replaceTrack(stream.getAudioTracks()[0]);
 }
 close(reason='user'){
  if(this.#closed)return;if(this.#channel?.bufferedAmount<=128*1024)this.#send('session.stop',{reason:['user','revoked','expired','shutdown','permission-changed','transport-failed'].includes(reason)?reason:'transport-failed'});this.#closed=true;this.#ready=false;
  clearTimeout(this.#deadline);clearInterval(this.#heartbeat);this.#unsubscribe?.();this.#gate?.close();this.#channel?.close();this.#pc.close();this.#localMicrophone?.getTracks().forEach(t=>t.stop());
    try{this.#resources?.releaseInput?.();}finally{this.#resources?.dispose?.();this.#event({type:'closed',reason,message:this.#failure});}
 }
}
