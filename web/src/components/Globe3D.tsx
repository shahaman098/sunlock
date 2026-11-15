import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js";
import type { Sky, Vec } from "../lib/selene";
import { projectToUnit, type ShadowField, type ShadowView } from "../lib/terrain";

export type GlobeSite = { id: string; name: string; lat: number; lon: number; lit: boolean; kind: "nasa" | "mission" | "custom" };

type Props = {
  sites: GlobeSite[];
  selectedId: string | null;
  sky: Sky;
  dateLabel: string;
  /** south-polar relief image and the live sunlit mask on the same polar grid (80-90 S) */
  hillshade: HTMLImageElement | null;
  field: ShadowField | null;
  shadow: ShadowView | null;
  onSelect: (id: string) => void;
};

/** Lunar body-fixed (x toward the mean Earth, z north) -> three.js (y up). A proper rotation. */
const toThree = (v: Vec) => new THREE.Vector3(v.x, v.z, -v.y);
const D = Math.PI / 180;
const onSphere = (lat: number, lon: number, r = 1) =>
  toThree({ x: Math.cos(lat * D) * Math.cos(lon * D), y: Math.cos(lat * D) * Math.sin(lon * D), z: Math.sin(lat * D) }).multiplyScalar(r);

const EARTH_DIST = 4.6; // Moon radii in the scene (really ~221): drawn close so both fit on screen
const SUN_DIST = 60;
const LIT = 0xffd166, DARK = 0x6ea8ff;

function glow(inner: string, outer: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(0.2, inner); grd.addColorStop(0.4, outer); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function label(text: string, color = "#e8e8e8") {
  const c = document.createElement("canvas");
  const g0 = c.getContext("2d")!;
  g0.font = "600 34px Inter, Helvetica, Arial, sans-serif";
  const w = Math.ceil(g0.measureText(text).width) + 24;
  c.width = w; c.height = 56;
  const g = c.getContext("2d")!;
  g.font = "600 34px Inter, Helvetica, Arial, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = 7; g.strokeStyle = "rgba(0,0,0,0.92)"; g.strokeText(text, w / 2, 28);
  g.fillStyle = color; g.fillText(text, w / 2, 28);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set((0.021 * w) / 56, 0.021, 1);
  s.center.set(0.5, -0.6); // sits just above its anchor
  s.renderOrder = 10;
  return s;
}

/**
 * The whole Moon in 3D: drag to turn it, scroll or pinch to zoom, click a landing site to fly
 * to it. Lit by the Sun from its true direction at the chosen moment, with Earth in its true
 * direction (drawn close and enlarged). The surface is NASA's LROC colour mosaic; south of
 * 80 deg S it is overlaid with the LOLA relief the rest of the app is computed from.
 */
export default function Globe3D({ sites, selectedId, sky, dateLabel, hillshade, field, shadow, onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const three = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: TrackballControls;
    sun: THREE.DirectionalLight; sunSprite: THREE.Sprite; sunLabel: THREE.Sprite; sunLine: THREE.Line;
    earth: THREE.Mesh; earthLabel: THREE.Sprite; earthLine: THREE.Line;
    markers: THREE.Group; capTex: THREE.CanvasTexture; flyTo: (dir: THREE.Vector3, dist: number, northUp?: boolean) => void;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sitesRef = useRef(sites);
  sitesRef.current = sites;

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
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 400);
    camera.position.copy(onSphere(-62, 25, 3.4));
    camera.up.copy(onSphere(0, 0));

    const controls = new TrackballControls(camera, renderer.domElement);
    controls.noPan = true;
    controls.rotateSpeed = 2.2;
    controls.zoomSpeed = 0.9;
    controls.dynamicDampingFactor = 0.12;
    controls.minDistance = 1.06;
    controls.maxDistance = 9;

    // stars
    {
      const n = 1400, pos = new Float32Array(n * 3);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < n; i++) {
        const z = 2 * rnd() - 1, a = 2 * Math.PI * rnd(), r = Math.sqrt(1 - z * z);
        pos.set([200 * r * Math.cos(a), 200 * z, 200 * r * Math.sin(a)], i * 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
    }

    // the Moon
    const moonTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}moon.jpg`);
    moonTex.colorSpace = THREE.SRGBColorSpace;
    moonTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const moon = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 80), new THREE.MeshStandardMaterial({ map: moonTex, roughness: 1, metalness: 0 }));
    moon.name = "moon";
    scene.add(moon);

    const capCanvas = document.createElement("canvas");
    capCanvas.width = capCanvas.height = 1024;
    const capTex = new THREE.CanvasTexture(capCanvas);
    capTex.colorSpace = THREE.SRGBColorSpace;
    capTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    // south-polar cap, 80-90 S: the LOLA relief the app's results come from, fading in from 80 S
    {
      const rings = 40, segs = 180, pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
      for (let i = 0; i <= rings; i++) {
        const lat = -90 + (10 * i) / rings;
        for (let j = 0; j <= segs; j++) {
          const lon = (360 * j) / segs;
          const p = onSphere(lat, lon, 1.0008);
          pos.push(p.x, p.y, p.z);
          const u = projectToUnit(lat, lon);
          uv.push((u.x + 1) / 2, 1 - (u.y + 1) / 2);
          const a = Math.min(1, (rings - i) / 6); // opaque from 81.5 S poleward
          col.push(1, 1, 1, a);
        }
      }
      for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j, b = a + segs + 1;
        idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      g.setIndex(idx);
      // unlit: the texture already carries the relief and, painted over it, the real shadows of the moment
      const cap = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: capTex, vertexColors: true, transparent: true, side: THREE.DoubleSide }));
      cap.name = "cap";
      scene.add(cap);
    }

    // graticule every 30 deg, very faint
    {
      const pts: THREE.Vector3[] = [];
      for (let lat = -60; lat <= 60; lat += 30) for (let lon = 0; lon < 360; lon += 3) pts.push(onSphere(lat, lon, 1.002), onSphere(lat, lon + 3, 1.002));
      for (let lon = 0; lon < 360; lon += 30) for (let lat = -90; lat < 90; lat += 3) pts.push(onSphere(lat, lon, 1.002), onSphere(lat + 3, lon, 1.002));
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.07 })));
    }

    // Sun, Earth
    scene.add(new THREE.AmbientLight(0xffffff, 0.035));
    const sun = new THREE.DirectionalLight(0xfff4e0, 3.4);
    scene.add(sun, sun.target);
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow("rgba(255,244,214,1)", "rgba(255,190,90,0.35)"), transparent: true, depthWrite: false }));
    sunSprite.scale.setScalar(9);
    const sunLabel = label("Sun", "#ffe2a8");
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 16), new THREE.MeshStandardMaterial({ color: 0x2f6fd6, emissive: 0x0b2a66, emissiveIntensity: 0.6, roughness: 0.9 }));
    const earthLabel = label("Earth", "#9cc4ff");
    const mkLine = (color: number) => new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 }));
    const sunLine = mkLine(0xffd166), earthLine = mkLine(0x6ea8ff);
    scene.add(sunSprite, sunLabel, earth, earthLabel, sunLine, earthLine);

    const markers = new THREE.Group();
    scene.add(markers);

    // ---- camera flights
    let flight: { from: THREE.Vector3; to: THREE.Vector3; d0: number; d1: number; t0: number; up: THREE.Vector3 | null } | null = null;
    const flyTo = (dir: THREE.Vector3, dist: number, northUp = false) => {
      flight = { from: camera.position.clone().normalize(), to: dir.clone().normalize(), d0: camera.position.length(), d1: dist, t0: performance.now(), up: northUp ? new THREE.Vector3(0, 1, 0) : null };
    };

    // ---- picking
    const ray = new THREE.Raycaster();
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
      // a marker counts only if the Moon is not in front of it
      const hits = ray.intersectObjects([moon, ...markers.children.map((m) => m.children[0])], false);
      const h = hits[0];
      return h && h.object !== moon ? (h.object.parent!.userData.id as string) : null;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; flight = null; };
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const id = pick(e);
        if (id) onSelectRef.current(id);
      }
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      if (down) { setHover(null); return; }
      const id = pick(e);
      const s = id ? sitesRef.current.find((x) => x.id === id) : null;
      renderer.domElement.style.cursor = s ? "pointer" : "";
      const r = wrap.getBoundingClientRect();
      setHover(s ? { x: e.clientX - r.left, y: e.clientY - r.top, text: `${s.name} · ${s.lit ? "in sunlight" : "in shadow"} now` } : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("pointermove", onMove);

    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      controls.handleResize();
    });
    ro.observe(wrap);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (flight) {
        const k = Math.min(1, (performance.now() - flight.t0) / 1100), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        const q = new THREE.Quaternion().setFromUnitVectors(flight.from, flight.to);
        const dir = flight.from.clone().applyQuaternion(new THREE.Quaternion().slerp(q, e));
        camera.position.copy(dir.multiplyScalar(flight.d0 + (flight.d1 - flight.d0) * e));
        if (flight.up) camera.up.lerp(flight.up, e).normalize();
        if (Math.abs(camera.up.dot(camera.position.clone().normalize())) > 0.97) camera.up.copy(onSphere(0, 0));
        camera.lookAt(0, 0, 0);
        if (k >= 1) flight = null;
      } else controls.update();
      // markers keep a readable size as the camera closes in
      const s = THREE.MathUtils.clamp((camera.position.length() - 1) * 0.55, 0.05, 1.2);
      markers.children.forEach((m) => m.scale.setScalar(s * (m.userData.selected ? 1.5 : 1)));
      renderer.render(scene, camera);
    };
    tick();

    three.current = { renderer, scene, camera, controls, sun, sunSprite, sunLabel, sunLine, earth, earthLabel, earthLine, markers, capTex, flyTo };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => { (x as THREE.MeshStandardMaterial).map?.dispose?.(); x.dispose(); });
      });
      renderer.dispose();
      renderer.domElement.remove();
      three.current = null;
    };
  }, []);

  // ---- Sun and Earth for this moment
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    const s = toThree(sky.sun), e = toThree(sky.earth);
    t.sun.position.copy(s.clone().multiplyScalar(50));
    t.sunSprite.position.copy(s.clone().multiplyScalar(SUN_DIST));
    t.sunLabel.position.copy(s.clone().multiplyScalar(SUN_DIST));
    t.earth.position.copy(e.clone().multiplyScalar(EARTH_DIST));
    t.earthLabel.position.copy(e.clone().multiplyScalar(EARTH_DIST));
    t.sunLine.geometry.setFromPoints([s.clone().multiplyScalar(1.02), s.clone().multiplyScalar(SUN_DIST)]);
    t.earthLine.geometry.setFromPoints([e.clone().multiplyScalar(1.02), e.clone().multiplyScalar(EARTH_DIST - 0.24)]);
  }, [sky]);

  // ---- south-polar cap: LOLA relief with the terrain shadows of this moment painted on
  useEffect(() => {
    const t = three.current;
    if (!t || !hillshade) return;
    const c = t.capTex.image as HTMLCanvasElement, g = c.getContext("2d")!;
    g.drawImage(hillshade, 0, 0, c.width, c.height);
    if (field && shadow) {
      const n = field.size, o = document.createElement("canvas");
      o.width = o.height = n;
      const og = o.getContext("2d")!, img = og.createImageData(n, n);
      for (let i = 0; i < n * n; i++) if (field.mask[i] && !shadow.lit[i]) img.data[i * 4 + 3] = 185;
      og.putImageData(img, 0, 0);
      g.drawImage(o, 0, 0, c.width, c.height);
    }
    t.capTex.needsUpdate = true;
  }, [hillshade, field, shadow]);

  // ---- landing sites
  const siteKey = sites.map((s) => `${s.id}:${s.lat}:${s.lon}:${s.lit ? 1 : 0}`).join("|");
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    t.markers.children.slice().forEach((m) => {
      t.markers.remove(m);
      m.traverse((o) => {
        const x = o as THREE.Mesh;
        x.geometry?.dispose?.();
        const mat = x.material as THREE.SpriteMaterial | undefined;
        mat?.map?.dispose?.();
        mat?.dispose?.();
      });
    });
    for (const s of sites) {
      const sel = s.id === selectedId;
      const g = new THREE.Group();
      g.position.copy(onSphere(s.lat, s.lon, 1.004));
      g.userData = { id: s.id, selected: sel };
      const r = s.kind === "mission" ? 0.011 : 0.015;
      const dot = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8), new THREE.MeshBasicMaterial({ color: s.lit ? LIT : DARK }));
      g.add(dot);
      if (sel) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.9, r * 2.5, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true }));
        ring.lookAt(g.position.clone().multiplyScalar(2)); // flat on the surface
        ring.renderOrder = 9;
        g.add(ring);
        g.add(label(s.name, "#ffffff"));
      }
      t.markers.add(g);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, selectedId]);

  // ---- fly to the selected site when the selection changes
  const sel = sites.find((s) => s.id === selectedId);
  useEffect(() => {
    const t = three.current;
    if (!t || !sel) return;
    t.flyTo(onSphere(sel.lat, sel.lon), Math.min(t.camera.position.length(), 2.5));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, sel?.lat, sel?.lon]);

  if (failed) {
    return <div className="t3d-msg">The 3D Moon needs WebGL, which this browser has turned off. The map shows the same sites and results.</div>;
  }
  const fmt = (p: { lat: number; lon: number }) => `${Math.abs(p.lat).toFixed(1)}°${p.lat < 0 ? "S" : "N"} ${(((p.lon % 360) + 360) % 360).toFixed(0)}°E`;
  const go = (lat: number, lon: number, dist: number, northUp = false) => three.current?.flyTo(onSphere(lat, lon), dist, northUp);
  return (
    <div className="t3d globe">
      <div className="globe-view">
        <div className="t3d-canvas" ref={wrapRef} role="img"
             aria-label={`3D view of the Moon on ${dateLabel}, lit by the Sun from its true direction, with ${sites.length} landing sites marked`} />
        {hover && <div className="globe-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.text}</div>}
        <div className="globe-hud">
          <span className="globe-k">The Moon · {dateLabel}</span>
          <span>Sun overhead at <b>{fmt(sky.subSun)}</b></span>
          <span>Earth overhead at <b>{fmt(sky.subEarth)}</b></span>
        </div>
      </div>
      <div className="t3d-bar globe-bar">
        <div className="segmented" role="group" aria-label="Fly the camera to">
          <button className="seg" onClick={() => go(-90, 0, 1.75)}>South pole</button>
          <button className="seg" onClick={() => go(sky.subEarth.lat, sky.subEarth.lon, 3.4, true)}>From Earth</button>
          <button className="seg" onClick={() => go(0, sky.subSun.lon + 80, 3.4, true)}>Day–night line</button>
          {sel && <button className="seg" onClick={() => go(sel.lat, sel.lon, 1.35)}>{sel.name.length > 22 ? "Selected site" : sel.name}</button>}
        </div>
      </div>
      <p className="t3d-note">
        Drag to turn the Moon, scroll or pinch to zoom, click a site to fly to it. Yellow sites are in sunlight right now, blue ones in shadow.
        Sunlight and Earth come from their true directions; Earth and the Sun are drawn far closer and larger than they are.
        Surface: NASA LROC colour mosaic (CGI Moon Kit); south of 80°S, LOLA relief with the terrain shadows computed for this moment.
      </p>
    </div>
  );
}
