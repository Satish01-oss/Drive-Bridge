import {AdaptiveVideo,videoNetworkSample} from './video-quality.mjs';
import {TcpControlCipher} from './tcp-control.mjs';
import {validateMessage,validateInput,encodeMessage,decodeMessage,SessionGate} from '../core/protocol.mjs';
import {toBase64Url} from '../shared/signatures.mjs';
const randomId=()=>toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
export class RemotePeer{
 #holds=new Set();#holdTimer;#holdTimeout;#holdCancel;#holdDelay;#lastIncident=null;#serviceCheck=0;
 #failure=null;
 #quality;#videoSender;
 #pendingPointer=null;#pointerTimer;
 #incomingControlCount=0;#tcp;#announced=false;#opened=false;#controlQueue=Promise.resolve();#controlIncoming=Promise.resolve();#controlRequests=new Set();#controlPending=new Map();#controlAcks=0;#controlsAccepted=0;
 #closing=false;#cleanupErrors=[];
 #getUserMedia;#now;#interval;#clearInterval;#microphoneGeneration=0;
 #receivedSignals=0;
 #client;#record;#role;#pc;#channel;#resources;#acquire;#event;#unsubscribe;#sessionId;#generation;#outgoing=Promise.resolve();#incoming=Promise.resolve();#signalSeq=0;#dataSeq=0;#gate;#closed=false;#ready=false;#permissions=[];#candidates=[];#remoteCount=0;#heartbeat;#deadline;#lastData=Date.now();#microphone;#localMicrophone;
 constructor({client,record,role,acquireHost,event=()=>{},iceServers=[{urls:'stun:stun.cloudflare.com:3478'}],PeerConnection=RTCPeerConnection,now=()=>Date.now(),interval=setInterval,cancelInterval=clearInterval,recoveryDelay=8000,recoveryTimeout=setTimeout,cancelRecoveryTimeout=clearTimeout,getUserMedia=options=>navigator.mediaDevices.getUserMedia(options)}){
  this.#holdDelay=recoveryDelay;this.#holdTimeout=recoveryTimeout.bind(globalThis);this.#holdCancel=cancelRecoveryTimeout.bind(globalThis);
  this.#getUserMedia=getUserMedia;this.#now=now;this.#interval=interval.bind(globalThis);this.#clearInterval=cancelInterval.bind(globalThis);
  if(!['host','controller'].includes(role))throw Error('Invalid role');const g=record.grant;if(client.deviceId!==(role==='host'?g.hostId:g.controllerId))throw Error('Wrong device role');
  this.#client=client;this.#record=record;this.#role=role;this.#acquire=acquireHost;this.#event=event;this.#pc=new PeerConnection({iceServers});
  this.#pc.onicecandidate=e=>{if(e.candidate&&(!e.candidate.protocol||e.candidate.protocol.toLowerCase()==='udp'))this.#signal('candidate',JSON.stringify(e.candidate.toJSON()));};
  this.#pc.onconnectionstatechange=()=>{event({type:'transport',state:this.#pc.connectionState});if(['failed','closed'].includes(this.#pc.connectionState))this.#fail('The UDP screen connection failed. Restoring a fresh secure session.');};
  this.#pc.ontrack=e=>{
   const allowed=this.#role==='controller'?(e.track.kind==='video'?'view':'speaker'):'microphone';
   if(this.#role==='host'&&e.track.kind!=='audio'||!g.permissions.includes(allowed)){e.track.stop();return;}
   if(this.#role==='host'){this.#resources?.receiveMicrophone?.(e.track);}else event({type:'track',track:e.track});
  };
  this.#pc.ondatachannel=e=>{if(this.#role!=='host'||e.channel.label!=='control'||this.#channel){e.channel.close();return;}this.#bindChannel(e.channel);};
  this.#unsubscribe=client.subscribe(e=>{
   if(e.type==='presence'&&e.deviceId===(this.#role==='host'?g.controllerId:g.hostId)){if(e.online)this.#releaseHold('presence');else this.#hold('presence','The other device is restoring its connection service.');}
   if(e.type==='status'&&e.status==='service-offline')this.#hold('service','Restoring the connection service; controls are paused.');
   if(e.type==='status'&&e.status==='service-connected'&&this.#holds.has('service'))this.#checkService();
   if(e.type==='status'&&e.status==='stopped')this.close('user');
   if(e.type==='error'&&this.#ready&&['session-rejected','control-not-authorized','grant-unavailable'].includes(e.error))this.#fail('Secure control session needs restoring: '+e.error);
   if(e.type==='control'&&e.frame.grantId===g.id){if(++this.#incomingControlCount>128){this.#fail('Control queue is full');return;}this.#controlIncoming=this.#controlIncoming.then(()=>this.#receiveControl(e.frame)).catch(error=>this.#fail(error.message)).finally(()=>this.#incomingControlCount--);}
   if(e.type==='grant-revoked'&&e.grantId===g.id)this.close('revoked');
   if(e.type==='signal'&&e.signed.grantId===g.id){
    if(++this.#remoteCount>128){this.close('signal-overflow');return;}
    this.#incoming=this.#incoming.then(()=>this.#receiveSignal(e.signed.message)).catch(error=>this.#fail(error.message)).finally(()=>this.#remoteCount--);
   }
  });
  this.#deadline=setTimeout(()=>{if(!this.#ready)this.#fail('The secure screen connection could not finish. Update both apps to preview 11 or later. This network may require a UDP relay.');},45000);
 }
 get active(){return !this.#closed;}
 get grantId(){return this.#record.grant.id;}
 get ready(){return this.#ready&&!!this.#tcp?.ready&&!this.#closed&&this.#holds.size===0;}
 get display(){return this.displayInfo;}
 get permissions(){return [...this.#permissions];}
 get approvedPermissions(){return [...this.#record.grant.permissions];}
 async diagnostics(){
  const report={ready:this.ready,recovering:this.#holds.size>0,recoveryReasons:[...this.#holds],lastIncident:this.#lastIncident,...(this.#quality?.snapshot||{}),connection:this.#pc.connectionState||'unknown',ice:this.#pc.iceConnectionState||'unknown',gathering:this.#pc.iceGatheringState||'unknown',signaling:this.#pc.signalingState||'unknown',control:this.#channel?.readyState||'none',controlTransport:this.#tcp?.ready?'tcp-wss-e2e':'negotiating',pendingControls:this.#controlRequests.size,acknowledgedControls:this.#controlAcks,acceptedControls:this.#controlsAccepted,outgoingSignals:this.#signalSeq,incomingSignals:this.#receivedSignals,videoFramesReceived:0,videoFramesDecoded:0,videoFramesEncoded:0,cleanupErrors:[...this.#cleanupErrors]};
  try{const stats=await this.#pc.getStats();report.mediaProtocol=videoNetworkSample(stats).protocol;for(const row of stats.values()){
   if(row.type==='inbound-rtp'&&(row.kind==='video'||row.mediaType==='video')){report.videoFramesReceived+=row.framesReceived||0;report.videoFramesDecoded+=row.framesDecoded||0;}
   if(row.type==='outbound-rtp'&&(row.kind==='video'||row.mediaType==='video'))report.videoFramesEncoded+=row.framesEncoded||0;
  }}catch{}
  return report;
 }
 #hold(key,message){
  if(this.#closed)return;this.#lastIncident=message;
  if(!this.#ready||this.#controlRequests.size||this.#incomingControlCount){this.#fail(message+' Unconfirmed input will not be replayed.');return;}
  if(this.#holds.has(key))return;this.#holds.add(key);
  try{this.#resources?.releaseInput?.();}catch{this.#fail('Input release failed while restoring the service.');return;}
  this.#event({type:'recovering',message});
  if(this.#holdTimer==null)this.#holdTimer=this.#holdTimeout(()=>this.#fail('Connection service did not recover in time. Restoring a fresh secure session.'),this.#holdDelay);
 }
 #releaseHold(key){
  if(this.#closed||!this.#holds.delete(key)||this.#holds.size)return;
  this.#holdCancel(this.#holdTimer);this.#holdTimer=null;
  this.#event({type:'recovered',permissions:this.#permissions});
 }
 async #checkService(){
  const check=++this.#serviceCheck;
  try{const valid=await this.#client.sessionAvailable(this.grantId,this.#sessionId,this.#generation);if(this.#closed||check!==this.#serviceCheck)return;if(valid)this.#releaseHold('service');else this.#fail('Connection service restarted. Restoring a fresh secure session.');}
  catch{if(!this.#closed&&check===this.#serviceCheck)this.#fail('The secure control session could not be restored. Reconnecting.');}
 }
 #fail(message){if(this.#closed)return;this.#failure=message;this.#event({type:'error',message});this.close('transport-failed');}
 acceptInitialOffer(message){this.#incoming=this.#incoming.then(()=>this.#receiveSignal(message)).catch(error=>this.#fail(error.message));}
 async begin({generation=Date.now()}={}){
  if(this.#role!=='controller'||this.#sessionId)throw Error('Only the controller can start a session');
  this.#sessionId=randomId();this.#generation=generation;await this.#prepareTcp();if(this.#closed)return;
  this.#pc.addTransceiver('video',{direction:'recvonly'});const audio=this.#pc.addTransceiver('audio',{direction:'sendrecv'});this.#microphone=audio.sender;
  this.#bindChannel(this.#pc.createDataChannel('control',{ordered:true}));
  const offer=await this.#pc.createOffer();if(this.#closed)return;await this.#pc.setLocalDescription(offer);await this.#signal('offer',offer.sdp);await this.#signal('control-key',JSON.stringify({transport:'tcp-e2e-v1',publicKey:this.#tcp.publicKey}));
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
   if(this.#role!=='host'||this.#sessionId)throw Error('Unexpected offer');this.#sessionId=message.sessionId;this.#generation=message.generation;await this.#prepareTcp();if(this.#closed)return;
   this.#resources=await this.#acquire(this.#record.grant);if(this.#closed){this.#resources?.dispose?.();return;}
   if(!this.#resources?.videoTrack||!this.#resources.display)throw Error('Screen capture unavailable');
   await this.#pc.setRemoteDescription({type:'offer',sdp:data});
   this.#videoSender=this.#pc.addTrack(this.#resources.videoTrack,new MediaStream([this.#resources.videoTrack]));
   if(this.#record.grant.permissions.includes('speaker')&&this.#resources.audioTrack)this.#pc.addTrack(this.#resources.audioTrack,new MediaStream([this.#resources.audioTrack]));
   const answer=await this.#pc.createAnswer();if(this.#closed)return;await this.#pc.setLocalDescription(answer);await this.#signal('answer',answer.sdp);
  }else if(type==='answer'){
   if(this.#role!=='controller'||message.sessionId!==this.#sessionId||message.generation!==this.#generation)throw Error('Unexpected answer');await this.#pc.setRemoteDescription({type:'answer',sdp:data});
  }else if(type==='control-key'){
   if(message.sessionId!==this.#sessionId||message.generation!==this.#generation||!this.#tcp)throw Error('Wrong TCP key session');const key=JSON.parse(data);if(!key||Object.keys(key).length!==2||key.transport!=='tcp-e2e-v1'||typeof key.publicKey!=='string')throw Error('Invalid TCP key');await this.#tcp.acceptKey(key.publicKey);if(this.#closed)return;
   if(this.#role==='host')await this.#signal('control-key',JSON.stringify({transport:'tcp-e2e-v1',publicKey:this.#tcp.publicKey}));else this.#sendSessionOpen();
  }else if(type==='candidate'){

   if(message.sessionId!==this.#sessionId||message.generation!==this.#generation)throw Error('Wrong candidate session');const candidate=JSON.parse(data);const protocol=candidate.candidate?.split(/\s+/)[2]?.toLowerCase();if(protocol&&protocol!=='udp')return;if(!this.#pc.remoteDescription){if(this.#candidates.length>=64)throw Error('Too many candidates');this.#candidates.push(candidate);}else await this.#pc.addIceCandidate(candidate);
  }
  if(this.#pc.remoteDescription)for(const candidate of this.#candidates.splice(0))await this.#pc.addIceCandidate(candidate);
 }
 #send(kind,payload){if(this.#closed||this.#channel?.readyState!=='open')return false;if(this.#channel.bufferedAmount>128*1024){this.close('transport-failed');return false;}try{this.#channel.send(encodeMessage({protocol:'devicebridge.remote',version:1,kind,sessionId:this.#sessionId,generation:this.#generation,seq:this.#dataSeq++,payload}));return true;}catch{this.close('transport-failed');return false;}}
 #bindChannel(channel){
  this.#channel=channel;channel.onclose=()=>this.close('transport-failed');channel.onerror=()=>this.close('transport-failed');
  channel.onopen=()=>{
   if(this.#closed){channel.close();return;}if(this.#role==='controller')this.#sendSessionOpen();
  };
  channel.onmessage=e=>{
   try{
    const m=decodeMessage(e.data),g=this.#record.grant;if(m.sessionId!==this.#sessionId||m.generation!==this.#generation||g.expiresAt<=this.#now())throw Error('Session mismatch or expired grant');
    if(!this.#ready){
     if(this.#role==='host'){
      if(m.kind!=='session.open'||m.seq!==0||m.payload.deviceId!==g.controllerId||m.payload.grantId!==g.id||m.payload.permissionRevision!==g.revision||m.payload.permissions.some(p=>!g.permissions.includes(p)))throw Error('Control permission rejected');
      this.#permissions=m.payload.permissions.filter(p=>(this.#resources.permissions||g.permissions).includes(p));this.displayInfo=this.#resources.display;this.#send('session.ready',{permissions:this.#permissions,permissionRevision:g.revision,display:this.displayInfo});
     }else{
      if(m.kind!=='session.ready'||m.seq!==0||m.payload.permissionRevision!==g.revision||!m.payload.display||m.payload.permissions.some(p=>!g.permissions.includes(p)))throw Error('Unexpected control acceptance');this.#permissions=[...m.payload.permissions];this.displayInfo=m.payload.display;
     }
     this.#gate=new SessionGate({sessionId:this.#sessionId,generation:this.#generation,permissions:this.#permissions});this.#ready=true;clearTimeout(this.#deadline);this.#lastData=this.#now();
     this.#heartbeat=this.#interval(()=>{if(g.expiresAt<=this.#now()){this.close('expired');return;}if(this.#now()-this.#lastData>45000){this.#fail('The screen heartbeat stopped. Restoring a fresh UDP connection.');return;}this.#send('heartbeat',{nonce:randomId()});},15000);this.#heartbeat.unref?.();this.#announceReady();return;
    }
    if(!this.#gate.accept(m))throw Error('Stale or unauthorized data');this.#lastData=this.#now();
    if(m.kind==='session.stop'){this.close(m.payload.reason);return;}
    if(m.kind==='input'){
     throw Error('Input must use the encrypted TCP channel');
    }
   }catch(error){this.#fail(error.message);}
  };
 }
 async #prepareTcp(){const g=this.#record.grant;const cipher=await TcpControlCipher.create({grantId:g.id,sessionId:this.#sessionId,generation:this.#generation,localId:this.#client.deviceId,remoteId:this.#role==='host'?g.controllerId:g.hostId,role:this.#role});if(this.#closed){cipher.close();return;}this.#tcp=cipher;}
 #sendSessionOpen(){if(this.#opened||!this.#tcp?.ready||this.#channel?.readyState!=='open')return;this.#opened=true;this.#send('session.open',{deviceId:this.#client.deviceId,grantId:this.#record.grant.id,permissionRevision:this.#record.grant.revision,permissions:this.#record.grant.permissions});}
 #announceReady(){if(!this.ready||this.#announced)return;this.#announced=true;if(this.#role==='host'&&this.#videoSender){this.#quality=new AdaptiveVideo({pc:this.#pc,sender:this.#videoSender});this.#quality.start();}this.#event({type:'ready',permissions:this.#permissions,display:this.displayInfo});}
 async #receiveControl(frame){
  if(this.#closed)return;if(!this.ready||!this.#permissions.includes('input'))throw Error('TCP input is not permitted');const value=await this.#tcp.open(frame);if(this.#closed||!value)return;
  if(this.#role==='host'){
   if(value.kind!=='input')throw Error('Expected TCP input');const input=value.input;if(input.type==='pointer'&&input.point.displayId!==this.displayInfo.id)throw Error('Wrong display');
   await (this.#resources.applyInputAndWait||this.#resources.applyInput)?.(input);if(this.#closed)return;this.#controlsAccepted++;const ack=await this.#tcp.seal({kind:'ack',ack:frame.seq});if(!this.#closed)this.#client.sendControl(ack);
  }else{
   if(value.kind!=='ack')throw Error('Expected TCP acknowledgement');const pending=this.#controlPending.get(value.ack);if(!pending)throw Error('Unknown TCP acknowledgement');clearTimeout(pending.timer);this.#controlPending.delete(value.ack);this.#controlRequests.delete(pending);this.#controlAcks++;pending.resolve(true);
  }
 }
 sendInputAcknowledged(input){
  validateInput(input);if(input.type!=='pointer')this.#flushPointer();if(!this.ready||this.#role!=='controller'||!this.#permissions.includes('input'))return Promise.reject(Error('The control connection is not ready'));
  if(this.#controlRequests.size>=128){this.#fail('Control queue is full. Sharing stopped to avoid losing input.');return Promise.reject(Error('Control queue is full'));}
  const snapshot=structuredClone(input);return new Promise((resolve,reject)=>{
   const request={resolve,reject,timer:setTimeout(()=>this.#fail('Control delivery was not confirmed. Check the PC before sending again.'),10000)};this.#controlRequests.add(request);
   this.#controlQueue=this.#controlQueue.then(async()=>{if(!this.ready)throw Error('Control connection closed');const frame=await this.#tcp.seal({kind:'input',input:snapshot});if(this.#closed)throw Error('Control connection closed');this.#controlPending.set(frame.seq,request);this.#client.sendControl(frame);}).catch(error=>{reject(error);this.#fail(error.message);});
  });
 }
 #flushPointer(){clearTimeout(this.#pointerTimer);this.#pointerTimer=null;const point=this.#pendingPointer;this.#pendingPointer=null;if(point&&this.ready)this.sendInputAcknowledged(point).catch(()=>{});}
 sendInput(input){validateInput(input);if(!this.ready||this.#role!=='controller'||!this.#permissions.includes('input'))return false;if(input.type==='pointer'){this.#pendingPointer=structuredClone(input);if(!this.#pointerTimer)this.#pointerTimer=setTimeout(()=>this.#flushPointer(),16);return true;}this.sendInputAcknowledged(input).catch(()=>{});return !this.#closed;}


 async microphone(enabled){
  if(this.#role!=='controller'||!this.ready||!this.#permissions.includes('microphone'))throw Error('Microphone is not permitted');
  const attempt=++this.#microphoneGeneration;
  if(!enabled){this.#localMicrophone?.getTracks().forEach(t=>t.stop());this.#localMicrophone=null;await this.#microphone.replaceTrack(null);return false;}
  const stream=await this.#getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
  if(!this.ready||attempt!==this.#microphoneGeneration){stream.getTracks().forEach(t=>t.stop());return false;}
  const previous=this.#localMicrophone;this.#localMicrophone=stream;
  try{await this.#microphone.replaceTrack(stream.getAudioTracks()[0]);}
  catch(error){stream.getTracks().forEach(t=>t.stop());if(this.#localMicrophone===stream)this.#localMicrophone=null;throw error;}
  finally{previous?.getTracks().forEach(t=>t.stop());}
  if(!this.ready||attempt!==this.#microphoneGeneration){stream.getTracks().forEach(t=>t.stop());return false;}
  return true;
 }
 close(reason='user'){
  if(this.#closed||this.#closing)return;this.#closing=true;this.#microphoneGeneration++;
  try{if(this.#channel?.bufferedAmount<=128*1024)this.#send('session.stop',{reason:['user','revoked','expired','shutdown','permission-changed','transport-failed'].includes(reason)?reason:'transport-failed'});}catch{}
  this.#closed=true;this.#ready=false;this.#serviceCheck++;this.#holdCancel(this.#holdTimer);this.#holdTimer=null;this.#holds.clear();clearTimeout(this.#pointerTimer);this.#pendingPointer=null;
  const cleanup=(name,action)=>{try{action();}catch{this.#cleanupErrors.push(name);}};
  for(const request of this.#controlRequests){clearTimeout(request.timer);request.reject(Error('Control delivery was not confirmed. Check the PC before sending again.'));}this.#controlRequests.clear();this.#controlPending.clear();cleanup('tcp-cipher',()=>this.#tcp?.close());cleanup('video-quality',()=>this.#quality?.stop());
  cleanup('deadline',()=>clearTimeout(this.#deadline));cleanup('heartbeat',()=>this.#clearInterval(this.#heartbeat));
  cleanup('subscription',()=>this.#unsubscribe?.());cleanup('input-gate',()=>this.#gate?.close());
  cleanup('control-channel',()=>this.#channel?.close());cleanup('peer-connection',()=>this.#pc.close());
  for(const track of this.#localMicrophone?.getTracks()||[])cleanup('microphone-track',()=>track.stop());this.#localMicrophone=null;
  cleanup('release-input',()=>this.#resources?.releaseInput?.());cleanup('dispose-media',()=>this.#resources?.dispose?.());
  try{this.#event({type:'closed',reason,message:this.#failure,cleanupErrors:[...this.#cleanupErrors]});}catch{}
 }
}
