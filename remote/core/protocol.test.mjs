import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROTOCOL, VERSION, validateHello, negotiate, encodeMessage, decodeMessage, validateInput, SessionGate} from './protocol.mjs';

const hostId = 'host_device_00000001', clientId = 'phone_device_0000001';
const hello = (deviceId = hostId, platform = 'windows', roles = ['host']) => ({protocol: PROTOCOL, minVersion: 1, maxVersion: 1, deviceId, platform, roles, modes: ['remote-access'], capabilities: ['view','input','speaker','microphone']});
const packet = (payload = {type:'text',text:'Hello 👋 नमस्ते 你好'}, seq = 0) => ({protocol:PROTOCOL,version:VERSION,sessionId:'session_random_00001',generation:1,seq,kind:'input',payload});
const gate = permissions => new SessionGate({sessionId:'session_random_00001',generation:1,permissions});

test('all supported desktop/mobile control combinations negotiate the same v1 contract',()=>{
 for(const platform of ['windows','macos'])for(const client of ['windows','macos','android','ios']) {
  const agreed=negotiate(hello(hostId,platform),hello(clientId,client,['controller']),['view','input','speaker','microphone']);
  assert.equal(agreed.version,1); assert.equal(agreed.capabilities.length,4);
 }
});
test('older/newer version overlap is negotiated and incompatible versions fail closed',()=>{
 const h=hello(),c=hello(clientId,'ios',['controller']); h.maxVersion=3; assert.equal(negotiate(h,c).version,1);
 c.minVersion=2;c.maxVersion=3;assert.throws(()=>negotiate(h,c),/supported protocol/);
});
test('mobile hosts, self-connections, wrong modes and malformed capabilities are rejected',()=>{
 assert.throws(()=>validateHello(hello(hostId,'ios')),/unsupported/);
 assert.throws(()=>negotiate(hello(),hello(hostId,'windows',['controller'])),/itself/);
 const c=hello(clientId,'android',['controller']);c.modes=['local-share'];assert.throws(()=>negotiate(hello(),c),/Remote mode/);
 assert.throws(()=>validateHello({...hello(),capabilities:['view','view']}),/capability/);
 assert.throws(()=>validateHello({...hello(),capabilities:['shell']}),/capability/);
});
test('negotiation intersects capability support but never grants permission',()=>{
 const h=hello();h.capabilities=['view'];assert.deepEqual(negotiate(h,hello(clientId,'ios',['controller']),['view','microphone']).capabilities,['view']);
 assert.throws(()=>negotiate(hello(),hello(clientId,'ios',['controller']),['input']),/requires view/);
});
test('Unicode input round trips and all defined event kinds validate',()=>{
 assert.deepEqual(decodeMessage(encodeMessage(packet())),packet());
 for(const p of [{type:'pointer',point:{displayId:'display_random_00001',x:0,y:1}},{type:'button',button:'primary',down:true},{type:'key',code:'MetaLeft',down:false},{type:'scroll',dx:1,dy:-5},{type:'release-all'}]) assert.equal(validateInput(p),p);
});
test('out-of-bounds coordinates, unsafe keys/text and unknown event fields fail',()=>{
 for(const p of [{type:'pointer',point:{displayId:'display_random_00001',x:2,y:0}},{type:'key',code:'Ctrl+X',down:true},{type:'text',text:'\0'},{type:'text',text:'🙂'.repeat(1025)},{type:'button',button:'primary',down:'true'},{type:'scroll',dx:NaN,dy:0},{type:'release-all',down:true}])assert.throws(()=>validateInput(p));
});
test('strict framing rejects unknown protocols, fields and oversized payloads',()=>{
 assert.throws(()=>decodeMessage('not JSON'));
 assert.throws(()=>decodeMessage(' '.repeat(65537)),/too large/);
 for(const p of [{...packet(),version:8},{...packet(),command:'run'},{...packet(),kind:'shell'},{...packet(),seq:-1}]) assert.throws(()=>encodeMessage(p));
});
test('session gate rejects replay, wrong sessions and stale reconnect generations',()=>{
 const g=gate(['view','input']);assert.equal(g.accept(packet()),true);assert.equal(g.accept(packet()),false);
 assert.equal(g.accept({...packet(undefined,1),sessionId:'another_session_0001'}),false);
 assert.equal(g.accept({...packet(undefined,1),generation:2}),false);assert.equal(g.accept(packet(undefined,1)),true);
});
test('input requires current view and input permissions, not just capability support',()=>{
 for(const permissions of [[],['view'],['input']])assert.equal(gate(permissions).accept(packet()),false);
});
test('explicit stop closes the gate and setup messages cannot change session permissions',()=>{
 const g=gate(['view','input']);assert.equal(g.accept({...packet(),kind:'session.ready',payload:{permissions:['view','input','microphone'],permissionRevision:1}}),false);
 assert.equal(g.accept({...packet(),kind:'session.stop',payload:{reason:'user'}}),true);assert.equal(g.accept(packet(undefined,1)),false);
 const another=gate(['view','input']);another.close();assert.equal(another.accept(packet()),false);
});
test('signal and setup messages have bounded, versioned payloads',()=>{
 const setup={...packet(),kind:'session.open',payload:{deviceId:clientId,grantId:'grant_random_0000001',permissionRevision:1,permissions:['view']}};
 assert.deepEqual(decodeMessage(encodeMessage(setup)),setup);
 assert.throws(()=>encodeMessage({...setup,payload:{...setup.payload,permissions:['input']}}));
 assert.throws(()=>encodeMessage({...packet(),kind:'signal',payload:{type:'offer',data:'x'.repeat(50000)}}));
});
test('new remote protocol is distinct from the unchanged Windows LAN protocol 8',()=>{
 const source=fs.readFileSync(new URL('../../app/DeviceBridge/Connection.cs',import.meta.url),'utf8');
 assert.match(source,/public const int Protocol = 8;/);
 assert.throws(()=>decodeMessage(JSON.stringify({Kind:'auth',Text:'test-only',A:8})),/Unknown field/);
 assert.throws(()=>validateHello({protocol:8}));
});
