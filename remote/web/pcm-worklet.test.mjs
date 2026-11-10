import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=await readFile(new URL('./pcm-worklet.mjs',import.meta.url),'utf8');
function worklets(){
 const processors=new Map();
 const context=vm.createContext({Float32Array,Number,sampleRate:48000,AudioWorkletProcessor:class{constructor(){this.messages=[];this.port={postMessage:value=>this.messages.push(value)};}},registerProcessor:(name,type)=>processors.set(name,type)});
 vm.runInContext(code,context);return {source:new (processors.get('remote-pcm-source'))(),sink:new (processors.get('remote-pcm-sink'))()};
}
test('speaker worklet preserves stereo order and fills underruns with silence',()=>{
 const {source}=worklets();source.port.onmessage({data:{samples:new Float32Array([.25,-.5,.75,-1]),channels:2}});
 const output=[new Float32Array(4),new Float32Array(4)];assert.equal(source.process([], [output]),true);
 assert.deepEqual([...output[0]],[.25,.75,0,0]);assert.deepEqual([...output[1]],[-.5,-1,0,0]);assert.equal(source.frames,0);
});
test('speaker worklet rejects incomplete, nonfinite and oversized packets and bounds latency',()=>{
 const {source}=worklets();for(const data of [{samples:new Float32Array([1]),channels:2},{samples:new Float32Array([NaN]),channels:1},{samples:new Float32Array(48001),channels:1},null])source.port.onmessage({data});
 assert.equal(source.queue.length,0);
 for(let i=0;i<20;i++)source.port.onmessage({data:{samples:new Float32Array(2048).fill(i),channels:1}});
 assert.ok(source.frames<=12000);assert.ok(source.queue.length<=5);
});
test('microphone worklet mixes stereo into complete independent mono packets',()=>{
 const {sink}=worklets();const input=[new Float32Array(1024).fill(.75),new Float32Array(1024).fill(-.25)];
 sink.process([input]);assert.equal(sink.messages.length,0);sink.process([input]);assert.equal(sink.messages.length,1);
 assert.equal(sink.messages[0].length,2048);assert.ok(sink.messages[0].every(value=>value===.25));
 sink.process([[new Float32Array(2048).fill(-.5)]]);assert.equal(sink.messages.length,2);assert.ok(sink.messages[1].every(value=>value===-.5));assert.ok(sink.messages[0].every(value=>value===.25));
});
