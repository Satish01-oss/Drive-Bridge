import test from 'node:test';import assert from 'node:assert/strict';
import {RemotePeer} from './peer.mjs';
globalThis.MediaStream=class{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(t,{permissions=['view','input'],acquire,peerOptions={}}={}){
 const grant={id:'GGGGGGGGGGGGGGGG',hostId:'HHHHHHHHHHHHHHHH',controllerId:'CCCCCCCCCCCCCCCC',revision:1,permissions,reconnect:true,expiresAt:Date.now()+60000},record={grant};
 let closedResolve;const closed=new Promise(resolve=>closedResolve=resolve);const recordEvent=e=>{events.push(e);if(e.type==='closed')closedResolve(e);};
 const pcs=[],inputs=[],events=[],counts={release:0,dispose:0};
 class PC{constructor(){pcs.push(this);this.connectionState='new';}addTransceiver(){this.replacements??=[];return{sender:this.sender={replaceTrack:async track=>{this.replacements.push(track);}}};}createDataChannel(){return this.channel=new Channel();}async createOffer(){return{type:'offer',sdp:'offer'};}async createAnswer(){return{type:'answer',sdp:'answer'};}async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(d){this.remoteDescription=d;}addTrack(){}async addIceCandidate(){}close(){this.connectionState='closed';}}
 class Channel{label='control';readyState='connecting';bufferedAmount=0;sent=[];send(data){this.sent.push(data);queueMicrotask(()=>{if(this.other?.readyState==='open')this.other.onmessage?.({data});});}close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();}}
 class Client{async sessionAvailable(){return true;}
 listeners=new Set();constructor(deviceId){this.deviceId=deviceId;}subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}sendControl(frame){for(const fn of [...this.other.listeners])fn({type:'control',frame});}async sendSignal(grantId,message){for(const fn of [...this.other.listeners])fn({type:'signal',signed:{grantId,message}});}}
 const hostClient=new Client(grant.hostId),phoneClient=new Client(grant.controllerId);hostClient.other=phoneClient;phoneClient.other=hostClient;
 const resources={videoTrack:{kind:'video'},display:{id:'DDDDDDDDDDDDDDDD',width:1280,height:800},permissions,applyInput:x=>inputs.push(x),releaseInput:()=>counts.release++,dispose:()=>counts.dispose++};
 const host=new RemotePeer({client:hostClient,record,role:'host',PeerConnection:PC,...peerOptions,acquireHost:acquire||(async()=>resources),event:recordEvent});
 const phone=new RemotePeer({client:phoneClient,record,role:'controller',PeerConnection:PC,...peerOptions,event:recordEvent});
 t.after(()=>{phone.close();host.close();});
 const connect=async()=>{await phone.begin({generation:1});for(let i=0;i<100&&(!pcs[0].localDescription||!pcs[1].remoteDescription);i++)await flush();const a=pcs[1].channel,b=new Channel();a.other=b;b.other=a;pcs[0].ondatachannel({channel:b});a.readyState=b.readyState='open';a.onopen();for(let i=0;i<100&&(!host.ready||!phone.ready);i++)await flush();return{a,b};};
 return{grant,record,host,phone,pcs,inputs,events,counts,resources,connect,hostClient,phoneClient,closed};
}
test('peer handshake preserves the full Unicode input payload and display metadata',async t=>{
 const f=setup(t),{a}=await f.connect();assert.ok(f.host.ready&&f.phone.ready);assert.equal(f.phone.display.width,1280);
 const text='DeviceBridge remote typing test — hello 👋 नमस्ते';assert.equal(await f.phone.sendInputAcknowledged({type:'text',text}),true);assert.deepEqual(f.inputs,[{type:'text',text}]);assert.equal((await f.phone.diagnostics()).controlTransport,'tcp-wss-e2e');
});
test('effective view-only permission blocks injected input and cleans the host',async t=>{
 const f=setup(t,{permissions:['view']}),{a,b}=await f.connect();assert.equal(f.phone.sendInput({type:'text',text:'no'}),false);
 const open=JSON.parse(a.sent[0]);b.onmessage({data:JSON.stringify({...open,kind:'input',seq:1,payload:{type:'text',text:'forged'}})});await flush();assert.equal(f.inputs.length,0);assert.equal(f.host.ready,false);assert.equal(f.counts.release,1);assert.equal(f.counts.dispose,1);
});
test('a pointer for the wrong display stops the session instead of moving the desktop',async t=>{
 const f=setup(t);await f.connect();await assert.rejects(f.phone.sendInputAcknowledged({type:'pointer',point:{displayId:'XXXXXXXXXXXXXXXX',x:.5,y:.5}}));await flush();assert.equal(f.inputs.length,0);assert.equal(f.host.ready,false);assert.equal(f.counts.release,1);
});
test('replayed data cannot inject a second key press',async t=>{
 const f=setup(t),{a,b}=await f.connect();await f.phone.sendInputAcknowledged({type:'key',code:'KeyA',down:true});b.onmessage({data:a.sent.at(-1)});await flush();assert.equal(f.inputs.length,1);assert.equal(f.counts.release,1);
});
test('closing while capture is pending disposes resources returned late',async t=>{
 let resolveCapture,markStarted;const started=new Promise(resolve=>markStarted=resolve),capture=new Promise(resolve=>resolveCapture=resolve);const f=setup(t,{acquire:()=>{markStarted();return capture;}});await f.phone.begin({generation:1});await started;f.host.close('user');resolveCapture(f.resources);await flush();assert.equal(f.counts.dispose,1);assert.equal(f.host.ready,false);
});
test('backpressure closes the peer and releases input without recursive close',async t=>{
 const f=setup(t);await f.connect();f.phoneClient.sendControl=()=>{throw Error('Control connection is congested');};await assert.rejects(f.phone.sendInputAcknowledged({type:'text',text:'x'}),/congested/);await flush();assert.equal(f.phone.ready,false);f.host.close();assert.equal(f.counts.release,1);
});

test('screen acquisition errors survive close so the UI can show the actual failure',{timeout:3000},async t=>{
 const f=setup(t,{acquire:async()=>{throw Error('The computer display is unavailable');}});await f.phone.begin({generation:1});
 const closed=await f.closed;assert.equal(closed.message,'The computer display is unavailable');assert.equal(closed.reason,'transport-failed');assert.equal(f.host.ready,false);
});

test('connection diagnostics report video progress without candidate addresses or identifiers',async t=>{
 const f=setup(t);await f.connect();f.pcs[1].getStats=async()=>new Map([['private',{type:'local-candidate',address:'192.168.1.5',usernameFragment:'secret'}],['video',{type:'inbound-rtp',kind:'video',framesReceived:5,framesDecoded:4,id:'private-id'}]]);
 const report=await f.phone.diagnostics();assert.equal(report.videoFramesReceived,5);assert.equal(report.videoFramesDecoded,4);assert.equal(report.control,'open');assert.ok(!JSON.stringify(report).match(/192\.168|secret|private-id/));
});

test('a lost heartbeat closes the transport without expiring trusted permission',async t=>{
 let now=Date.now();const ticks=[];const f=setup(t,{peerOptions:{now:()=>now,interval:fn=>{ticks.push(fn);return 1;},cancelInterval:()=>{}}});await f.connect();now+=46000;ticks.at(-1)();assert.equal(f.phone.ready,false);assert.equal(f.events.find(e=>e.type==='closed').reason,'transport-failed');assert.ok(f.grant.expiresAt>now);
});
test('an actually expired approval still requires fresh consent',async t=>{
 let now=Date.now();const ticks=[];const f=setup(t,{peerOptions:{now:()=>now,interval:fn=>{ticks.push(fn);return 1;},cancelInterval:()=>{}}});await f.connect();now=f.grant.expiresAt;ticks.at(-1)();assert.equal(f.events.find(e=>e.type==='closed').reason,'expired');
});

function micStream(){const track={stopped:false,stop(){this.stopped=true;}};return{track,getTracks:()=>[track],getAudioTracks:()=>[track]};}
test('a microphone prompt completing after mute cannot turn capture back on',async t=>{
 let resolve;const pending=new Promise(done=>resolve=done),stream=micStream(),f=setup(t,{permissions:['view','microphone'],peerOptions:{getUserMedia:()=>pending}});await f.connect();const enabling=f.phone.microphone(true);await f.phone.microphone(false);resolve(stream);await enabling;assert.equal(stream.track.stopped,true);assert.deepEqual(f.pcs[1].replacements,[null]);
});
test('a microphone prompt completing after disconnect stops its returned track',async t=>{
 let resolve;const pending=new Promise(done=>resolve=done),stream=micStream(),f=setup(t,{permissions:['view','microphone'],peerOptions:{getUserMedia:()=>pending}});await f.connect();const enabling=f.phone.microphone(true);f.phone.close('user');resolve(stream);await enabling;assert.equal(stream.track.stopped,true);assert.deepEqual(f.pcs[1].replacements,[]);
});
test('microphone replacement failure stops capture and preserves the error',async t=>{
 const stream=micStream(),f=setup(t,{permissions:['view','microphone'],peerOptions:{getUserMedia:async()=>stream}});await f.connect();f.pcs[1].sender.replaceTrack=async()=>{throw Error('sender stopped');};await assert.rejects(f.phone.microphone(true),/sender stopped/);assert.equal(stream.track.stopped,true);
});


test('a thrown transport send still closes once and releases every host resource',async t=>{
 const f=setup(t),{b}=await f.connect();b.send=()=>{throw Error('network changed');};f.host.close('transport-failed');assert.equal(f.host.ready,false);assert.equal(f.counts.release,1);assert.equal(f.counts.dispose,1);assert.equal(f.events.filter(e=>e.type==='closed').length,1);
});
test('a cleanup failure cannot skip remaining cleanup or the disconnected event',async t=>{
 const f=setup(t);await f.connect();f.resources.releaseInput=()=>{f.counts.release++;throw Error('release unavailable');};f.resources.dispose=()=>{f.counts.dispose++;throw Error('dispose unavailable');};f.host.close('user');assert.equal(f.counts.release,1);assert.equal(f.counts.dispose,1);assert.deepEqual(f.events.find(e=>e.type==='closed').cleanupErrors,['release-input','dispose-media']);assert.equal(f.host.active,false);
});

test('browser timer APIs are invoked with the global receiver',async t=>{let started=0;const f=setup(t,{peerOptions:{interval:function(){assert.equal(this,globalThis);started++;return 1;},cancelInterval:function(){assert.equal(this,globalThis);}}});await f.connect();assert.equal(started,2);assert.equal(f.phone.ready,true);f.phone.close();f.host.close();});

test('TCP typing completes only after host acceptance and remains ordered',async t=>{const f=setup(t);await f.connect();let release;const gate=new Promise(done=>release=done);f.resources.applyInputAndWait=async input=>{await gate;f.inputs.push(input);};let acknowledged=false;const first=f.phone.sendInputAcknowledged({type:'text',text:'first'}).then(()=>acknowledged=true),second=f.phone.sendInputAcknowledged({type:'key',code:'Enter',down:true});await flush();assert.equal(acknowledged,false);assert.equal(f.inputs.length,0);release();await Promise.all([first,second]);assert.deepEqual(f.inputs.map(x=>x.type),['text','key']);assert.equal((await f.phone.diagnostics()).acknowledgedControls,2);});
test('unconfirmed TCP text rejects on disconnect instead of replaying in a new session',async t=>{const f=setup(t);await f.connect();f.phoneClient.sendControl=()=>{};const sent=f.phone.sendInputAcknowledged({type:'text',text:'do not replay'});await flush();f.phone.close('transport-failed');await assert.rejects(sent,/not confirmed/);assert.equal(f.inputs.length,0);assert.equal((await f.phone.diagnostics()).pendingControls,0);});

test('pointer coalescing preserves the final position before a click and never drops button/key events',async t=>{const f=setup(t);await f.connect();f.phone.sendInput({type:'pointer',point:{displayId:f.phone.display.id,x:.1,y:.2}});f.phone.sendInput({type:'pointer',point:{displayId:f.phone.display.id,x:.7,y:.8}});f.phone.sendInput({type:'button',button:'primary',down:true});await f.phone.sendInputAcknowledged({type:'key',code:'Enter',down:true});assert.deepEqual(f.inputs.map(i=>i.type),['pointer','button','key']);assert.equal(f.inputs[0].point.x,.7);assert.equal((await f.phone.diagnostics()).acknowledgedControls,3);});

test('screen media only forwards UDP ICE candidates',async t=>{const f=setup(t);await f.connect();let encoded=false;f.pcs[1].onicecandidate({candidate:{protocol:'tcp',toJSON(){encoded=true;return{};}}});assert.equal(encoded,false);});
const clientEvent=(client,event)=>{for(const listener of [...client.listeners])listener(event);};
test('a brief presence interruption pauses controls without disposing UDP media',async t=>{
 const f=setup(t);await f.connect();clientEvent(f.phoneClient,{type:'presence',deviceId:f.grant.hostId,online:false});
 assert.equal(f.phone.active,true);assert.equal(f.phone.ready,false);assert.equal(f.phone.sendInput({type:'text',text:'blocked'}),false);assert.equal(f.counts.dispose,0);
 clientEvent(f.phoneClient,{type:'presence',deviceId:f.grant.hostId,online:true});assert.equal(f.phone.ready,true);assert.equal(await f.phone.sendInputAcknowledged({type:'text',text:'resumed'}),true);assert.equal(f.inputs.length,1);
});
test('a short service outage resumes only after confirming the same secure session',async t=>{
 const f=setup(t);await f.connect();let checks=0;f.hostClient.sessionAvailable=async()=>{checks++;return true;};
 clientEvent(f.hostClient,{type:'status',status:'service-offline'});assert.equal(f.host.active,true);assert.equal(f.host.ready,false);assert.equal(f.counts.release,1);assert.equal(f.counts.dispose,0);
 clientEvent(f.hostClient,{type:'status',status:'service-connected'});await flush();assert.equal(checks,1);assert.equal(f.host.ready,true);assert.equal(f.counts.dispose,0);
});
test('service restart with a missing session closes once for fresh authenticated recovery',async t=>{
 const f=setup(t);await f.connect();f.phoneClient.sessionAvailable=async()=>false;clientEvent(f.phoneClient,{type:'status',status:'service-offline'});clientEvent(f.phoneClient,{type:'status',status:'service-connected'});await flush();assert.equal(f.phone.active,false);assert.match(f.events.find(e=>e.type==='closed').message,/service restarted/);
});
test('an interruption with unconfirmed input closes without replaying it',async t=>{
 const f=setup(t);await f.connect();f.phoneClient.sendControl=()=>{};const pending=f.phone.sendInputAcknowledged({type:'text',text:'unconfirmed'});clientEvent(f.phoneClient,{type:'status',status:'service-offline'});await assert.rejects(pending,/not confirmed/);assert.equal(f.phone.active,false);assert.equal(f.inputs.length,0);
});
test('the recovery grace period is bounded and releases sharing after timeout',async t=>{
 const callbacks=[];const f=setup(t,{peerOptions:{recoveryTimeout:(fn,delay)=>{assert.equal(delay,8000);callbacks.push(fn);return 1;},cancelRecoveryTimeout:()=>{}}});await f.connect();clientEvent(f.phoneClient,{type:'presence',deviceId:f.grant.hostId,online:false});callbacks[0]();assert.equal(f.phone.active,false);assert.match(f.events.find(e=>e.type==='closed').message,/did not recover/);
});
test('revocation cancels a late service recovery reply',async t=>{
 let release;const checking=new Promise(resolve=>release=resolve),f=setup(t);await f.connect();f.phoneClient.sessionAvailable=()=>checking;clientEvent(f.phoneClient,{type:'status',status:'service-offline'});clientEvent(f.phoneClient,{type:'status',status:'service-connected'});clientEvent(f.phoneClient,{type:'grant-revoked',grantId:f.grant.id});release(true);await flush();assert.equal(f.phone.active,false);assert.equal(f.events.filter(e=>e.type==='recovered').length,0);
});
test('explicit service stop never uses the recovery grace period',async t=>{const f=setup(t);await f.connect();clientEvent(f.phoneClient,{type:'status',status:'stopped'});assert.equal(f.phone.active,false);assert.equal(f.events.find(e=>e.type==='closed').reason,'user');});
