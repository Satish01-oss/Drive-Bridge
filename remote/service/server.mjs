import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {WebSocketServer,WebSocket} from 'ws';
import {Broker,ServiceError,exact} from './broker.mjs';

const MAX=64*1024;
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(JSON.stringify(value));}
function readBody(req){return new Promise((resolve,reject)=>{
 let bytes=0,chunks=[],failed=false;
 req.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX){if(!failed){failed=true;chunks=[];reject(new ServiceError('body-too-large',413));}return;}if(!failed)chunks.push(chunk);});
 req.on('end',()=>{if(failed)return;try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new ServiceError('invalid-json'));}});req.on('error',reject);
});}
export function createService({broker=new Broker(),publicOrigin=null,allowedOrigins=[],trustProxy=false,serveClient=false}={}){
 if(publicOrigin){const url=new URL(publicOrigin);if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Public origin must be an HTTPS origin');publicOrigin=url.origin;}
 const origins=new Set([...allowedOrigins,...(publicOrigin?[publicOrigin]:[])]),sockets=new Map();
 const checkRequest=req=>{
  const localOrigin=!publicOrigin&&/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(req.headers.host||'')&&req.headers.origin==='http://'+req.headers.host;
  if(req.headers.origin&&!origins.has(req.headers.origin)&&!localOrigin)throw new ServiceError('origin-not-allowed',403);
  if(publicOrigin&&(!trustProxy||req.headers['x-forwarded-proto']!=='https'||req.headers.host!==new URL(publicOrigin).host))throw new ServiceError('https-required',400);
 };
 const bearer=req=>{const m=/^Bearer ([A-Za-z0-9_-]{32})$/.exec(req.headers.authorization||'');if(!m)throw new ServiceError('unauthorized',401);return broker.authorize(m[1]);};
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.method==='GET'&&req.url==='/health'){json(res,200,{status:'ok',service:'devicebridge-signaling',storage:'ephemeral-development'});return;}
   checkRequest(req);broker.limit('http:'+req.socket.remoteAddress,120);
   if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
   if(req.method==='OPTIONS'){
    if(req.headers['access-control-request-method']&&!['POST','GET'].includes(req.headers['access-control-request-method']))throw new ServiceError('method-not-allowed',405);
    const headers=(req.headers['access-control-request-headers']||'').toLowerCase().split(',').map(h=>h.trim()).filter(Boolean);if(headers.some(h=>!['authorization','content-type'].includes(h)))throw new ServiceError('header-not-allowed',403);
    res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Cache-Control':'no-store'});res.end();return;
   }
   const path=req.url;if(!path||path.includes('?'))throw new ServiceError('not-found',404);
   if(req.method==='GET'){
    const assets=new Set(['/index.html','/style.css','/app.mjs','/pcm-worklet.mjs','/client/connection.mjs','/client/storage.mjs','/client/peer.mjs','/client/native-media.mjs','/shared/signatures.mjs','/core/protocol.mjs']),asset=path==='/'?'/index.html':path;
    if(serveClient&&assets.has(asset)){
     let bytes;try{bytes=await readFile(new URL('../bundle'+asset,import.meta.url));}catch{throw new ServiceError('client-not-built',503);}
     res.writeHead(200,{'Content-Type':asset.endsWith('.html')?'text/html; charset=utf-8':asset.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: wss: http://127.0.0.1:* ws://127.0.0.1:*; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(bytes);return;
    }
    const auth=bearer(req);
    if(path==='/v1/requests'){json(res,200,{requests:broker.requests(auth)});return;}
    if(path==='/v1/grants'){json(res,200,{grants:broker.grants(auth)});return;}
    throw new ServiceError('not-found',404);
   }
   if(req.method!=='POST')throw new ServiceError('method-not-allowed',405);
   if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw new ServiceError('json-required',415);
   // Authenticate before reading protected request bodies.
   const auth=['/v1/challenges','/v1/auth'].includes(path)?null:bearer(req),body=await readBody(req);
   let result;
   if(path==='/v1/challenges'){exact(body,['publicKey']);result=broker.challenge(body.publicKey);}
   else if(path==='/v1/auth'){exact(body,['challengeId','signature']);result=broker.authenticate(body.challengeId,body.signature);}
   else if(path==='/v1/socket-ticket'){exact(body,[]);result=broker.socketTicket(auth);}
   else if(path==='/v1/grants/restore'){exact(body,['record']);result=broker.restore(auth,body.record);}
   else if(path==='/v1/pairings'){exact(body,['permissions','reconnect']);result=broker.createPairing(auth,body);}
   else if(path==='/v1/requests'){exact(body,['code']);result=broker.requestPairing(auth,body.code);}
   else if(/^\/v1\/requests\/[A-Za-z0-9_-]{32}\/approve$/.test(path)){exact(body,['grant','signature']);result=broker.approve(auth,path.split('/')[3],body.grant,body.signature);}
   else if(/^\/v1\/requests\/[A-Za-z0-9_-]{32}\/reject$/.test(path)){exact(body,[]);result=broker.reject(auth,path.split('/')[3]);}
   else if(/^\/v1\/grants\/[A-Za-z0-9_-]{16,96}\/revoke$/.test(path)){exact(body,[]);result=broker.revoke(auth,path.split('/')[3]);}
   else if(/^\/v1\/grants\/[A-Za-z0-9_-]{16,96}\/leave$/.test(path)){exact(body,[]);result=broker.leave(auth,path.split('/')[3]);}
   else throw new ServiceError('not-found',404);
   json(res,200,result);
  }catch(error){if(!res.headersSent)json(res,error instanceof ServiceError?error.status:500,{error:error instanceof ServiceError?error.code:'internal-error'});else res.end();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=40;
 const wss=new WebSocketServer({noServer:true,maxPayload:MAX,perMessageDeflate:false,handleProtocols:p=>p.has('devicebridge.v1')?'devicebridge.v1':false});
 server.on('upgrade',(req,socket,head)=>{
  socket.on('error',()=>{});
  try{
   checkRequest(req);broker.limit('upgrade:'+req.socket.remoteAddress,60);if(req.url!=='/v1/ws')throw new ServiceError('not-found',404);
   const protocols=(req.headers['sec-websocket-protocol']||'').split(',').map(x=>x.trim());
   if(protocols.length!==2||!protocols.includes('devicebridge.v1'))throw new ServiceError('unauthorized',401);
   const ticket=protocols.find(x=>x.startsWith('ticket.'))?.slice(7),auth=broker.consumeTicket(ticket);
   if(sockets.size>=1000&&!sockets.has(auth.deviceId))throw new ServiceError('capacity-reached',503);
   wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,auth));
  }catch(error){socket.end(`HTTP/1.1 ${error instanceof ServiceError?error.status:500} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}
 });
 const send=(id,event)=>{const ws=sockets.get(id);if(!ws||ws.readyState!==WebSocket.OPEN)return;if(ws.bufferedAmount>256*1024){ws.terminate();return;}ws.send(JSON.stringify(event));};
 const notifyPresence=(id,online)=>{for(const peer of new Set(broker.peers({deviceId:id})))send(peer,{type:'presence',deviceId:id,online});};
 const deliver=(id,event)=>{send(id,event);if(['grant-approved','grant-restored'].includes(event.type)){const g=event.record.grant,other=id===g.hostId?g.controllerId:g.hostId;send(id,{type:'presence',deviceId:other,online:sockets.has(other)});}};
 broker.on('device',deliver);
 wss.on('connection',(ws,auth)=>{
  const prior=sockets.get(auth.deviceId);sockets.set(auth.deviceId,ws);prior?.close(4001,'replaced');ws.alive=true;ws.authExpiresAt=auth.expiresAt;
  ws.on('error',()=>{});ws.on('pong',()=>{ws.alive=true;});
  ws.on('message',(data,binary)=>{
   try{
    if(sockets.get(auth.deviceId)!==ws||Date.now()>=auth.expiresAt){ws.close(4003,'authentication-expired');return;}
    broker.limit('ws:'+auth.deviceId,720);if(binary)throw new ServiceError('json-required');const event=JSON.parse(data.toString());
    if(event.type==='heartbeat'){exact(event,['type']);send(auth.deviceId,{type:'heartbeat-ack'});}
    else if(event.type==='signal'){exact(event,['type','signed']);broker.forward(auth,event.signed);send(auth.deviceId,{type:'signal-accepted'});}
    else throw new ServiceError('unknown-event');
   }catch(error){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'error',error:error instanceof ServiceError?error.code:'invalid-message'}));}
  });
  ws.on('close',()=>{if(sockets.get(auth.deviceId)!==ws)return;sockets.delete(auth.deviceId);notifyPresence(auth.deviceId,false);});
  send(auth.deviceId,{type:'ready',deviceId:auth.deviceId});notifyPresence(auth.deviceId,true);
  for(const peer of new Set(broker.peers(auth)))send(auth.deviceId,{type:'presence',deviceId:peer,online:sockets.has(peer)});
 });
 const heartbeat=setInterval(()=>{for(const ws of sockets.values()){if(!ws.alive||Date.now()>=ws.authExpiresAt){ws.terminate();continue;}ws.alive=false;ws.ping();}},25000);heartbeat.unref();
 return {broker,server,async listen(port=0,host='127.0.0.1'){
  if(!['127.0.0.1','::1','localhost'].includes(host)&&!publicOrigin)throw Error('Public binding requires HTTPS origin and protected reverse proxy');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});return server.address();
 },async close(){clearInterval(heartbeat);broker.off('device',deliver);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const app=createService({publicOrigin:process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||null,trustProxy:process.env.TRUST_PROXY==='true',allowedOrigins:(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean),serveClient:true});
 const address=await app.listen(Number(process.env.PORT||48940),process.env.BIND_HOST||'127.0.0.1');console.log(`DeviceBridge development signaling listening on ${address.address}:${address.port}; state is ephemeral.`);
 const stop=()=>app.close().then(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
