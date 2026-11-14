import * as A from "astronomy-engine";
const D=Math.PI/180;
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const unit=(v)=>{const l=Math.hypot(v.x,v.y,v.z)||1;return{x:v.x/l,y:v.y/l,z:v.z/l}};
function subEarthLon(date, nodeSign, spinSign){
  const ax=A.RotationAxis(A.Body.Moon,date);
  const z=unit(ax.north);
  let n=unit(cross({x:0,y:0,z:1},z));
  if(nodeSign<0) n={x:-n.x,y:-n.y,z:-n.z};
  const m=cross(z,n);
  const d=(date.getTime()-Date.UTC(2000,0,1,12))/86400000;
  const W=(38.3213+13.17635815*d)*D*spinSign;
  const x=unit({x:n.x*Math.cos(W)+m.x*Math.sin(W),y:n.y*Math.cos(W)+m.y*Math.sin(W),z:n.z*Math.cos(W)+m.z*Math.sin(W)});
  const y=cross(z,x);
  const moon=A.GeoVector(A.Body.Moon,date,false);
  const e=unit({x:-moon.x,y:-moon.y,z:-moon.z});
  let lon=Math.atan2(dot(e,y),dot(e,x))/D; if(lon<0)lon+=360;
  return lon;
}
const epochs=["2000-01-01T12:00:00Z","2027-01-01T00:00:00Z","2027-07-01T00:00:00Z"];
for(const ns of [1,-1]) for(const ss of [1,-1]){
  const vals=epochs.map(e=>subEarthLon(new Date(e),ns,ss).toFixed(1));
  console.log("node",ns,"spin",ss,vals.join("  "));
}
