/*
 * skinbound-lab — core math.
 *
 * Pure ES module: no three.js, no DOM (window/document/navigator), no IO,
 * no environment access, no top-level side effects. Runs in node and in the
 * browser from the exact same file.
 *
 * Model
 * -----
 * A "rig" is a chain of `bones` bones laid out along +X, each of length L.
 * bone i spans [i*L, (i+1)*L]; interior joints sit at x = k*L.
 *
 * A "pose" gives, per bone, a local rotation about its own joint:
 *     localRot(i) = Rx(twist_i) * Rz(bend_i),   localRot(0) = identity
 * so bone 0 is the fixed root and children inherit the ancestors' frames.
 *
 * The skinned mesh is a closed tube (rings x segments + two caps) whose
 * per-vertex weights depend only on x. Two skinning modes are implemented:
 *   LBS — linear blend skinning (matrix blend, the classic candy-wrapper bug)
 *   DQS — dual quaternion skinning (blend of rigid transforms, kept rigid)
 *
 * All tolerances below are RELATIVE and dimensionless, so every conclusion
 * is invariant under uniform scaling of the rig (validated 1e-6 .. 1e6).
 */

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/* ------------------------------------------------------------------ *
 * vectors
 * ------------------------------------------------------------------ */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const vnorm = (a) => {
  const l = vlen(a);
  return l > 0 ? mul(a, 1 / l) : [0, 0, 0];
};
const vmean = (pts) => {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const n = pts.length || 1;
  return [x / n, y / n, z / n];
};
export const vec = { add, sub, mul, dot, cross, len: vlen, norm: vnorm, mean: vmean };

const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
const smoothstep = (u) => { const c = clamp01(u); return c * c * (3 - 2 * c); };

/* ------------------------------------------------------------------ *
 * quaternions  [x, y, z, w]
 * ------------------------------------------------------------------ */
export const qid = () => [0, 0, 0, 1];
export function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + bw * ax + (ay * bz - az * by),
    aw * by + bw * ay + (az * bx - ax * bz),
    aw * bz + bw * az + (ax * by - ay * bx),
    aw * bw - (ax * bx + ay * by + az * bz),
  ];
}
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 0 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : qid();
}
export function qaxis(axis, ang) {
  const u = vnorm(axis), h = ang / 2, s = Math.sin(h);
  return [u[0] * s, u[1] * s, u[2] * s, Math.cos(h)];
}
export function qrot(q, v) {
  const u = [q[0], q[1], q[2]];
  const t = mul(cross(u, v), 2);
  return add(add(v, mul(t, q[3])), cross(u, t));
}

/* ------------------------------------------------------------------ *
 * rigid transforms  {q, t}  meaning  p -> q*p + t
 * ------------------------------------------------------------------ */
export const rid = () => ({ q: qid(), t: [0, 0, 0] });
export const rapply = (tr, p) => add(qrot(tr.q, p), tr.t);
export const rinv = (tr) => {
  const c = qconj(tr.q);
  return { q: c, t: mul(qrot(c, tr.t), -1) };
};
/** a ∘ b  (apply b first, then a) */
export const rmul = (a, b) => ({ q: qmul(a.q, b.q), t: add(qrot(a.q, b.t), a.t) });

/* ------------------------------------------------------------------ *
 * dual quaternions  [rx, ry, rz, rw, dx, dy, dz, dw]
 * ------------------------------------------------------------------ */
export function rigidToDQ(tr) {
  const q = tr.q;
  const d = qmul([tr.t[0], tr.t[1], tr.t[2], 0], q);
  return [q[0], q[1], q[2], q[3], d[0] * 0.5, d[1] * 0.5, d[2] * 0.5, d[3] * 0.5];
}
export const dqReal = (d) => d.slice(0, 4);
export const dqDual = (d) => d.slice(4);
export function dqDot(a, b) {
  let s = 0;
  for (let k = 0; k < 8; k++) s += a[k] * b[k];
  return s;
}
export function dqNormalize(d) {
  const l = Math.hypot(d[0], d[1], d[2], d[3]);
  if (!(l > 0)) return [0, 0, 0, 1, 0, 0, 0, 0];
  return d.map((v) => v / l);
}
export function dqToRigid(d) {
  const n = dqNormalize(d);
  const r = dqReal(n);
  const t = qmul(dqDual(n), qconj(r));
  return { q: r, t: [t[0] * 2, t[1] * 2, t[2] * 2] };
}

/* ------------------------------------------------------------------ *
 * rigs
 * ------------------------------------------------------------------ */
/** rig = { bones, L, joints: [0, L, 2L, ...] } */
export function makeRig({ bones, L }) {
  if (!Number.isInteger(bones) || bones < 2) throw new Error("bones must be an integer >= 2");
  if (!(L > 0)) throw new Error("L must be > 0");
  const joints = [];
  for (let i = 0; i < bones; i++) joints.push(i * L);
  return { bones, L, joints };
}

/** rest (bind) world transform of bone i is a pure translation to joint i. */
export const restTransform = (rig, i) => ({ q: qid(), t: [rig.joints[i], 0, 0] });

/**
 * Skinning matrices M_i = W_i ∘ W_i_rest^-1 for a pose.
 * pose = { twist: [deg per bone], bend: [deg per bone] }
 */
export function skinMatrices(rig, pose) {
  const n = rig.bones;
  const out = [];
  let q = qid(), p = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      p = add(p, qrot(q, [rig.L, 0, 0]));
      const tw = (pose.twist?.[i] ?? 0) * DEG;
      const bd = (pose.bend?.[i] ?? 0) * DEG;
      q = qmul(q, qmul(qaxis([1, 0, 0], tw), qaxis([0, 0, 1], bd)));
    }
    const world = { q, t: p };
    const rest = restTransform(rig, i);
    out.push(rmul(world, rinv(rest)));
  }
  return out;
}

/** per-vertex weights, dependent on x only (partition of unity) */
export function ringWeights(x, rig, blend) {
  const n = rig.bones;
  const b = blend * rig.L;
  const s = [];
  for (let i = 0; i < n - 1; i++) {
    s.push(smoothstep((x - (rig.joints[i + 1] - b)) / (2 * b)));
  }
  const w = [];
  for (let i = 0; i < n; i++) {
    let wi;
    if (i === 0) wi = 1 - s[0];
    else if (i === n - 1) wi = s[n - 2];
    else wi = s[i - 1] - s[i];
    if (wi > 0) w.push([i, wi]);
  }
  const tot = w.reduce((a, e) => a + e[1], 0);
  return w.map(([i, wi]) => [i, wi / tot]);
}

/* ------------------------------------------------------------------ *
 * skinned tube mesh
 * ------------------------------------------------------------------ */
/**
 * Closed tube: `perBone` rings per bone segment (endpoints shared), `seg`
 * segments around the axis, plus two cap fans. Deterministic.
 */
export function buildTube(rig, { radius, perBone = 7, seg = 24, blend = 0.25 } = {}) {
  const n = rig.bones;
  const xs = [];
  for (let i = 0; i < n; i++) {
    const x0 = rig.joints[i], x1 = rig.joints[i] + rig.L;
    for (let k = 0; k < perBone; k++) {
      const x = x0 + ((x1 - x0) * k) / (perBone - 1);
      if (xs.length === 0 || Math.abs(x - xs[xs.length - 1]) > 1e-12 * rig.L) xs.push(x);
    }
  }
  const verts = [], tris = [], ringIdx = [], weights = [];
  for (const x of xs) {
    const w = ringWeights(x, rig, blend);
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const a = (2 * Math.PI * j) / seg;
      ring.push(verts.length);
      verts.push([x, radius * Math.cos(a), radius * Math.sin(a)]);
      weights.push(w);
    }
    ringIdx.push(ring);
  }
  const ringCentroid = ringIdx.map((idx) => vmean(idx.map((i) => verts[i])));
  // side quads -> triangles (orientation: outward)
  for (let r = 0; r + 1 < ringIdx.length; r++) {
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = ringIdx[r][j], b = ringIdx[r][j2];
      const c = ringIdx[r + 1][j2], d = ringIdx[r + 1][j];
      tris.push([a, b, c], [a, c, d]);
    }
  }
  // caps: fan around a centre vertex
  const capOf = (ringI, x, flip) => {
    const c = verts.length;
    verts.push([x, 0, 0]);
    weights.push(weights[ringIdx[ringI][0]]);
    const ring = ringIdx[ringI];
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      if (flip) tris.push([c, ring[j2], ring[j]]);
      else tris.push([c, ring[j], ring[j2]]);
    }
  };
  capOf(0, xs[0], true);
  capOf(ringIdx.length - 1, xs[xs.length - 1], false);
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
  return {
    verts, tris, ringIdx, ringCentroid, weights,
    radius, seg, perBone, blend,
    bboxDiag: vlen(sub(mx, mn)),
  };
}

/* ------------------------------------------------------------------ *
 * skinning
 * ------------------------------------------------------------------ */
export function skinLBS(transforms, verts, weights) {
  const out = new Array(verts.length);
  for (let vi = 0; vi < verts.length; vi++) {
    const p = verts[vi], w = weights[vi];
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < w.length; k++) {
      const ww = w[k][1];
      if (ww === 0) continue;
      const tr = transforms[w[k][0]];
      const r = qrot(tr.q, p);
      x += ww * (r[0] + tr.t[0]);
      y += ww * (r[1] + tr.t[1]);
      z += ww * (r[2] + tr.t[2]);
    }
    out[vi] = [x, y, z];
  }
  return out;
}

export function skinDQS(transforms, verts, weights) {
  const dqs = transforms.map(rigidToDQ);
  const out = new Array(verts.length);
  for (let vi = 0; vi < verts.length; vi++) {
    const w = weights[vi];
    // per-vertex antipodality pivot = highest-weight bone
    let pi = w[0][0], pw = -1;
    for (let k = 0; k < w.length; k++) if (w[k][1] > pw) { pw = w[k][1]; pi = w[k][0]; }
    const pivot = dqs[pi];
    const acc = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < w.length; k++) {
      const ww = w[k][1];
      if (ww === 0) continue;
      const s = dqDot(dqs[w[k][0]], pivot) < 0 ? -ww : ww;
      for (let m = 0; m < 8; m++) acc[m] += s * dqs[w[k][0]][m];
    }
    out[vi] = rapply(dqToRigid(acc), verts[vi]);
  }
  return out;
}

export const skin = (mode, transforms, verts, weights) =>
  mode === "dqs" ? skinDQS(transforms, verts, weights) : skinLBS(transforms, verts, weights);

/** signed volume of a closed triangle mesh (divergence theorem) */
export function meshVolume(verts, tris) {
  let s = 0;
  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    s += dot(cross(verts[t[0]], verts[t[1]]), verts[t[2]]);
  }
  return s / 6;
}

/**
 * Radius statistics: for every ring, compare each vertex's distance to the
 * (skinned) ring centroid against its rest distance. Dimensionless ratios.
 */
export function ringRadiusStats(defVerts, mesh) {
  let maxShrink = 0, minRatio = Infinity, maxGrowth = 0, samples = 0;
  for (let r = 0; r < mesh.ringIdx.length; r++) {
    const idx = mesh.ringIdx[r];
    const c0 = mesh.ringCentroid[r];
    const def = idx.map((i) => defVerts[i]);
    const c1 = vmean(def);
    for (let k = 0; k < idx.length; k++) {
      const vi = idx[k];
      const r0 = vlen(sub(mesh.verts[vi], c0));
      const r1 = vlen(sub(def[k], c1));
      if (r0 <= 0) continue;
      const ratio = r1 / r0;
      samples++;
      if (ratio < minRatio) minRatio = ratio;
      if (1 - ratio > maxShrink) maxShrink = 1 - ratio;
      if (ratio - 1 > maxGrowth) maxGrowth = ratio - 1;
    }
  }
  return { maxShrink, minRatio, maxGrowth, samples };
}

/* ------------------------------------------------------------------ *
 * analytic oracles (independent of the mesh: pure trigonometry)
 * ------------------------------------------------------------------ */
/** LBS ring radius ratio for weight w on the child bone, twist theta (rad). */
export const analyticLBSRadiusRatio = (w, theta) =>
  Math.sqrt((1 - w) * (1 - w) + w * w + 2 * w * (1 - w) * Math.cos(theta));

/** LBS: angle (rad) the ring's radius vector is swung by, for weight w. */
export const analyticLBSJointAngle = (w, theta) =>
  Math.atan2(w * Math.sin(theta), 1 - w + w * Math.cos(theta));

/**
 * DQS ring rotation angle (rad) for weight w on the child bone, twist theta.
 *
 * The antipodality flip inside DQS replaces theta by its shortest-path
 * representative in (-pi, pi], so this oracle wraps too. LBS does NOT wrap:
 * it interpolates vectors, so a 270-degree twist really swings the long way.
 */
export function analyticDQSJointAngle(w, theta) {
  let th = theta % (2 * Math.PI);
  if (th > Math.PI) th -= 2 * Math.PI;
  if (th <= -Math.PI) th += 2 * Math.PI;
  return 2 * Math.atan2(w * Math.sin(th / 2), 1 - w + w * Math.cos(th / 2));
}

/* ------------------------------------------------------------------ *
 * scenarios and metrics
 * ------------------------------------------------------------------ */
/** pose at parameter t in [0,1], piecewise-linear through scn.keys */
export function poseAt(scn, t) {
  const keys = scn.keys;
  if (t <= keys[0].t) return keys[0].pose;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].pose;
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].t < t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = (t - a.t) / (b.t - a.t);
  const n = scn.rig.bones;
  const twist = [], bend = [];
  for (let k = 0; k < n; k++) {
    twist.push((a.pose.twist[k] ?? 0) * (1 - u) + (b.pose.twist[k] ?? 0) * u);
    bend.push((a.pose.bend[k] ?? 0) * (1 - u) + (b.pose.bend[k] ?? 0) * u);
  }
  return { twist, bend };
}

export function scenarioContext(scn) {
  return { rig: scn.rig, mesh: scn.mesh, restVolume: meshVolume(scn.mesh.verts, scn.mesh.tris) };
}

/** one metric evaluation at time t; returns dimensionless numbers */
export function evalMetric(ctx, scn, mode, t) {
  const pose = poseAt(scn, t);
  const tr = skinMatrices(scn.rig, pose);
  const def = skin(mode, tr, scn.mesh.verts, scn.mesh.weights);
  const st = ringRadiusStats(def, scn.mesh);
  const vol = meshVolume(def, scn.mesh.tris);
  return {
    maxShrink: st.maxShrink,
    minRadiusRatio: st.minRatio,
    volumeRatio: Math.abs(vol / ctx.restVolume),
    pose,
  };
}

/* ------------------------------------------------------------------ *
 * adaptive 1-D enclosure of the sweep maximum (branch and bound)
 * ------------------------------------------------------------------ */
/**
 * Enclose max_{t in [0,1]} f(t) in [lower, upper].
 *
 * `upper` uses a Lipschitz bound L: on a cell [a,b],
 *     max f <= max(f(a), f(b)) + L*(b-a)/2.
 * L is ESTIMATED numerically (probe grid x safety factor), not proven
 * analytically — see README "known limits". The enclosure is therefore a
 * validated band, not a formal proof.
 */
export function estimateLipschitz(f, n, t0 = 0, t1 = 1, safety = 2) {
  const w = (t1 - t0) / n;
  let prev = f(t0), maxSlope = 0;
  for (let i = 1; i <= n; i++) {
    const cur = f(t0 + i * w);
    const slope = Math.abs(cur - prev) / w;
    if (slope > maxSlope) maxSlope = slope;
    prev = cur;
  }
  return maxSlope * safety;
}

export function encloseMax(f, opts = {}) {
  const t0 = opts.t0 ?? 0, t1 = opts.t1 ?? 1;
  const probe = opts.probe ?? 33;
  const tol = opts.tol ?? 1e-4;
  const maxEvals = opts.maxEvals ?? 20000;
  const safety = opts.safety ?? 2;

  let evals = 0;
  const probeW = (t1 - t0) / probe;
  const grid = [];
  for (let i = 0; i <= probe; i++) { grid.push(f(t0 + i * probeW)); evals++; }
  let L = 0;
  for (let i = 1; i <= probe; i++) L = Math.max(L, Math.abs(grid[i] - grid[i - 1]) / probeW);
  L *= safety;

  const cells = [];
  for (let i = 0; i < probe; i++) {
    cells.push({ a: t0 + i * probeW, b: t0 + (i + 1) * probeW, fa: grid[i], fb: grid[i + 1] });
  }
  let lower = Math.max(...grid);
  const upperOf = (c) => Math.max(c.fa, c.fb) + (L * (c.b - c.a)) / 2;

  let guard = 0;
  while (guard++ < 200000) {
    let bi = -1, bu = -Infinity;
    for (let i = 0; i < cells.length; i++) {
      const u = upperOf(cells[i]);
      if (u > bu) { bu = u; bi = i; }
    }
    const rel = (bu - lower) / Math.max(lower, 1e-300);
    if (rel <= tol || evals >= maxEvals) break;
    const c = cells[bi];
    const m = (c.a + c.b) / 2;
    const fm = f(m);
    evals++;
    if (fm > lower) lower = fm;
    cells[bi] = { a: c.a, b: m, fa: c.fa, fb: fm };
    cells.push({ a: m, b: c.b, fa: fm, fb: c.fb });
  }
  let upper = -Infinity;
  for (const c of cells) upper = Math.max(upper, upperOf(c));
  return { lower, upper, width: upper - lower, relWidth: (upper - lower) / Math.max(lower, 1e-300), evals, lipschitz: L, cells: cells.length };
}

/** enclose min f over [t0,t1] by maximizing -f with the same machinery */
export function encloseMin(f, opts = {}) {
  const e = encloseMax((t) => -f(t), opts);
  return { lower: -e.upper, upper: -e.lower, width: e.width, relWidth: e.relWidth, evals: e.evals, lipschitz: e.lipschitz, cells: e.cells };
}

/** uniform sampling with the same Lipschitz-bound construction (baseline) */
export function uniformEnclosure(f, n, opts = {}) {
  const t0 = opts.t0 ?? 0, t1 = opts.t1 ?? 1;
  const L = opts.lipschitz;
  const w = (t1 - t0) / n;
  let evals = 0, lower = -Infinity, prev = f(t0);
  evals++;
  lower = Math.max(lower, prev);
  let upper = -Infinity;
  for (let i = 1; i <= n; i++) {
    const cur = f(t0 + i * w);
    evals++;
    lower = Math.max(lower, cur);
    upper = Math.max(upper, Math.max(prev, cur) + (L * w) / 2);
    prev = cur;
  }
  return { lower, upper, width: upper - lower, relWidth: (upper - lower) / Math.max(lower, 1e-300), evals };
}

/* ------------------------------------------------------------------ *
 * scaling
 * ------------------------------------------------------------------ */
export function scaleRig(rig, s) {
  return { bones: rig.bones, L: rig.L * s, joints: rig.joints.map((j) => j * s) };
}
export function scaleMesh(mesh, s) {
  const out = { ...mesh, verts: mesh.verts.map((v) => mul(v, s)), ringCentroid: mesh.ringCentroid.map((v) => mul(v, s)), bboxDiag: mesh.bboxDiag * s };
  return out;
}
