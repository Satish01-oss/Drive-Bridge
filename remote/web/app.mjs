import {reconnectDelay,shouldRestartNetwork} from './core/recovery.mjs';
import {ConnectionClient} from './client/connection.mjs';
import {BrowserStore} from './client/storage.mjs';
import {RemotePeer} from './client/peer.mjs';
import {acquireNativeHost} from './client/native-media.mjs';
import {toBase64Url} from './shared/signatures.mjs';
import {mountControllerDisplay} from './controller-display.mjs';
import {mountScreenGestures} from './screen-gestures.mjs';
const el=id=>document.getElementById(id),windowsNative=globalThis.chrome?.webview,androidNative=globalThis.DeviceBridgeAndroid,native=windowsNative||(androidNative?{postMessage:value=>androidNative.postMessage(JSON.stringify(value)),addEventListener:(_,listener)=>window.addEventListener('devicebridge-native',event=>listener({data:event.detail}))}:null),pending=new Map();
let client,role,peer,wanted=false,pageActive=true,retryTimer,retries=0,autoGrant=null,reconnectTimer,pairTimer,mic=false,touchMode=true,resourcesReady=new Map();
let serviceAttempt=0,networkOnline=true,networkRestartTimer;
let remoteFailures=0,connectedAt=0,lastDisconnect=null;
const promptTimers=new Map();
const status=text=>{el('status').textContent=text;el('remote-status').textContent=text;};
const friendlyError=error=>({'pairing-unavailable':'That key expired or could not be found. Generate a new key on the PC and try again.','request-unavailable':'This request expired or the connection service restarted. Generate a fresh key and reconnect.','pairing-busy':'This computer has several pending requests. Try a fresh key.','rate-limited':'Too many attempts. Wait a minute, then try a fresh key.','unauthorized':'The service connection expired. Reconnecting…'}[error.message]||error.message);
const run=action=>async event=>{event?.preventDefault();const button=event?.currentTarget?.tagName==='BUTTON'?event.currentTarget:null;if(button)button.disabled=true;try{await action();}catch(error){if(error.name!=='AbortError')status(friendlyError(error));}finally{if(button)button.disabled=['pair','generate-key'].includes(button.id)?!client?.connected:['mic-toggle','sound-toggle'].includes(button.id)?!peer?.ready||!peer.permissions.includes(button.id==='mic-toggle'?'microphone':'speaker'):false;}};
function clearPrompts(){for(const timer of promptTimers.values())clearTimeout(timer);promptTimers.clear();el('approvals').replaceChildren();}
function rpc(type,payload={}){if(!native)return Promise.reject(Error('Open this in the installed app.'));const rpcId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{pending.delete(rpcId);reject(Error('The app did not respond. Please try again.'));},type==='app.update.download'?180000:type==='app.update.check'?45000:15000);pending.set(rpcId,{resolve,reject,timeout});native.postMessage({rpcId,type,...payload});});}
native?.addEventListener('message',event=>{const m=event.data;if(m.rpcId&&pending.has(m.rpcId)){const p=pending.get(m.rpcId);pending.delete(m.rpcId);clearTimeout(p.timeout);m.error?p.reject(Error(m.error)):p.resolve(m.result);}else if(['frame','sound','mic-ack'].includes(m.type)){const resource=resourcesReady.get(m.captureId);if(resource)resource.handle(m).catch(error=>status(error.message));else if(m.type!=='mic-ack')native.postMessage({type:m.type==='frame'?'frame.ack':'sound.ack',captureId:m.captureId});}else if(m.type==='native-error')status(m.message);else if(m.type==='capture-error'){peer?.close('transport-failed');status(m.message);}else if(m.type==='native-stop')stopSharing(true);});
const nativeStore=native?{get:key=>rpc('store.get',{key}),set:(key,value)=>rpc('store.set',{key,value})}:null;
// Native identity operations stay behind the protected platform bridge.
// Browser previews retain non-exportable keys in their private browser profile.
const store=nativeStore||new BrowserStore();
const identityProvider=native?{getOrCreate:()=>rpc('identity.get'),sign:(purpose,value)=>rpc('identity.sign',{purpose,value})}:null;
if(native)globalThis.DeviceBridgeNativeVerify=(publicKey,purpose,value,signature)=>rpc('identity.verify',{publicKey,purpose,value,signature});
function buttons(){el('choose-host').hidden=!!androidNative||/Android/i.test(navigator.userAgent);el('host-capability').textContent=windowsNative?'Share your Windows screen with an approved phone.':'Browser preview shares a chosen screen. Desktop input and virtual microphone routing require the installed Windows app.';}
function remoteEvent(event){
 if(event.type==='ready'){connectedAt=Date.now();clearTimeout(reconnectTimer);controllerDisplay.setConnected(role==='controller');status(role==='controller'?(el('screen').readyState>=2?'Connected — screen ready.':'Connected — loading the computer screen…'):'Connected — your phone is ready.');el('remote').hidden=role!=='controller';el('screen-placeholder').hidden=role!=='controller'||el('screen').readyState>=2;const canMic=event.permissions.includes('microphone');el('mic-toggle').disabled=!canMic;el('mic-toggle').textContent=canMic?'Microphone off':'Microphone not shared';el('mic-hint').hidden=canMic;el('mic-hint').textContent=peer?.approvedPermissions.includes('microphone')?'On the PC, choose Set up phone microphone, then reconnect. The Windows recording app should use CABLE Output.':'To use your phone microphone, enable Phone microphone on the PC, generate a fresh key and approve the new connection.';el('sound-toggle').disabled=!event.permissions.includes('speaker');el('sound-toggle').textContent=event.permissions.includes('speaker')?(audio.muted?'Sound off':'Sound on'):'Sound not shared';el('typing').hidden=!event.permissions.includes('input');retries=0;}
 if(event.type==='track'){const target=event.track.kind==='video'?el('screen'):audio;target.srcObject=new MediaStream([event.track]);target.play().catch(()=>status('Connected. Tap Sound on to start playback.'));}
 if(event.type==='recovering'){el('typing').querySelector('button').disabled=true;status(event.message);}
 if(event.type==='recovered'){el('typing').querySelector('button').disabled=false;status(role==='controller'?(el('screen').readyState>=2?'Connected — screen ready.':'Connected — waiting for the screen…'):'Connected — your phone is ready.');}
 if(event.type==='closed'){if(connectedAt&&Date.now()-connectedAt>=60000)remoteFailures=0;else remoteFailures=Math.min(remoteFailures+1,5);lastDisconnect={reason:event.reason,message:event.message||'Connection ended',at:new Date().toISOString()};connectedAt=0;controllerDisplay.setConnected(false);screenGestures.fit();const message=event.message||(event.reason==='user'?'Disconnected — sharing stopped.':event.reason==='revoked'?'Access removed by the computer.':autoGrant?'Connection lost — waiting to reconnect.':'Connection stopped. Generate a fresh key on the computer to try again.');status(message);el('screen-placeholder').textContent=message;el('screen-placeholder').hidden=false;el('screen').srcObject=null;audio.srcObject=null;mic=false;el('mic-toggle').textContent='Microphone off';el('mic-toggle').disabled=true;el('sound-toggle').disabled=true;if(event.reason==='user'||event.reason==='revoked'||event.reason==='expired')autoGrant=null;else scheduleRemote();}
 if(event.type==='error')status(event.message);
}
const audio=new Audio();audio.autoplay=true;
const controllerDisplay=mountControllerDisplay({nativeFullscreen:androidNative?enabled=>rpc('display.fullscreen',{enabled}):null,onError:error=>status(error.message)});
function scheduleRemote(){clearTimeout(reconnectTimer);if(!autoGrant||role!=='controller'||!wanted||!pageActive||!networkOnline||peer?.active)return;reconnectTimer=setTimeout(()=>{if(peer?.active||!wanted||!pageActive||!networkOnline)return;if(client?.connected&&autoGrant)openRemote(autoGrant).catch(error=>{status(error.message);scheduleRemote();});else scheduleRemote();},reconnectDelay(remoteFailures));}
async function openRemote(record){
 if(peer?.active&&peer.grantId===record.grant.id)return;
 screenGestures.fit();const previous=peer;peer=null;previous?.close('transport-failed');
 autoGrant=record.grant.reconnect?record:null;el('remote').hidden=false;el('screen-placeholder').textContent='Connecting to the computer screen…';el('screen-placeholder').hidden=false;status('Connecting to your computer…');
 peer=new RemotePeer({client,record,role:'controller',event:remoteEvent});await peer.begin();
}
function showDevices(){const area=el('device-list');area.replaceChildren();const grants=client?.grants||[];el('devices').hidden=!grants.length;
 for(const record of grants){const row=document.createElement('div');row.className='device';const title=document.createElement('strong'),hint=document.createElement('p'),button=document.createElement('button');title.textContent=role==='host'?'Approved phone':'Your Windows PC';hint.className='hint';hint.textContent=record.grant.permissions.join(' · ')+(record.grant.reconnect?' · Trusted reconnect':'');button.textContent=role==='host'?'Remove access':'Open computer';button.onclick=run(async()=>{if(role==='host'){await client.revoke(record.grant.id);showDevices();}else await openRemote(record);});row.append(title,hint,button);if(role==='controller'){const remove=document.createElement('button');remove.textContent='Remove PC';remove.className='secondary';remove.onclick=run(async()=>{const result=await client.forget(record.grant.id);showDevices();el('remote').hidden=true;status(result.computerNotified?'PC removed. Pair again from the computer to reconnect.':'PC removed from this phone. The computer could not be notified; it may still list this phone. Pair again to reconnect.');});row.append(remove);}area.append(row);}}
async function approve(request){
 let source;
 if(!native){source=await browserSource(request.permissions);resourcesReady.set('pending-'+request.requestId,source);}
 try{const record=await client.approveRequest(request);if(source)resourcesReady.set(record.grant.id,source);if(native)await rpc('grant.save',{record});status('Phone approved. Waiting for its connection…');clearPrompts();showDevices();}
 catch(error){source?.dispose();throw error;}
}
function requestPrompt(request){
 if(role!=='host'||request.expiresAt<=Date.now()||promptTimers.has(request.requestId))return;
 const row=document.createElement('div');row.className='request';row.setAttribute('role','region');row.setAttribute('aria-label','Phone connection approval');
 const title=document.createElement('strong'),details=document.createElement('p'),allow=document.createElement('button'),deny=document.createElement('button');
 const remove=()=>{clearTimeout(promptTimers.get(request.requestId));promptTimers.delete(request.requestId);row.remove();};
 title.textContent='A phone wants to connect';details.textContent=request.permissions.join(' · ')+(request.reconnect?' · May reconnect after interruption':'');
 allow.textContent='Allow this phone';deny.textContent='Reject';deny.className='secondary';
 allow.onclick=run(async()=>{if(request.expiresAt<=Date.now()){remove();throw Error('request-unavailable');}try{await approve(request);}catch(error){if(error.message==='request-unavailable')remove();throw error;}});
 deny.onclick=run(async()=>{try{await client.rejectRequest(request.requestId);status('Connection request rejected.');}finally{remove();}});
 row.append(title,details,allow,deny);el('approvals').append(row);promptTimers.set(request.requestId,setTimeout(()=>{remove();status('Phone request expired. Generate a fresh key to try again.');},Math.max(1,request.expiresAt-Date.now())));
 row.scrollIntoView({block:'nearest'});if(windowsNative)rpc('pairing.notify').catch(()=>{});
}
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
  if(event.status==='connecting-service'){status('Connecting to DeviceBridge… The first connection may take a minute.');el('native-reconnect').hidden=!native;el('native-reconnect').disabled=true;el('pair').disabled=true;el('generate-key').disabled=true;}
  if(event.status==='service-connected'){el('native-reconnect').hidden=true;el('pair').disabled=false;el('generate-key').disabled=false;}
  if(event.status==='service-offline'||event.status==='stopped'){el('native-reconnect').hidden=!native;el('native-reconnect').disabled=false;el('pair').disabled=true;el('generate-key').disabled=true;}
  if(event.status==='service-connected'){clearTimeout(retryTimer);retries=0;el('mode').hidden=!!native;if(native){role=windowsNative?'host':'controller';el('host').hidden=role!=='host';el('phone').hidden=role!=='controller';el('setup').hidden=true;showDevices();}el('connect-service').disabled=false;el('stop-all').hidden=false;status(peer?.ready?'Connected — your computer is ready.':native?(role==='host'?'Ready — generate a key for your phone.':'Ready — enter the key from your computer.'):'Connected to the connection service. Choose a mode.');if(autoGrant)scheduleRemote();}
  if(event.status==='service-offline'&&wanted&&networkOnline){clearPrompts();status(peer?.ready?'Connected — restoring the connection service…':'Connection service unavailable — retrying…');clearTimeout(retryTimer);retryTimer=setTimeout(()=>client.start().catch(()=>{}),Math.min(30000,1000*2**Math.min(retries++,5)));}
 }
 if(event.type==='pairing-request')requestPrompt(event.request);
 if(event.type==='grant-approved'){clearTimeout(pairTimer);showDevices();if(role==='controller'){el('pair-status').textContent='Approved by your computer.';openRemote(event.record).catch(error=>status(error.message));}}
 if(event.type==='grant-revoked'){autoGrant=null;peer?.close('revoked');showDevices();status('Connection access removed.');}
 if(event.type==='pairing-rejected'){clearTimeout(pairTimer);el('pair-status').textContent='The computer declined or replaced this request. Try its latest key.';}
 if(event.type==='presence'&&autoGrant&&event.deviceId===autoGrant.grant.hostId){if(!event.online){status('PC connection interrupted — waiting briefly for recovery.');}else if(!peer?.ready)scheduleRemote();}
 if(event.type==='signal'&&role==='host'&&event.signed.message.payload.type==='offer'){
  const record=client.grants.find(r=>r.grant.id===event.signed.grantId);if(!record)return;const old=peer;peer=null;old?.close('transport-failed');
  peer=new RemotePeer({client,record,role:'host',acquireHost,event:remoteEvent});
  // This first signal was emitted before the new peer subscribed. Replay only
  // this already verified event through the explicit bootstrap entry point.
  peer.acceptInitialOffer(event.signed.message);
 }
 if(event.type==='error')status(event.message||event.error);
}
el('connect-service').onclick=run(async()=>{const attempt=++serviceAttempt,baseUrl=el('service').value.trim();autoGrant=null;peer?.close('user');peer=null;client?.stop();if(windowsNative)await rpc('host.resume');if(attempt!==serviceAttempt)return;client=new ConnectionClient({baseUrl,store,identityProvider});client.subscribe(onClient);wanted=true;el('connect-service').disabled=true;try{await client.start();if(attempt===serviceAttempt)localStorage.setItem('devicebridge-service',baseUrl);}finally{el('connect-service').disabled=false;}});
el('choose-host').onclick=()=>{role='host';el('host').hidden=false;el('phone').hidden=true;showDevices();};el('choose-phone').onclick=()=>{role='controller';el('host').hidden=true;el('phone').hidden=false;showDevices();};
el('generate-key').onclick=run(async()=>{const permissions=['view'];if(el('allow-input').checked)permissions.push('input');if(el('allow-speaker').checked)permissions.push('speaker');if(el('allow-mic').checked)permissions.push('microphone');const p=await client.createPairing({permissions,reconnect:el('allow-reconnect').checked});clearPrompts();el('code').textContent=p.code;el('key-expiry').textContent='The key is valid for two minutes. Once requested, you have five minutes to approve.';});
el('pair').onclick=run(async()=>{clearTimeout(pairTimer);const request=await client.requestPairing(el('pair-code').value);el('pair-status').textContent='Waiting for approval on the computer…';pairTimer=setTimeout(()=>{el('pair-status').textContent='Approval timed out. Generate a new key on the PC and try again.';},Math.max(1,request.expiresAt-Date.now()));});
el('disconnect').onclick=()=>{autoGrant=null;clearTimeout(reconnectTimer);peer?.close('user');peer=null;el('remote').hidden=true;};
function stopSharing(nativeAlreadyStopped=false){serviceAttempt++;wanted=false;clearTimeout(networkRestartTimer);autoGrant=null;clearTimeout(pairTimer);clearPrompts();clearTimeout(retryTimer);clearTimeout(reconnectTimer);peer?.close('user');peer=null;client?.stop();el('remote').hidden=true;el('mode').hidden=true;el('stop-all').hidden=true;el('code').textContent='— — — — — —';el('key-expiry').textContent='';el('pair-status').textContent='';if(windowsNative&&!nativeAlreadyStopped)rpc('host.pause').catch(error=>status(error.message));status('Disconnected — all sharing stopped. Click Reconnect to become available again.');}
el('stop-all').onclick=()=>stopSharing();
el('typing').onsubmit=run(async()=>{const text=el('text').value;if(text&&peer?.sendInput({type:'text',text}))el('text').value='';});
function key(code){peer?.sendInput({type:'key',code,down:true});peer?.sendInput({type:'key',code,down:false});}
document.querySelectorAll('[data-key]').forEach(button=>button.onclick=()=>key(button.dataset.key));
for(const letter of ['a','c','v'])el('ctrl-'+letter).onclick=()=>{peer?.sendInput({type:'key',code:'ControlLeft',down:true});key('Key'+letter.toUpperCase());peer?.sendInput({type:'key',code:'ControlLeft',down:false});};
el('mic-toggle').onclick=run(async()=>{const current=peer;if(!current?.ready)return;try{const enabled=await current.microphone(!mic);if(peer!==current||!current.ready)return;mic=enabled;el('mic-toggle').textContent=mic?'Microphone on':'Microphone off';el('mic-hint').hidden=true;}catch(error){const hint=error.name==='NotAllowedError'?'Microphone access was blocked. In Android Settings → Apps → DeviceBridge → Permissions, allow Microphone, then try again.':error.name==='NotReadableError'?'Android could not start the microphone. Close any other recording or calling app, then try again.':error.message;el('mic-hint').textContent=hint;el('mic-hint').hidden=false;throw Error(hint);}});
el('sound-toggle').onclick=run(async()=>{audio.muted=!audio.muted;el('sound-toggle').textContent=audio.muted?'Sound off':'Sound on';if(!audio.muted)await audio.play();});
el('right-click').onclick=()=>{peer?.sendInput({type:'button',button:'secondary',down:true});peer?.sendInput({type:'button',button:'secondary',down:false});};
el('scroll-up').onclick=()=>peer?.sendInput({type:'scroll',dx:0,dy:-120});el('scroll-down').onclick=()=>peer?.sendInput({type:'scroll',dx:0,dy:120});
el('pointer-mode').onclick=()=>{screenGestures.cancel();touchMode=!touchMode;el('pointer-mode').textContent=touchMode?'Touch mode':'Trackpad mode';};
const video=el('screen');
const screenGestures=mountScreenGestures({viewport:el('screen-wrap'),video,zoomIn:el('zoom-in'),zoomOut:el('zoom-out'),fit:el('zoom-fit'),label:el('zoom-level'),ready:()=>!!peer?.ready,touchMode:()=>touchMode,send:event=>{if(event.type==='pointer')peer?.sendInput({type:'pointer',point:{displayId:peer.display.id,...event.position}});else peer?.sendInput(event);}});
video.onloadeddata=video.onplaying=()=>{if(peer?.ready){el('screen-placeholder').hidden=true;status('Connected — screen ready.');}};
el('connection-check').onclick=run(async()=>{const device=androidNative?await rpc('device.status'):null;const report={build:'0.9.0-preview.13',device,role,lastDisconnect,serviceConnected:!!client?.connected,session:peer?await peer.diagnostics():null,screen:{width:video.videoWidth,height:video.videoHeight,readyState:video.readyState},status:el('status').textContent};el('connection-report').value=JSON.stringify(report,null,2);el('connection-report').hidden=false;});
document.addEventListener('visibilitychange',()=>{if(document.hidden){screenGestures.cancel();peer?.sendInput({type:'release-all'});}});
window.addEventListener('devicebridge-pause',()=>{pageActive=false;screenGestures.cancel();clearTimeout(reconnectTimer);peer?.sendInput({type:'release-all'});peer?.close('transport-failed');status('Paused while the phone app is in the background.');});
window.addEventListener('devicebridge-resume',()=>{pageActive=true;if(wanted&&!client?.connected)client?.start().catch(error=>status(error.message));if(autoGrant)scheduleRemote();});
try{el('service').value=localStorage.getItem('devicebridge-service')||(native?'https://devicebridge-signaling-preview.onrender.com':(/^https?:$/.test(location.protocol)?location.origin:''));}catch{}buttons();

el('native-reconnect').onclick=()=>el('connect-service').click();
if(native){el('setup').hidden=true;el('connect-service').click();}

el('setup-mic').hidden=!windowsNative;el('setup-mic').onclick=run(()=>rpc('driver.setup'));

let updateChecking=false;
async function checkUpdates(){if(updateChecking)return;updateChecking=true;el('update-check').disabled=true;el('update-status').textContent='Checking for updates…';try{const result=await rpc('app.update.check');el('update-download').hidden=!result.available;el('update-install').hidden=true;el('update-status').textContent=result.available?'Version '+result.version+' is available. Download it here, then approve the update in Android.':'You are up to date · '+result.currentVersion;}catch(error){el('update-status').textContent='Could not check for updates. '+error.message;}finally{updateChecking=false;el('update-check').disabled=false;}}
el('update-check').onclick=()=>checkUpdates();
el('update-download').onclick=run(async()=>{el('update-status').textContent='Downloading and verifying your update…';try{const result=await rpc('app.update.download');el('update-download').hidden=true;el('update-install').hidden=false;el('update-status').textContent='Version '+result.version+' is verified and ready. Installing ends this session; your saved PC stays.';}catch(error){el('update-status').textContent=error.message;}});
el('update-install').onclick=run(async()=>{try{const result=await rpc('app.update.install');el('update-status').textContent=result.action==='permission-required'?'Android asks whether DeviceBridge may install its own updates. If you allow it, return here and tap Install update again.':'Review and approve the update in Android. Reopen DeviceBridge when it finishes.';}catch(error){el('update-status').textContent=error.message;}});
if(androidNative){el('app-updates').hidden=false;checkUpdates();}

if(windowsNative){el('host-startup').hidden=false;rpc('startup.get').then(value=>{el('startup-enabled').checked=value.enabled;}).catch(error=>{el('startup-enabled').disabled=true;el('startup-hint').textContent=error.message;});el('startup-enabled').onchange=run(async()=>{const desired=el('startup-enabled').checked;try{const result=await rpc('startup.set',{enabled:desired});el('startup-enabled').checked=result.enabled;el('startup-hint').textContent=result.enabled?'Starts in the tray after you sign in. Only an approved phone with trusted reconnect can reconnect.':'Automatic sign-in startup is off.';}catch(error){el('startup-enabled').checked=!desired;throw error;}});}

function networkChanged(online,changed=false){
 if(!shouldRestartNetwork(networkOnline,online,changed))return;
 networkOnline=online;clearTimeout(networkRestartTimer);clearTimeout(retryTimer);
 if(!wanted||!pageActive)return;
 peer?.close('transport-failed');client?.stop();
 if(!online){status('This device is offline — waiting for internet.');return;}
 status('Network changed — restoring your connection…');
 networkRestartTimer=setTimeout(()=>{if(!wanted||!pageActive||!networkOnline)return;client?.start().then(()=>{if(autoGrant)scheduleRemote();}).catch(error=>{if(error.name!=='AbortError')status(error.message);});},400);
}
window.addEventListener('offline',()=>networkChanged(false));window.addEventListener('online',()=>networkChanged(true));
window.addEventListener('devicebridge-network',event=>{if(typeof event.detail?.online==='boolean')networkChanged(event.detail.online,event.detail.changed===true);});
