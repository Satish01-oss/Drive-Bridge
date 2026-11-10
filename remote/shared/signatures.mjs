// Identical signing bytes in browsers, Node and native conformance vectors.
export function canonical(value){
 if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 throw Error('Invalid signed value');
}
export const signingBytes=(purpose,value)=>new TextEncoder().encode('devicebridge.'+purpose+'.v1\n'+canonical(value));
export function toBase64Url(bytes){let binary='';for(const value of bytes)binary+=String.fromCharCode(value);return btoa(binary).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function fromBase64Url(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value)||value.length>512)throw Error('Invalid base64url');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));}
export async function createIdentity(){const keys=await crypto.subtle.generateKey('Ed25519',false,['sign','verify']);return {keys,publicKey:toBase64Url(new Uint8Array(await crypto.subtle.exportKey('spki',keys.publicKey)))};}
export async function identityId(publicKey){return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',fromBase64Url(publicKey))));}
export async function signValue(identity,purpose,value){return toBase64Url(new Uint8Array(await crypto.subtle.sign('Ed25519',identity.keys.privateKey,signingBytes(purpose,value))));}
export async function verifyValue(publicKey,purpose,value,signature){
 if(globalThis.DeviceBridgeNativeVerify)return await globalThis.DeviceBridgeNativeVerify(publicKey,purpose,value,signature);
 try{const key=await crypto.subtle.importKey('spki',fromBase64Url(publicKey),'Ed25519',false,['verify']);return await crypto.subtle.verify('Ed25519',key,fromBase64Url(signature),signingBytes(purpose,value));}catch{return false;}
}
