import * as A from "astronomy-engine";
const D=Math.PI/180;
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit=(v)=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l}};

function frame(date, sign){
  const ax=A.RotationAxis(A.Body.Moon,date);
  const z=unit(ax.north);
  const n=unit(cross({x:0,y:0,z:1},z));
  const m=cross(z,n);
  const d=(date.getTime()-Date.UTC(2000,0,1,12))/86400000;
  const W=(38.3213+13.17635815*d-1.4e-12*d*d)*D;
  const cw=Math.cos(W), sw=Math.sin(W)*sign;
  const x=unit({x:n.x*cw+m.x*sw,y:n.y*cw+m.y*sw,z:n.z*cw+m.z*sw});
  return {x,y:cross(z,x),z};
}
for(const sign of [1,-1]){
  const lons=[],lats=[],slats=[];
  for(let k=0;k<48;k++){
    const date=new Date(Date.UTC(2027,0,1)+k*7.6*86400000);
    const f=frame(date,sign);
    const moon=A.GeoVector(A.Body.Moon,date,false);
    const e=unit({x:-moon.x,y:-moon.y,z:-moon.z});
    let lon=Math.atan2(dot(e,f.y),dot(e,f.x))/D; if(lon<0)lon+=360;
    lons.push(lon); lats.push(Math.asin(dot(e,f.z))/D);
    const sun=A.GeoVector(A.Body.Sun,date,true);
    const s=unit({x:sun.x-moon.x,y:sun.y-moon.y,z:sun.z-moon.z});
    slats.push(Math.asin(dot(s,f.z))/D);
  }
  const mean=lons.reduce((a,b)=>a+b,0)/lons.length;
  const dev=lons.map(l=>{let d=l-mean; if(d>180)d-=360; if(d<-180)d+=360; return d;});
  console.log("sign",sign,"mean subEarth lon",mean.toFixed(1),
    "lon dev",Math.min(...dev).toFixed(1),Math.max(...dev).toFixed(1),
    "| subEarth lat",Math.min(...lats).toFixed(1),Math.max(...lats).toFixed(1),
    "| subSolar lat",Math.min(...slats).toFixed(2),Math.max(...slats).toFixed(2));
}
