const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
// Coordinates are relative to the untransformed viewport, including letterboxing.
export function screenGeometry({width,height,videoWidth=16,videoHeight=9,scale=1,x=0,y=0}){
 const ratio=(videoWidth||16)/(videoHeight||9),w=Math.min(width,height*ratio),h=w/ratio;
 return {left:(width-w)/2*scale+x,top:(height-h)/2*scale+y,width:w*scale,height:h*scale};
}
export function createScreenGestures({measure,send=()=>{},render=()=>{},ready=()=>true,touchMode=()=>true,maxScale=4}={}){
 let view={scale:1,x:0,y:0},points=new Map(),single=null,multi=false,pinch=null,held=false,position={x:.5,y:.5};
 function constrain(){const b=measure(),g=screenGeometry({...b,scale:view.scale});
  const axis=(size,content,start,value)=>content>size?clamp(value,size-start-content,-start):(size-content)/2-start;
  view.x=axis(b.width,g.width,g.left,view.x);view.y=axis(b.height,g.height,g.top,view.y);render({...view});
 }
 function zoom(scale,anchor){const b=measure(),p=anchor||{x:b.width/2,y:b.height/2},next=clamp(scale,1,maxScale),ratio=next/view.scale;
  view={scale:next,x:p.x-(p.x-view.x)*ratio,y:p.y-(p.y-view.y)*ratio};constrain();
 }
 function point(p){const g=screenGeometry({...measure(),...view});if(!g.width||!g.height)return null;
  const x=(p.x-g.left)/g.width,y=(p.y-g.top)/g.height;return x<0||x>1||y<0||y>1?null:{x,y};
 }
 function move(p){position=p;send({type:'pointer',position:p});}
 function release(){if(held)send({type:'button',button:'primary',down:false});held=false;}
 function pair(){const [a,b]=[...points.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y))};}
 function down(id,p){if(!ready()||points.has(id))return;points.set(id,p);
  if(points.size>1){release();single=null;multi=true;pinch=points.size===2?{...pair(),view:{...view}}:null;return;}
  single={start:p,last:p,moved:false,valid:!!point(p)};
 }
 function drag(id,p){if(!points.has(id))return;points.set(id,p);if(!ready()){cancel();return;}
  if(multi){if(points.size!==2||!pinch)return;const current=pair(),scale=clamp(pinch.view.scale*current.distance/pinch.distance,1,maxScale),ratio=scale/pinch.view.scale;
   view={scale,x:current.x-(pinch.x-pinch.view.x)*ratio,y:current.y-(pinch.y-pinch.view.y)*ratio};constrain();return;}
  if(!single)return;const delta=Math.hypot(p.x-single.start.x,p.y-single.start.y);if(delta>6)single.moved=true;
  if(touchMode()){if(single.moved&&single.valid){if(!held){move(point(single.start));send({type:'button',button:'primary',down:true});held=true;}const target=point(p);if(target)move(target);}}
  else if(single.moved){const b=measure();move({x:clamp(position.x+(p.x-single.last.x)/Math.max(b.width*view.scale,1),0,1),y:clamp(position.y+(p.y-single.last.y)/Math.max(b.height*view.scale,1),0,1)});}
  single.last=p;
 }
 function up(id,p){if(!points.has(id))return;points.delete(id);
  if(multi){if(points.size===2)pinch={...pair(),view:{...view}};else pinch=null;if(!points.size)multi=false;return;}
  if(ready()&&single&&!single.moved&&Math.hypot(p.x-single.start.x,p.y-single.start.y)<=6){const target=touchMode()?point(p):position;
   if(target&&single.valid){move(target);send({type:'button',button:'primary',down:true});send({type:'button',button:'primary',down:false});}}
  release();single=null;
 }
 function cancel(){release();points.clear();single=null;multi=false;pinch=null;}
 function fit(){cancel();view={scale:1,x:0,y:0};constrain();}
 return {down,move:drag,up,cancel,fit,resize(){cancel();constrain();},zoomBy(factor){cancel();zoom(view.scale*factor);},get view(){return {...view};}};
}
export function mountScreenGestures({viewport,video,zoomIn,zoomOut,fit,label,send,ready,touchMode,win=window}={}){
 const measure=()=>({width:video.clientWidth,height:video.clientHeight,videoWidth:video.videoWidth,videoHeight:video.videoHeight});
 const gestures=createScreenGestures({measure,ready,touchMode,send,render:view=>{video.style.transform=`translate(${view.x}px, ${view.y}px) scale(${view.scale})`;label.textContent=Math.round(view.scale*100)+'%';zoomOut.disabled=view.scale<=1;zoomIn.disabled=view.scale>=4;}});
 const local=e=>{const r=viewport.getBoundingClientRect();return{x:e.clientX-r.left-video.offsetLeft,y:e.clientY-r.top-video.offsetTop};};
 viewport.onpointerdown=e=>{if(e.button!==0||!ready())return;e.preventDefault();viewport.setPointerCapture(e.pointerId);gestures.down(e.pointerId,local(e));};
 viewport.onpointermove=e=>gestures.move(e.pointerId,local(e));viewport.onpointerup=e=>gestures.up(e.pointerId,local(e));
 viewport.onpointercancel=()=>gestures.cancel();viewport.onlostpointercapture=()=>gestures.cancel();
 viewport.oncontextmenu=e=>e.preventDefault();zoomIn.onclick=()=>gestures.zoomBy(1.5);zoomOut.onclick=()=>gestures.zoomBy(1/1.5);fit.onclick=()=>gestures.fit();
 const observer=new win.ResizeObserver(()=>gestures.resize());observer.observe(viewport);video.addEventListener('resize',()=>gestures.resize());
 win.addEventListener('blur',()=>gestures.cancel());gestures.fit();return gestures;
}
