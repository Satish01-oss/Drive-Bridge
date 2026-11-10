import {ConnectionClient} from './client/connection.mjs';
import {BrowserStore} from './client/storage.mjs';
import {RemotePeer} from './client/peer.mjs';
import {acquireNativeHost} from './client/native-media.mjs';
import {toBase64Url} from './shared/signatures.mjs';
const el=id=>document.getElementById(id),windowsNative=globalThis.chrome?.webview,androidNative=globalThis.DeviceBridgeAndroid,native=windowsNative||(androidNative?{postMessage:value=>androidNative.postMessage(JSON.stringify(value)),addEventListener:(_,listener)=>window.addEventListener('devicebridge-native',event=>listener({data:event.detail}))}:null),pending=new Map();
let client,role,peer,wanted=false,pageActive=true,retryTimer,retries=0,autoGrant=null,reconnectTimer,mic=false,touchMode=true,resourcesReady=new Map();
const status=text=>{el('status').textContent=text;};
const run=action=>async event=>{event?.preventDefault();try{await action();}catch(error){status(error.message);}};
function rpc(type,payload={}){if(!native)return Promise.reject(Error('Open this in the installed Windows app.'));const rpcId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(rpcId);reject(Error('The Windows app did not respond.'));},15000);pending.set(rpcId,{resolve,reject,timeout});native.postMessage({rpcId,type,...payload});});}
native?.addEventListener('message',event=>{const m=event.data;if(m.rpcId&&pending.has(m.rpcId)){const p=pending.get(m.rpcId);pending.delete(m.rpcId);clearTimeout(p.timeout);m.error?p.reject(Error(m.error)):p.resolve(m.result);}else if(['frame','sound','mic-ack'].includes(m.type)){const resource=resourcesReady.get(m.captureId);if(resource)resource.handle(m).catch(error=>status(error.message));else if(m.type!=='mic-ack')native.postMessage({type:m.type==='frame'?'frame.ack':'sound.ack',captureId:m.captureId});}else if(m.type==='native-error')status(m.message);else if(m.type==='capture-error'){peer?.close('transport-failed');status(m.message);}else if(m.type==='native-stop'){autoGrant=null;peer?.close('user');status('Sharing stopped on this computer.');}});
const nativeStore=native?{get:key=>rpc('store.get',{key}),set:(key,value)=>rpc('store.set',{key,value})}:null;
// CryptoKey objects cannot be sent over JSON. Native identity signing is introduced
// by the native storage adapter in the next integration stage; browser preview
// keeps its non-exportable keys in the app's private browser profile.
const store=nativeStore||new BrowserStore();
const identityProvider=native?{getOrCreate:()=>rpc('identity.get'),sign:(purpose,value)=>rpc('identity.sign',{purpose,value})}:null;
if(native)globalThis.DeviceBridgeNativeVerify=(publicKey,purpose,value,signature)=>rpc('identity.verify',{publicKey,purpose,value,signature});
function buttons(){el('choose-host').hidden=!!androidNative||/Android/i.test(navigator.userAgent);el('host-capability').textContent=windowsNative?'Share your Windows screen with an approved phone.':'Browser preview shares a chosen screen. Desktop input and virtual microphone routing require the installed Windows app.';}
function remoteEvent(event){
 if(event.type==='ready'){clearTimeout(reconnectTimer);status('Connected — your computer is ready.');el('remote').hidden=role!=='controller';el('screen-placeholder').hidden=true;el('mic-toggle').disabled=!event.permissions.includes('microphone');el('typing').hidden=!event.permissions.includes('input');retries=0;}
 if(event.type==='track'){const target=event.track.kind==='video'?el('screen'):audio;target.srcObject=new MediaStream([event.track]);target.play().catch(()=>status('Connected. Tap Sound on to start playback.'));}
 if(event.type==='closed'){status(event.reason==='user'?'Disconnected — sharing stopped.':'Connection lost — waiting to reconnect.');mic=false;el('mic-toggle').textContent='Microphone off';if(event.reason==='user'||event.reason==='revoked'||event.reason==='expired')autoGrant=null;else scheduleRemote();}
 if(event.type==='error')status(event.message);
}
const audio=new Audio();audio.autoplay=true;
function scheduleRemote(){clearTimeout(reconnectTimer);if(!autoGrant||role!=='controller'||!wanted||!pageActive||peer?.ready)return;reconnectTimer=setTimeout(()=>{if(client?.connected&&autoGrant)openRemote(autoGrant).catch(error=>{status(error.message);scheduleRemote();});else scheduleRemote();},3000);}
async function openRemote(record){
 const previous=peer;peer=null;previous?.close('transport-failed');
 autoGrant=record.grant.reconnect?record:null;el('remote').hidden=false;el('screen-placeholder').hidden=false;status('Connecting to your computer…');
 peer=new RemotePeer({client,record,role:'controller',event:remoteEvent});await peer.begin();
}
function showDevices(){const area=el('device-list');area.replaceChildren();const grants=client?.grants||[];el('devices').hidden=!grants.length;
 for(const record of grants){const row=document.createElement('div');row.className='device';const title=document.createElement('strong'),hint=document.createElement('p'),button=document.createElement('button');title.textContent=role==='host'?'Approved phone':'Your Windows PC';hint.className='hint';hint.textContent=record.grant.permissions.join(' · ')+(record.grant.reconnect?' · Trusted reconnect':'');button.textContent=role==='host'?'Remove access':'Open computer';button.onclick=run(async()=>{if(role==='host'){await client.revoke(record.grant.id);showDevices();}else await openRemote(record);});row.append(title,hint,button);area.append(row);}}
async function approve(request){
 let source;
 if(!native){source=await browserSource(request.permissions);resourcesReady.set('pending-'+request.requestId,source);}
 try{const record=await client.approveRequest(request);if(source)resourcesReady.set(record.grant.id,source);if(native)await rpc('grant.save',{record});status('Phone approved. Waiting for its connection…');el('approvals').replaceChildren();showDevices();}
 catch(error){source?.dispose();throw error;}
}
function requestPrompt(request){if(role!=='host')return;const row=document.createElement('div');row.className='request';const title=document.createElement('strong'),details=document.createElement('p'),allow=document.createElement('button'),deny=document.createElement('button');title.textContent='A phone wants to connect';details.textContent=request.permissions.join(' · ')+(request.reconnect?' · May reconnect after interruption':'');allow.textContent='Allow this phone';deny.textContent='Reject';deny.className='secondary';allow.onclick=run(()=>approve(request));deny.onclick=run(async()=>{await client.rejectRequest(request.requestId);row.remove();status('Connection request rejected.');});row.append(title,details,allow,deny);el('approvals').append(row);}
async function browserSource(permissions){
 const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:permissions.includes('speaker')});const videoTrack=stream.getVideoTracks()[0],settings=videoTrack.getSettings();
 return {videoTrack,audioTrack:stream.getAudioTracks()[0],display:{id:toBase64Url(crypto.getRandomValues(new Uint8Array(24))),width:settings.width||1280,height:settings.height||720},applyInput:()=>status('Screen preview: desktop input needs the installed Windows app.'),dispose:()=>stream.getTracks().forEach(t=>t.stop())};
}
async function acquireHost(grant){
 if(!native){const source=resourcesReady.get(grant.id);if(!source||source.videoTrack.readyState==='ended')throw Error('Select your screen on the computer before connecting.');return source;}
 return acquireNativeHost(grant,{rpc,post:value=>native.postMessage(value),status,resources:resourcesReady});
}
function onClient(event){
 if(event.type==='status'){
  if(event.status==='service-connected'){clearTimeout(retryTimer);retries=0;el('mode').hidden=!!native;if(native){role=windowsNative?'host':'controller';el('host').hidden=role!=='host';el('phone').hidden=role!=='controller';el('setup').hidden=true;showDevices();}el('connect-service').disabled=false;el('stop-all').hidden=false;status('Connected to the connection service. Choose a mode.');if(autoGrant)scheduleRemote();}
  if(event.status==='service-offline'&&wanted){status('Connection service unavailable — retrying…');clearTimeout(retryTimer);retryTimer=setTimeout(()=>client.start().catch(()=>{}),Math.min(30000,1000*2**Math.min(retries++,5)));}
 }
 if(event.type==='pairing-request')requestPrompt(event.request);
 if(event.type==='grant-approved'){showDevices();if(role==='controller'){el('pair-status').textContent='Approved by your computer.';openRemote(event.record).catch(error=>status(error.message));}}
 if(event.type==='grant-revoked'){autoGrant=null;peer?.close('revoked');showDevices();status('Access removed by the computer.');}
 if(event.type==='pairing-rejected')el('pair-status').textContent='The computer declined this request.';
 if(event.type==='presence'&&autoGrant&&event.deviceId===autoGrant.grant.hostId){if(!event.online){status('PC offline — waiting to reconnect.');peer?.close('transport-failed');}else if(!peer?.ready)scheduleRemote();}
 if(event.type==='signal'&&role==='host'&&event.signed.message.payload.type==='offer'){
  const record=client.grants.find(r=>r.grant.id===event.signed.grantId);if(!record)return;const old=peer;peer=null;old?.close('transport-failed');
  peer=new RemotePeer({client,record,role:'host',acquireHost,event:remoteEvent});
  // This first signal was emitted before the new peer subscribed. Replay only
  // this already verified event through the explicit bootstrap entry point.
  peer.acceptInitialOffer(event.signed.message);
 }
 if(event.type==='error')status(event.message||event.error);
}
el('connect-service').onclick=run(async()=>{const baseUrl=el('service').value.trim();autoGrant=null;peer?.close('user');peer=null;client?.stop();client=new ConnectionClient({baseUrl,store,identityProvider});client.subscribe(onClient);wanted=true;el('connect-service').disabled=true;try{await client.start();localStorage.setItem('devicebridge-service',baseUrl);}finally{el('connect-service').disabled=false;}});
el('choose-host').onclick=()=>{role='host';el('host').hidden=false;el('phone').hidden=true;showDevices();};el('choose-phone').onclick=()=>{role='controller';el('host').hidden=true;el('phone').hidden=false;showDevices();};
el('generate-key').onclick=run(async()=>{const permissions=['view'];if(el('allow-input').checked)permissions.push('input');if(el('allow-speaker').checked)permissions.push('speaker');if(el('allow-mic').checked)permissions.push('microphone');const p=await client.createPairing({permissions,reconnect:el('allow-reconnect').checked});el('code').textContent=p.code;el('key-expiry').textContent='This key expires in two minutes. Approve the request below.';});
el('pair').onclick=run(async()=>{await client.requestPairing(el('pair-code').value);el('pair-status').textContent='Waiting for approval on the computer…';});
el('disconnect').onclick=()=>{autoGrant=null;clearTimeout(reconnectTimer);peer?.close('user');peer=null;el('remote').hidden=true;};
el('stop-all').onclick=()=>{wanted=false;autoGrant=null;clearTimeout(retryTimer);clearTimeout(reconnectTimer);peer?.close('user');peer=null;client?.stop();el('remote').hidden=true;el('mode').hidden=true;status('Disconnected — all sharing stopped.');};
el('typing').onsubmit=run(async()=>{const text=el('text').value;if(text&&peer?.sendInput({type:'text',text}))el('text').value='';});
function key(code){peer?.sendInput({type:'key',code,down:true});peer?.sendInput({type:'key',code,down:false});}
document.querySelectorAll('[data-key]').forEach(button=>button.onclick=()=>key(button.dataset.key));
for(const letter of ['a','c','v'])el('ctrl-'+letter).onclick=()=>{peer?.sendInput({type:'key',code:'ControlLeft',down:true});key('Key'+letter.toUpperCase());peer?.sendInput({type:'key',code:'ControlLeft',down:false});};
el('mic-toggle').onclick=run(async()=>{await peer?.microphone(!mic);mic=!mic;el('mic-toggle').textContent=mic?'Microphone on':'Microphone off';});
el('sound-toggle').onclick=run(async()=>{audio.muted=!audio.muted;el('sound-toggle').textContent=audio.muted?'Sound off':'Sound on';if(!audio.muted)await audio.play();});
el('right-click').onclick=()=>{peer?.sendInput({type:'button',button:'secondary',down:true});peer?.sendInput({type:'button',button:'secondary',down:false});};
el('scroll-up').onclick=()=>peer?.sendInput({type:'scroll',dx:0,dy:-120});el('scroll-down').onclick=()=>peer?.sendInput({type:'scroll',dx:0,dy:120});
el('pointer-mode').onclick=()=>{touchMode=!touchMode;el('pointer-mode').textContent=touchMode?'Touch mode':'Trackpad mode';};
let pointer=null,position={x:.5,y:.5};const video=el('screen');
function point(event){const r=video.getBoundingClientRect(),aspect=(video.videoWidth||16)/(video.videoHeight||9),width=Math.min(r.width,r.height*aspect),height=width/aspect,left=r.left+(r.width-width)/2,top=r.top+(r.height-height)/2;return {x:Math.max(0,Math.min(1,(event.clientX-left)/width)),y:Math.max(0,Math.min(1,(event.clientY-top)/height))};}
video.onpointerdown=e=>{if(!peer?.ready)return;video.setPointerCapture(e.pointerId);pointer={id:e.pointerId,x:e.clientX,y:e.clientY,moved:false};if(touchMode){position=point(e);peer.sendInput({type:'pointer',point:{displayId:peer.display.id,...position}});peer.sendInput({type:'button',button:'primary',down:true});}};
video.onpointermove=e=>{if(!pointer||pointer.id!==e.pointerId||!peer?.ready)return;if(Math.abs(e.clientX-pointer.x)+Math.abs(e.clientY-pointer.y)>3)pointer.moved=true;if(touchMode)position=point(e);else position={x:Math.max(0,Math.min(1,position.x+(e.clientX-pointer.x)/Math.max(video.clientWidth,1))),y:Math.max(0,Math.min(1,position.y+(e.clientY-pointer.y)/Math.max(video.clientHeight,1)))};pointer.x=e.clientX;pointer.y=e.clientY;peer.sendInput({type:'pointer',point:{displayId:peer.display.id,...position}});};
const release=e=>{if(!pointer||pointer.id!==e.pointerId)return;if(touchMode)peer?.sendInput({type:'button',button:'primary',down:false});else if(!pointer.moved){peer?.sendInput({type:'button',button:'primary',down:true});peer?.sendInput({type:'button',button:'primary',down:false});}pointer=null;};video.onpointerup=release;video.onpointercancel=()=>{pointer=null;peer?.sendInput({type:'release-all'});};
document.addEventListener('visibilitychange',()=>{if(document.hidden)peer?.sendInput({type:'release-all'});});
window.addEventListener('devicebridge-pause',()=>{pageActive=false;clearTimeout(reconnectTimer);peer?.sendInput({type:'release-all'});peer?.close('transport-failed');status('Paused while the phone app is in the background.');});
window.addEventListener('devicebridge-resume',()=>{pageActive=true;if(wanted&&!client?.connected)client?.start().catch(error=>status(error.message));if(autoGrant)scheduleRemote();});
try{el('service').value=localStorage.getItem('devicebridge-service')||(native?'https://devicebridge-signaling-preview.onrender.com':(/^https?:$/.test(location.protocol)?location.origin:''));}catch{}buttons();

if(native)el('connect-service').click();

el('setup-mic').hidden=!windowsNative;el('setup-mic').onclick=run(()=>rpc('driver.setup'));

