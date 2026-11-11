import test from 'node:test';import assert from 'node:assert/strict';
import {RemotePeer} from './peer.mjs';
globalThis.MediaStream=class{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(t,{permissions=['view','input'],acquire,peerOptions={}}={}){
 const grant={id:'GGGGGGGGGGGGGGGG',hostId:'HHHHHHHHHHHHHHHH',controllerId:'CCCCCCCCCCCCCCCC',revision:1,permissions,reconnect:true,expiresAt:Date.now()+60000},record={grant};
 const pcs=[],inputs=[],events=[],counts={release:0,dispose:0,encoderChanges:0};
 class PC{constructor(){pcs.push(this);this.connectionState='new';}addTransceiver(){this.replacements??=[];return{sender:this.sender={replaceTrack:async track=>{this.replacements.push(track);}}};}createDataChannel(){return this.channel=new Channel();}async createOffer(){return{type:'offer',sdp:'offer'};}async createAnswer(){return{type:'answer',sdp:'answer'};}async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(d){this.remoteDescription=d;}addTrack(){return{getParameters:()=>({encodings:[{}]}),setParameters:async()=>counts.encoderChanges++};}async getStats(){return new Map();}async addIceCandidate(candidate){this.receivedCandidates??=[];this.receivedCandidates.push(candidate);}close(){this.connectionState='closed';}}
 class Channel{label='control';readyState='connecting';bufferedAmount=0;sent=[];send(data){this.sent.push(data);queueMicrotask(()=>{if(this.other?.readyState==='open')this.other.onmessage?.({data});});}close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();}}
 class Client{listeners=new Set();constructor(deviceId){this.deviceId=deviceId;}subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}async sendSignal(grantId,message){for(const fn of [...this.other.listeners])fn({type:'signal',signed:{grantId,message}});}}
 const hostClient=new Client(grant.hostId),phoneClient=new Client(grant.controllerId);hostClient.other=phoneClient;phoneClient.other=hostClient;
 const resources={videoTrack:{kind:'video'},display:{id:'DDDDDDDDDDDDDDDD',width:1280,height:800},permissions,applyInput:x=>inputs.push(x),releaseInput:()=>counts.release++,dispose:()=>counts.dispose++};
 const host=new RemotePeer({client:hostClient,record,role:'host',PeerConnection:PC,...peerOptions,acquireHost:acquire||(async()=>resources),event:e=>events.push(e)});
 const phone=new RemotePeer({client:phoneClient,record,role:'controller',PeerConnection:PC,...peerOptions,event:e=>events.push(e)});
 t.after(()=>{phone.close();host.close();});
 const connect=async()=>{await phone.begin({generation:1});await flush();const a=pcs[1].channel,b=new Channel();a.other=b;b.other=a;pcs[0].ondatachannel({channel:b});a.readyState=b.readyState='open';a.onopen();await flush();return{a,b};};
 return{grant,record,host,phone,pcs,inputs,events,counts,resources,connect,hostClient,phoneClient};
}
test('peer handshake preserves the full Unicode input payload and display metadata',async t=>{
 const f=setup(t),{a}=await f.connect();assert.ok(f.host.ready&&f.phone.ready);assert.equal(f.phone.display.width,1280);
 const text='DeviceBridge remote typing test — hello 👋 नमस्ते';assert.equal(f.phone.sendInput({type:'text',text}),true);await flush();assert.deepEqual(f.inputs,[{type:'text',text}]);assert.equal(JSON.parse(a.sent.at(-1)).payload.text,text);
});
test('effective view-only permission blocks injected input and cleans the host',async t=>{
 const f=setup(t,{permissions:['view']}),{a,b}=await f.connect();assert.equal(f.phone.sendInput({type:'text',text:'no'}),false);
 const open=JSON.parse(a.sent[0]);b.onmessage({data:JSON.stringify({...open,kind:'input',seq:1,payload:{type:'text',text:'forged'}})});await flush();assert.equal(f.inputs.length,0);assert.equal(f.host.ready,false);assert.equal(f.counts.release,1);assert.equal(f.counts.dispose,1);
});
test('a pointer for the wrong display stops the session instead of moving the desktop',async t=>{
 const f=setup(t);await f.connect();f.phone.sendInput({type:'pointer',point:{displayId:'XXXXXXXXXXXXXXXX',x:.5,y:.5}});await flush();assert.equal(f.inputs.length,0);assert.equal(f.host.ready,false);assert.equal(f.counts.release,1);
});
test('replayed data cannot inject a second key press',async t=>{
 const f=setup(t),{a,b}=await f.connect();f.phone.sendInput({type:'key',code:'KeyA',down:true});await flush();b.onmessage({data:a.sent.at(-1)});await flush();assert.equal(f.inputs.length,1);assert.equal(f.counts.release,1);
});
test('closing while capture is pending disposes resources returned late',async t=>{
 let resolveCapture;const capture=new Promise(resolve=>resolveCapture=resolve);const f=setup(t,{acquire:()=>capture});await f.phone.begin({generation:1});await flush();f.host.close('user');resolveCapture(f.resources);await flush();assert.equal(f.counts.dispose,1);assert.equal(f.host.ready,false);
});
test('backpressure closes the peer and releases input without recursive close',async t=>{
 const f=setup(t),{a}=await f.connect();a.bufferedAmount=129*1024;assert.equal(f.phone.sendInput({type:'text',text:'x'}),false);await flush();assert.equal(f.phone.ready,false);f.host.close();assert.equal(f.counts.release,1);
});

test('screen acquisition errors survive close so the UI can show the actual failure',async t=>{
 const f=setup(t,{acquire:async()=>{throw Error('The computer display is unavailable');}});await f.phone.begin({generation:1});await flush();
 const closed=f.events.find(e=>e.type==='closed');assert.equal(closed.message,'The computer display is unavailable');assert.equal(closed.reason,'transport-failed');assert.equal(f.host.ready,false);
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
test('restored mode sends Unicode input over the ordered WebRTC channel without a TCP relay',async t=>{
 const f=setup(t),{a}=await f.connect();f.phoneClient.sendControl=()=>{throw Error('Separate TCP relay must not be used');};const text='Original connection नमस्ते 👋';assert.equal(f.phone.sendInput({type:'text',text}),true);await flush();assert.deepEqual(f.inputs,[{type:'text',text}]);assert.equal(JSON.parse(a.sent.at(-1)).kind,'input');const report=await f.phone.diagnostics();assert.equal(report.controlTransport,'webrtc-datachannel');assert.equal(report.forcedMediaProtocol,false);
});
test('restored negotiation forwards TCP ICE candidates instead of enforcing UDP',async t=>{
 const f=setup(t);await f.connect();const signals=[],send=f.phoneClient.sendSignal.bind(f.phoneClient);f.phoneClient.sendSignal=async(...args)=>{signals.push(args[1]);await send(...args);};const value={candidate:'candidate:1 1 tcp 1 example.local 9 typ host tcptype active',sdpMid:'0',sdpMLineIndex:0};f.pcs[1].onicecandidate({candidate:{protocol:'tcp',toJSON:()=>value}});await flush();assert.equal(signals.at(-1).payload.type,'candidate');assert.deepEqual(f.pcs[0].receivedCandidates.at(-1),value);
});
test('restored video never applies the added bitrate or resolution profiles',async t=>{const f=setup(t);await f.connect();await flush();assert.equal(f.counts.encoderChanges,0);assert.equal(f.host.display.width,1280);assert.equal((await f.host.diagnostics()).quality,'original');});
test('the original direct session survives a connection-service interruption',async t=>{
 const f=setup(t);await f.connect();for(const client of [f.hostClient,f.phoneClient])for(const listener of [...client.listeners])listener({type:'status',status:'service-offline'});assert.equal(f.phone.ready,true);assert.equal(f.host.ready,true);f.phone.sendInput({type:'text',text:'direct'});await flush();assert.equal(f.inputs[0].text,'direct');assert.equal(f.counts.dispose,0);
});
