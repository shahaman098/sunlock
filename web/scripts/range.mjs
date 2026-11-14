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
 const y=cross(z,x);
 return {x,y,zz:z};}
const toF=(v,f)=>({x:dot(v,f.x),y:dot(v,f.y),z:dot(v,f.zz)});
const meta=JSON.parse(fs.readFileSync("web/public/terrain/sites.json"));
const s0=meta.sites[0];
const up={x:Math.cos(s0.lat*D)*Math.cos(s0.lon*D),y:Math.cos(s0.lat*D)*Math.sin(s0.lon*D),z:Math.sin(s0.lat*D)};
let min=99,max=-99;
for(let i=0;i<180*24;i++){
  const date=new Date(Date.UTC(2027,0,1)+i*3600000);
  const sun=A.GeoVector(A.Body.Sun,date,true),moon=A.GeoVector(A.Body.Moon,date,false);
  const f=frame(date); const s=toF(unit({x:sun.x-moon.x,y:sun.y-moon.y,z:sun.z-moon.z}),f);
  const el=Math.asin(dot(s,up))/D;
  if(el<min){min=el}
  if(el>max){max=el}
}
console.log("site",s0.name,"sun elevation range over 180d:",min.toFixed(2),"..",max.toFixed(2));
console.log("horizon min/max:", Math.min(...s0.horizonDeg).toFixed(2), Math.max(...s0.horizonDeg).toFixed(2));
