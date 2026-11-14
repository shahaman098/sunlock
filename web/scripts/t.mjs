import * as A from "astronomy-engine";
const D=Math.PI/180;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
function frameIAU(date){
  const d=(date.getTime()-Date.UTC(2000,0,1,12))/86400000;
  const T=d/36525;
  const a0=(269.9949+0.0031*T)*D, d0=(66.5392+0.0130*T)*D;
  const W=(38.3213+13.17635815*d-1.4e-12*d*d)*D;
  const z={x:Math.cos(d0)*Math.cos(a0),y:Math.cos(d0)*Math.sin(a0),z:Math.sin(d0)};
  const Q={x:-Math.sin(a0),y:Math.cos(a0),z:0};
  const P=cross(z,Q);
  const x={x:Q.x*Math.cos(W)+P.x*Math.sin(W),y:Q.y*Math.cos(W)+P.y*Math.sin(W),z:Q.z*Math.cos(W)+P.z*Math.sin(W)};
  const y=cross(z,x);
  return {x,y,z};
}
const toBody=(v,f)=>{const l=Math.hypot(v.x,v.y,v.z);const u={x:v.x/l,y:v.y/l,z:v.z/l};
  const bz=dot(u,f.z), lat=Math.asin(bz)/D; let lon=Math.atan2(dot(u,f.y),dot(u,f.x))/D; if(lon<0)lon+=360;
  return {lat,lon};};
for(let k=0;k<6;k++){
  const date=new Date(Date.UTC(2027,0,1+k*5));
  const moon=A.GeoVector(A.Body.Moon,date,false);
  const e=toBody({x:-moon.x,y:-moon.y,z:-moon.z},frameIAU(date));
  console.log(date.toISOString().slice(0,10),"sub-Earth",e.lon.toFixed(1),e.lat.toFixed(1));
}
