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
const site=meta.sites[0];
const pb={up:{x:Math.cos(site.lat*D)*Math.cos(site.lon*D),y:Math.cos(site.lat*D)*Math.sin(site.lon*D),z:Math.sin(site.lat*D)},
 east:{x:-Math.sin(site.lon*D),y:Math.cos(site.lon*D),z:0},
 north:{x:-Math.sin(site.lat*D)*Math.cos(site.lon*D),y:-Math.sin(site.lat*D)*Math.sin(site.lon*D),z:Math.cos(site.lat*D)}};
function hor(az){const i=Math.floor(((az%360)+360)%360);return site.horizonDeg[i];}
for(let i=0;i<10;i++){
  const date=new Date(Date.UTC(2027,0,1+i*6));
  const sun=A.GeoVector(A.Body.Sun,date,true),moon=A.GeoVector(A.Body.Moon,date,false);
  const f=frame(date);
  const s=toF(unit({x:sun.x-moon.x,y:sun.y-moon.y,z:sun.z-moon.z}),f);
  const e=toF(unit({x:-moon.x,y:-moon.y,z:-moon.z}),f);
  const se=Math.asin(dot(s,pb.up))/D, ee=Math.asin(dot(e,pb.up))/D;
  const sa=Math.atan2(dot(s,pb.east),dot(s,pb.north))/D, ea=Math.atan2(dot(e,pb.east),dot(e,pb.north))/D;
  const subE={lat:Math.asin(e.z)/D};
  console.log(date.toISOString().slice(0,10),"sunEl",se.toFixed(2),"h",hor(((sa%360)+360)%360).toFixed(2),"| earthEl",ee.toFixed(2),"h",hor(((ea%360)+360)%360).toFixed(2),"| subEarthLat",subE.lat.toFixed(2));
}
