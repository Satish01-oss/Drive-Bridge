import test from 'node:test';import assert from 'node:assert/strict';
import {RemotePeer} from './peer.mjs';
globalThis.MediaStream=class{constructor(tracks){this.tracks=tracks;}getTracks(){return this.tracks;}};
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
function setup(t,{permissions=['view','input'],acquire}={}){
 const grant={id:'GGGGGGGGGGGGGGGG',hostId:'HHHHHHHHHHHHHHHH',controllerId:'CCCCCCCCCCCCCCCC',revision:1,permissions,reconnect:true,expiresAt:Date.now()+60000},record={grant};
 const pcs=[],inputs=[],events=[],counts={release:0,dispose:0};
 class PC{constructor(){pcs.push(this);this.connectionState='new';}addTransceiver(){return{sender:{replaceTrack:async()=>{}}};}createDataChannel(){return this.channel=new Channel();}async createOffer(){return{type:'offer',sdp:'offer'};}async createAnswer(){return{type:'answer',sdp:'answer'};}async setLocalDescription(d){this.localDescription=d;}async setRemoteDescription(d){this.remoteDescription=d;}addTrack(){}async addIceCandidate(){}close(){this.connectionState='closed';}}
 class Channel{label='control';readyState='connecting';bufferedAmount=0;sent=[];send(data){this.sent.push(data);queueMicrotask(()=>{if(this.other?.readyState==='open')this.other.onmessage?.({data});});}close(){if(this.readyState==='closed')return;this.readyState='closed';this.onclose?.();}}
 class Client{listeners=new Set();constructor(deviceId){this.deviceId=deviceId;}subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}async sendSignal(grantId,message){for(const fn of [...this.other.listeners])fn({type:'signal',signed:{grantId,message}});}}
 const hostClient=new Client(grant.hostId),phoneClient=new Client(grant.controllerId);hostClient.other=phoneClient;phoneClient.other=hostClient;
 const resources={videoTrack:{kind:'video'},display:{id:'DDDDDDDDDDDDDDDD',width:1280,height:800},permissions,applyInput:x=>inputs.push(x),releaseInput:()=>counts.release++,dispose:()=>counts.dispose++};
 const host=new RemotePeer({client:hostClient,record,role:'host',PeerConnection:PC,acquireHost:acquire||(async()=>resources),event:e=>events.push(e)});
 const phone=new RemotePeer({client:phoneClient,record,role:'controller',PeerConnection:PC,event:e=>events.push(e)});
 t.after(()=>{phone.close();host.close();});
 const connect=async()=>{await phone.begin({generation:1});await flush();const a=pcs[1].channel,b=new Channel();a.other=b;b.other=a;pcs[0].ondatachannel({channel:b});a.readyState=b.readyState='open';a.onopen();await flush();return{a,b};};
 return{grant,record,host,phone,pcs,inputs,events,counts,resources,connect,hostClient};
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
