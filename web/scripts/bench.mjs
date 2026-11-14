import * as A from "astronomy-engine";
const D=Math.PI/180;
const t0=performance.now();
const start=new Date("2027-01-01T00:00:00Z");
const n=30*48;
for(let i=0;i<n;i++){
  const d=new Date(start.getTime()+i*1800000);
  A.GeoVector(A.Body.Sun,d,true); A.GeoVector(A.Body.Moon,d,false); A.RotationAxis(A.Body.Moon,d);
}
console.log("1000+ evals ms", (performance.now()-t0).toFixed(0), "for", n);
