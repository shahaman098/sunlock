import * as A from "astronomy-engine";
const D=Math.PI/180;
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit=(v)=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l}};
const eps=23.4392911*D;
const ecl={x:0,y:-Math.sin(eps),z:Math.cos(eps)};

function frameVariant(date, variant){
  const ax=A.RotationAxis(A.Body.Moon,date);
  const z=unit(ax.north);
  const n=unit(cross({x:0,y:0,z:1},z));
  const m=cross(z,n);
  const w=ax.spin*D;
  const cw=Math.cos(w), sw=Math.sin(w);
  let x,y;
  if(variant===0){ x=unit({x:n.x*cw+m.x*sw,y:n.y*cw+m.y*sw,z:n.z*cw+m.z*sw}); y=cross(z,x); }
  if(variant===1){ x=unit({x:n.x*cw-m.x*sw,y:n.y*cw-m.y*sw,z:n.z*cw-m.z*sw}); y=cross(z,x); }
  if(variant===2){ x=unit({x:m.x*cw-n.x*sw,y:m.y*cw-n.y*sw,z:m.z*cw-n.z*sw}); y=cross(z,x); }
  if(variant===3){ x=unit({x:m.x*cw+n.x*sw,y:m.y*cw+n.y*sw,z:m.z*cw+n.z*sw}); y=cross(z,x); }
  return {x,y,z};
}
const subLat=(date,f)=>{
  const sun=A.GeoVector(A.Body.Sun,date,true),moon=A.GeoVector(A.Body.Moon,date,false);
  const s=unit({x:sun.x-moon.x,y:sun.y-moon.y,z:sun.z-moon.z});
  return Math.asin(dot(s,f.z))/D;
};
const subE=(date,f)=>{
  const moon=A.GeoVector(A.Body.Moon,date,false);
  const e=unit({x:-moon.x,y:-moon.y,z:-moon.z});
  let lon=Math.atan2(dot(e,f.y),dot(e,f.x))/D; if(lon<0)lon+=360; return lon;
};
for(const v of [0,1,2,3]){
  let sum=0,n=0,lats=[];
  for(let k=0;k<24;k++){
    const d=new Date(Date.UTC(2027,0,1)+k*15*86400000);
    const f=frameVariant(d,v);
    sum+=subE(d,f); n++;
    lats.push(subLat(d,f));
  }
  console.log("variant",v,"mean subEarth lon",(sum/n).toFixed(1),"| subSolar lat range",Math.min(...lats).toFixed(2),Math.max(...lats).toFixed(2));
}
// pole-ecliptic angle for AE north
const ax=A.RotationAxis(A.Body.Moon,new Date(Date.UTC(2027,0,1)));
console.log("pole-ecliptic angle AE:",(Math.acos(dot(unit(ax.north),ecl))/D).toFixed(2));
