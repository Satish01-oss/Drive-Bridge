import test from 'node:test';import assert from 'node:assert/strict';import {acquireNativeHost} from './native-media.mjs';
function fixture(t,decode=async()=>{}){
 const previous={document:globalThis.document,Image:globalThis.Image},counts={draw:0,request:0,stop:0},posts=[],resources=new Map();
 const track={requestFrame:()=>counts.request++,stop:()=>counts.stop++};
 globalThis.document={createElement:()=>({getContext:()=>({drawImage:(image,x,y,width,height)=>{counts.draw++;counts.width=width;counts.height=height;}}),captureStream:fps=>{assert.equal(fps,12);return ({getVideoTracks:()=>[track],getTracks:()=>[track]});}})};globalThis.Image=class{async decode(){await decode();}};
 t.after(()=>Object.assign(globalThis,previous));
 return {counts,posts,create:()=>acquireNativeHost({id:'grant'},{rpc:async()=>({captureId:'capture',displayId:'display',width:1280,height:800,permissions:['view']}),post:v=>posts.push(v),status:()=>{},resources})};
}
test('the original native screen pipeline preserves the full capture dimensions',async t=>{const f=fixture(t),source=await f.create();await source.handle({type:'frame',jpeg:'test'});assert.equal(f.counts.draw,1);assert.equal(f.counts.width,1280);assert.equal(f.counts.height,800);assert.deepEqual(f.posts,[{type:'frame.ack',captureId:'capture'}]);source.dispose();});
test('a frame decoded after capture stops cannot paint or request more frames',async t=>{let release;const pending=new Promise(resolve=>release=resolve),f=fixture(t,()=>pending),source=await f.create();const receiving=source.handle({type:'frame',jpeg:'test'});source.dispose();release();await receiving;assert.equal(f.counts.draw,0);assert.equal(f.counts.request,0);assert.equal(f.counts.stop,1);});
