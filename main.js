/*
 * main.js — render + interaction only.
 * Every number shown here comes from src/core.mjs (the exact module the node
 * benches import); nothing is recomputed with a second implementation, and
 * nothing is hard-coded except the CDN importmap in index.html.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  makeRig, buildTube, skinMatrices, skin, poseAt, ringRadiusStats, meshVolume,
} from "./src/core.mjs";
import { buildScenarios } from "./src/scenarios.mjs";

const scns = buildScenarios();
const view = document.getElementById("view");
const sel = document.getElementById("scn");
const tSlider = document.getElementById("t");
const tval = document.getElementById("tval");
const liveTable = document.getElementById("live");
const cmpBox = document.getElementById("cmp");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(view.clientWidth, view.clientHeight);
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
const camera = new THREE.PerspectiveCamera(45, view.clientWidth / view.clientHeight, 0.01, 2000);
camera.position.set(2.2, 1.9, 3.4);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.0));
const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(3, 5, 4);
scene.add(dir);
const grid = new THREE.GridHelper(20, 20, 0x1f2630, 0x151a21);
grid.position.y = -2.2;
scene.add(grid);

let state = null;

function disposeState() {
  if (!state) return;
  for (const m of state.meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  state = null;
}

function build(index) {
  disposeState();
  const scn = scns[index];
  const rig = makeRig({ bones: scn.rig.bones, L: scn.rig.L });
  const mesh = buildTube(rig, { radius: scn.radius, perBone: scn.perBone, seg: scn.seg, blend: scn.blend });
  const meshes = [];
  const geoms = {};
  for (const [k, mode] of [[0, "lbs"], [1, "dqs"]]) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.verts.length * 3), 3));
    g.setIndex(mesh.tris.flat());
    const mat = new THREE.MeshStandardMaterial({
      color: mode === "lbs" ? 0x5a9bd5 : 0xd58f5a,
      metalness: 0.15, roughness: 0.45, side: THREE.DoubleSide,
      wireframe: false,
    });
    const m = new THREE.Mesh(g, mat);
    // the two rigs are laid out side by side, both centred on their own axis
    const axisMid = ((rig.bones - 1) * rig.L) / 2;
    m.position.set(mode === "lbs" ? -axisMid - 0.85 : axisMid + 0.85, 0, 0);
    scene.add(m);
    meshes.push(m);
    geoms[mode] = { g, mesh, rig, offset: m.position };
  }
  state = { scn, rig, mesh, meshes, geoms, restVolume: meshVolume(mesh.verts, mesh.tris) };
  const camZ = 3.0 + rig.bones * 1.1;
  camera.position.set(2.0, 1.7, camZ);
  orbit.target.set(0, 0, 0);
  tSlider.value = 1;
  update(1);
}

function update(t) {
  if (!state) return;
  const { scn, rig, mesh, restVolume, geoms } = state;
  const tr = skinMatrices(rig, poseAt(scn, t));
  const rows = [];
  let refSample = null;
  for (const mode of ["lbs", "dqs"]) {
    const def = skin(mode, tr, mesh.verts, mesh.weights);
    const pos = geoms[mode].g.getAttribute("position");
    for (let i = 0; i < def.length; i++) {
      pos.setXYZ(i, def[i][0], def[i][1], def[i][2]);
    }
    pos.needsUpdate = true;
    geoms[mode].g.computeVertexNormals();
    geoms[mode].g.computeBoundingSphere();
    const st = ringRadiusStats(def, mesh);
    const vol = Math.abs(meshVolume(def, mesh.tris) / restVolume);
    rows.push({ mode, shrink: st.maxShrink, vol });
    if (window.__ref && window.__ref.scenarios) {
      const R = window.__ref.scenarios.find((s) => s.id === scn.id);
      if (R) {
        const s = R.samples[Math.round(t * 16)];
        refSample = refSample || {};
        refSample[mode] = s;
      }
    }
  }
  liveTable.innerHTML =
    "<tr><th>metric (live, this page)</th><th>LBS</th><th>DQS</th></tr>" +
    `<tr><td>max radius shrink</td><td class="num">${rows[0].shrink.toExponential(6)}</td><td class="num">${rows[1].shrink.toExponential(6)}</td></tr>` +
    `<tr><td>volume ratio</td><td class="num">${rows[0].vol.toFixed(9)}</td><td class="num">${rows[1].vol.toFixed(9)}</td></tr>`;
  if (refSample) {
    const dl = Math.abs(rows[0].shrink - refSample.lbs.lbsShrink);
    const dd = Math.abs(rows[1].shrink - refSample.dqs.dqsShrink);
    const vl = Math.abs(rows[0].vol - refSample.lbs.lbsVol);
    const vd = Math.abs(rows[1].vol - refSample.dqs.dqsVol);
    const ok = Math.max(dl, dd, vl, vd) < 1e-9;
    cmpBox.innerHTML =
      `<div>vs <code>data/reference.json</code> (baked by node, t=${(Math.round(t * 16) / 16).toFixed(4)}): ` +
      `<span class="${ok ? "ok" : "bad"}">max |browser - node| = ${Math.max(dl, dd, vl, vd).toExponential(3)}</span></div>` +
      `<div>LBS shrink ${dl.toExponential(2)} | DQS shrink ${dd.toExponential(2)} | LBS vol ${vl.toExponential(2)} | DQS vol ${vd.toExponential(2)}</div>`;
  }
  tval.textContent = Number(t).toFixed(3);
}

for (let i = 0; i < scns.length; i++) {
  const o = document.createElement("option");
  o.value = String(i);
  o.textContent = `${scns[i].id} (${scns[i].rig.bones} bones, ${scns[i].pureTwist ? "pure twist" : "twist + bend"})`;
  sel.appendChild(o);
}
sel.value = "1";
sel.addEventListener("change", () => build(Number(sel.value)));
tSlider.addEventListener("input", () => update(Number(tSlider.value)));
addEventListener("resize", () => {
  camera.aspect = view.clientWidth / view.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(view.clientWidth, view.clientHeight);
});

fetch("./data/reference.json")
  .then((r) => r.json())
  .then((j) => {
    window.__ref = j;
    document.getElementById("limits").textContent =
      "Certificate from node: adaptive enclosure of the sweep worst case, " +
      "Lipschitz bound = " + (j.scenarios[1].sweep.lbsShrink.evals) + " evals; see README 已知限制 for the scale range and the absolute thresholds.";
    update(Number(tSlider.value));
  })
  .catch(() => {
    document.getElementById("limits").textContent =
      "data/reference.json not found — run `node tools/gen-sample.mjs` first (the 3D render still works).";
  });

build(1);
(function loop() { requestAnimationFrame(loop); orbit.update(); renderer.render(scene, camera); })();
