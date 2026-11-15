import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { projectToGrid, type ElevationGrid } from "../lib/terrain";

const GRID = 7600; // source LOLA raster size, as in terrain.ts
const R_MOON_KM = 1737.4;
const HALF_KM = 60; // the block shown: 120 km x 120 km around the site
const SKY_KM = 900; // distance at which the Sun and Earth are drawn

type Props = {
  elevation: ElevationGrid;
  lat: number;
  lon: number;
  name: string;
  sunAz: number;
  sunElev: number;
  earthAz: number;
  earthElev: number;
  lit: boolean;
};

/** Local east/up/north (x, y, -z in three.js) for an azimuth and elevation in degrees. */
function dirFrom(az: number, elev: number) {
  const a = (az * Math.PI) / 180, e = (elev * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

function glowTexture(inner: string, outer: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.18, inner);
  grd.addColorStop(0.35, outer);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textSprite(text: string, color = "#d1d1d1") {
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 40px Inter, Helvetica, Arial, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,0.9)"; g.strokeText(text, 64, 32);
  g.fillStyle = color; g.fillText(text, 64, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // constant size on screen, so a letter near the camera does not fill the view
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.05, 0.025, 1);
  return s;
}

/**
 * A 120 km block of LOLA terrain around the site, bent to the Moon's curvature and lit
 * from the Sun's true direction at the selected moment. Terrain shadows are computed by
 * the GPU from this block only; the app's sunlit/shadow verdict uses the full 150 km horizon.
 */
export default function Terrain3D({ elevation, lat, lon, name, sunAz, sunElev, earthAz, earthElev, lit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    sun: THREE.DirectionalLight; sunSprite: THREE.Sprite; earth: THREE.Mesh; terrain: THREE.Mesh | null;
    marker: THREE.Group; render: () => void;
  } | null>(null);
  const [exag, setExag] = useState(1);
  const [view, setView] = useState<"overview" | "ground">("overview");
  const [failed, setFailed] = useState(false);

  // ---- scene, once
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#000000");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.005, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI / 2 - 0.01;
    controls.minDistance = 0.05;
    controls.maxDistance = 260;

    // no air: the only fill light is faint earthshine
    scene.add(new THREE.AmbientLight(0x9fb6d9, 0.06));
    const sun = new THREE.DirectionalLight(0xfff4e0, 6);
    sun.castShadow = true;
    // sharp shadows on desktops; lighter on phones and never past what the GPU allows
    const shadowPx = Math.min(renderer.capabilities.maxTextureSize, window.innerWidth < 820 ? 2048 : 4096);
    sun.shadow.mapSize.set(shadowPx, shadowPx);
    const sc = sun.shadow.camera;
    sc.left = -HALF_KM * 1.5; sc.right = HALF_KM * 1.5; sc.top = HALF_KM * 1.5; sc.bottom = -HALF_KM * 1.5;
    sc.near = 1; sc.far = 800;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.08;
    scene.add(sun, sun.target);

    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("#fffbe8", "rgba(255,190,80,0.55)"), transparent: true }));
    sunSprite.scale.set(70, 70, 1);
    scene.add(sunSprite);

    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(SKY_KM * Math.tan((0.95 * Math.PI) / 180) * 1.6, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x6fb6ee })
    );
    scene.add(earth);

    // stars
    const starPos: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      starPos.push(1800 * r * Math.cos(t), 1800 * u, 1800 * r * Math.sin(t));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7 })));

    // compass letters at the edge of the block
    for (const [t, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
      const s = textSprite(t, t === "N" ? "#ffcb47" : "#d1d1d1");
      const d = dirFrom(az, 0).multiplyScalar(HALF_KM * 0.92);
      s.position.set(d.x, 6, d.z);
      scene.add(s);
    }

    const marker = new THREE.Group();
    scene.add(marker);

    const render = () => renderer.render(scene, camera);
    controls.addEventListener("change", render);
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    });
    ro.observe(wrap);

    three.current = { renderer, scene, camera, controls, sun, sunSprite, earth, terrain: null, marker, render };
    return () => {
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // ---- terrain block for this site
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const { size, pixM, data } = elevation;
    const p = projectToGrid(lat, lon);
    const cx = (p.x / GRID) * size, cy = (p.y / GRID) * size;
    const sample = (x: number, y: number) => {
      const xc = Math.min(size - 1.001, Math.max(0, x)), yc = Math.min(size - 1.001, Math.max(0, y));
      const x0 = Math.floor(xc), y0 = Math.floor(yc), fx = xc - x0, fy = yc - y0;
      const a = data[y0 * size + x0], b = data[y0 * size + x0 + 1], c = data[(y0 + 1) * size + x0], d = data[(y0 + 1) * size + x0 + 1];
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
    const h0 = sample(cx, cy);
    const pixKm = pixM / 1000;
    const half = Math.round(HALF_KM / pixKm);
    const n = 2 * half + 1;
    const L = (lon * Math.PI) / 180, sl = Math.sin(L), cl = Math.cos(L);
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const dx = i - half, dy = j - half;
        // image offset -> local east/north (the inverse of the azimuth convention in terrain.ts)
        const east = (dx * cl + dy * sl) * pixKm;
        const north = (dx * sl - dy * cl) * pixKm;
        const d2 = east * east + north * north;
        // height above the site's tangent plane: terrain minus the drop of the curved Moon
        const h = ((sample(cx + dx, cy + dy) - h0) / 1000 - d2 / (2 * R_MOON_KM)) * exag;
        const k = (j * n + i) * 3;
        pos[k] = east; pos[k + 1] = h; pos[k + 2] = -north;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // keep triangles facing up whatever the handedness of the image grid
    const nrm = geo.getAttribute("normal") as THREE.BufferAttribute;
    let up = 0;
    for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
    if (up < 0) {
      for (let k = 0; k < idx.length; k += 3) { const tmp = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = tmp; }
      geo.setIndex(idx);
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xa9a9a6, roughness: 1, metalness: 0 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (t.terrain) { t.scene.remove(t.terrain); t.terrain.geometry.dispose(); (t.terrain.material as THREE.Material).dispose(); }
    t.terrain = mesh;
    t.scene.add(mesh);

    // site marker: a thin mast with a light on top
    t.marker.clear();
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    mast.position.y = 1.2;
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    top.position.y = 2.5;
    top.name = "lamp";
    t.marker.add(mast, top);
    t.render();
  }, [elevation, lat, lon, exag]);

  // ---- camera: overview from above, or standing at the site
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const s = dirFrom(sunAz, 0);
    if (view === "overview") {
      // stand on the Sun's side, a little off its line: sunlit slopes face us and the long
      // shadows stretch away (the "Stand at the site" view shows the Sun itself)
      const back = dirFrom(sunAz + 25, 0);
      t.camera.fov = 50;
      t.camera.position.set(back.x * 70, 34 * Math.max(1, exag * 0.7), back.z * 70);
      t.controls.target.set(0, 0, 0);
      t.camera.lookAt(0, 0, 0);
    } else {
      // eye 60 m up (x height scale), so the 600 m terrain cells around the site stay below it
      const eye = 0.06 * exag;
      t.camera.fov = 70;
      t.camera.position.set(0, eye, 0);
      t.controls.target.set(s.x * 0.5, eye, s.z * 0.5);
    }
    t.marker.visible = view === "overview";
    t.camera.updateProjectionMatrix();
    t.controls.update();
    t.render();
    // only when the view, site or exaggeration changes, not on every time step
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, lat, lon, exag]);

  // ---- Sun, Earth and the site lamp for this moment
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const s = dirFrom(sunAz, sunElev);
    t.sun.position.copy(s.clone().multiplyScalar(400));
    t.sun.target.position.set(0, 0, 0);
    t.sun.intensity = sunElev > -1 ? 6 : 0;
    t.sunSprite.position.copy(s.clone().multiplyScalar(SKY_KM));
    t.earth.position.copy(dirFrom(earthAz, earthElev).multiplyScalar(SKY_KM));
    const lamp = t.marker.getObjectByName("lamp") as THREE.Mesh | undefined;
    if (lamp) (lamp.material as THREE.MeshBasicMaterial).color.set(lit ? 0xffcb47 : 0x58585b);
    t.render();
  }, [sunAz, sunElev, earthAz, earthElev, lit]);

  if (failed) {
    return <div className="t3d-msg">3D needs WebGL, which this browser has turned off. The map and sky view show the same results.</div>;
  }
  return (
    <div className="t3d">
      <div className="t3d-canvas" ref={wrapRef} role="img"
           aria-label={`3D view of the LOLA terrain within 60 km of ${name}, lit by the Sun at ${sunElev.toFixed(1)} degrees`} />
      <div className="t3d-bar">
        <div className="segmented" role="group" aria-label="Camera">
          <button className={view === "overview" ? "seg seg-on" : "seg"} onClick={() => setView("overview")}>From above</button>
          <button className={view === "ground" ? "seg seg-on" : "seg"} onClick={() => setView("ground")}>Stand at the site</button>
        </div>
        <div className="segmented" role="group" aria-label="Height scale">
          <button className={exag === 1 ? "seg seg-on" : "seg"} onClick={() => setExag(1)}>True heights</button>
          <button className={exag === 3 ? "seg seg-on" : "seg"} onClick={() => setExag(3)}>Heights ×3</button>
        </div>
      </div>
      <div className="t3d-note">
        {name} at the centre (mast) · 120 × 120 km of LOLA terrain, curved like the Moon · Sun {sunElev >= 0 ? "+" : ""}{sunElev.toFixed(1)}°, Earth {earthElev >= 0 ? "+" : ""}{earthElev.toFixed(1)}° (blue; both drawn larger than life).
        Shadows here come from this block only; the sunlit verdict uses hills up to 150 km away. Drag to turn, scroll to zoom.
      </div>
    </div>
  );
}
