import * as A from "astronomy-engine";
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
const eps=23.4392911*D;
const ecl={x:0,y:-Math.sin(eps),z:Math.cos(eps)};
for(let m=0;m<12;m++){
  const date=new Date(Date.UTC(2027,m,15));
  const f=frame(date);
  const ang=Math.acos(dot(f.z,ecl))/D;
  const sun=A.GeoVector(A.Body.Sun,date,true),moon=A.GeoVector(A.Body.Moon,date,false);
  const s=unit({x:sun.x-moon.x,y:sun.y-moon.y,z:sun.z-moon.z});
  const subLat=Math.asin(dot(s,f.z))/D;
  const ax=A.RotationAxis(A.Body.Moon,date);
  const angAE=Math.acos(ax.north.x*ecl.x+ax.north.y*ecl.y+ax.north.z*ecl.z)/D;
  console.log(date.toISOString().slice(0,10),"pole-ecliptic angle",ang.toFixed(2),"(AE",angAE.toFixed(2)+")","subsolar lat",subLat.toFixed(2));
}
