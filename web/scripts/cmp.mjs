import * as A from "astronomy-engine";
import fs from "node:fs";
const D=Math.PI/180;
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit=(v)=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l}};
function frame(date){const d=(date.getTime()-Date.UTC(2000,0,1,12))/86400000;const T=d/36525;
 const a0=(269.9949+0.0031*T)*D,d0=(66.5392+0.013*T)*D,W=(38.3213+13.17635815*d-1.4e-12*d*d)*D;
 const z={x:Math.cos(d0)*Math.cos(a0),y:Math.cos(d0)*Math.sin(a0),z:Math.sin(d0)};
 const Q={x:-Math.sin(a0),y:Math.cos(a0),z:0};const P=cross(z,Q);
 const x=unit({x:Q.x*Math.cos(W)+P.x*Math.sin(W),y:Q.y*Math.cos(W)+P.y*Math.sin(W),z:Q.z*Math.cos(W)+P.z*Math.sin(W)});
 const y=cross(z,x);return{x,y,z};}
const toF=(v,f)=>({x:dot(v,f.x),y:dot(v,f.y),z:dot(v,f.z)});
const meta=JSON.parse(fs.readFileSync("web/public/terrain/sites.json"));
function evalSite(lat,lon,elev,prof,days=60){
 const up={x:Math.cos(lat*D)*Math.cos(lon*D),y:Math.cos(lat*D)*Math.sin(lon*D),z:Math.sin(lat*D)};
 const east={x:-Math.sin(lon*D),y:Math.cos(lon*D),z:0};
 const north={x:-Math.sin(lat*D)*Math.cos(lon*D),y:-Math.sin(lat*D)*Math.sin(lon*D),z:Math.cos(lat*D)};
 let lit=0,n=0,maxRun=0,run=0;
 for(let i=0;i<days*96;i++){
  const date=new Date(Date.UTC(2027,0,1)+i*15*60000);
  const sun=A.GeoVector(A.Body.Sun,date,true),moon=A.GeoVector(A.Body.Moon,date,false);
  const f=frame(date); const s=toF(unit({x:sun.x-moon.x,y:sun.y-moon.y,z:sun.z-moon.z}),f);
  const el=Math.asin(dot(s,up))/D;
  let az=Math.atan2(dot(s,east),dot(s,north))/D; az=((az%360)+360)%360;
  const j=Math.floor(az)%360,k=(j+1)%360,t=az-Math.floor(az);
  const h=prof[j]*(1-t)+prof[k]*t;
  n++; if(el>h){lit++;run=0}else{run++;if(run>maxRun)maxRun=run}
  if(el>h) run=0;
 }
 return {illum:(lit/n*100).toFixed(1), maxDarkH:(maxRun*0.25).toFixed(1)};
}
for(const s of meta.sites.slice(0,4)){
  console.log(s.name, "snapped", evalSite(s.lat,s.lon,s.elevationM,s.horizonDeg));
}
