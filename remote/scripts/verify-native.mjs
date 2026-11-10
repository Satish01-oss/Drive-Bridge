import fs from 'node:fs';import {verifiedSignature,publicIdentity} from '../service/identity.mjs';
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!verifiedSignature(fixture.publicKey,fixture.purpose,fixture.value,fixture.signature))throw Error('Windows signature does not match the shared protocol');
if(!publicIdentity(fixture.publicKey).id)throw Error('Invalid Windows public key');
console.log('Native Windows protected-key signing matches Node/browser canonical JSON and Ed25519 verification.');
