/*
 * bench/verify.mjs — real assertions on real numbers.
 *   node bench/verify.mjs
 * Exit 0 only if every check passes. Every check prints the value it measured.
 */
import {
  scenarioContext, evalMetric, skinMatrices, skin, poseAt, meshVolume, makeRig, buildTube,
  encloseMax, uniformEnclosure, estimateLipschitz, scaleRig, scaleMesh,
  analyticLBSRadiusRatio, analyticLBSJointAngle, analyticDQSJointAngle,
  dqDot, dqToRigid, rigidToDQ, rapply, qmul, qconj, DEG, vec,
} from "../src/core.mjs";
import { buildScenarios } from "../src/scenarios.mjs";

let passed = 0, failed = 0;
const num = (v, d = 9) => (Number.isFinite(v) ? v.toFixed(d) : String(v));
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${name}  ${detail}`); }
  else { failed++; console.log(`  FAIL  ${name}  ${detail}`); }
}
const scns = buildScenarios();
const TAU = [0, 0.25, 0.5, 0.75, 1];

/* ---------- 1. mesh sanity: closed, oriented, positive volume ---------- */
console.log("\n[1] tube mesh is closed and manifold");
{
  let bad = 0, totalEdges = 0, negVol = 0;
  for (const scn of scns) {
    const dir = new Map();
    for (const t of scn.mesh.tris) {
      for (let k = 0; k < 3; k++) {
        const e = `${t[k]},${t[(k + 1) % 3]}`;
        dir.set(e, (dir.get(e) ?? 0) + 1);
      }
    }
    for (const [e, n] of dir) {
      totalEdges++;
      const [a, b] = e.split(",");
      if (n !== 1 || (dir.get(`${b},${a}`) ?? 0) !== 1) bad++;
    }
    if (meshVolume(scn.mesh.verts, scn.mesh.tris) <= 0) negVol++;
  }
  check("every directed edge used exactly once (closed)", bad === 0, `directedEdges=${totalEdges} bad=${bad}`);
  check("all rest volumes positive (winding consistent)", negVol === 0, `negativeVolumes=${negVol}/6`);
}

/* ---------- 2/3. closed-form oracles per ring, pure-twist scenarios ---------- */
console.log("\n[2] LBS radius ratio == closed form  sqrt((1-w)^2 + w^2 + 2w(1-w)cos t)");
{
  let pairs = 0, worst = 0, worstAt = "";
  for (const scn of scns) {
    if (!scn.pureTwist) continue;
    for (const t of TAU) {
      const tr = skinMatrices(scn.rig, poseAt(scn, t));
      const def = skin("lbs", tr, scn.mesh.verts, scn.mesh.weights);
      const pose = poseAt(scn, t);
      for (let r = 0; r < scn.mesh.ringIdx.length; r++) {
        const w = scn.mesh.weights[scn.mesh.ringIdx[r][0]];
        if (w.length !== 2) continue;
        const theta = (pose.twist[w[1][0]] ?? 0) * DEG;
        const c0 = scn.mesh.ringCentroid[r];
        const c1 = vec.mean(scn.mesh.ringIdx[r].map((i) => def[i]));
        for (const vi of scn.mesh.ringIdx[r]) {
          const r0 = vec.len(vec.sub(scn.mesh.verts[vi], c0));
          const r1 = vec.len(vec.sub(def[vi], c1));
          const err = Math.abs(r1 / r0 - analyticLBSRadiusRatio(w[1][1], theta));
          pairs++;
          if (err > worst) { worst = err; worstAt = `${scn.id} t=${t} ring=${r} w=${w[1][1].toFixed(3)} theta=${(theta / DEG).toFixed(1)}deg`; }
        }
      }
    }
  }
  check("max |measured - closed form| <= 1e-12", worst <= 1e-12, `pairs=${pairs} worstAbsErr=${worst.toExponential(3)} at ${worstAt}`);
}

console.log("\n[3] LBS radius swing angle == closed form  atan2(w sin t, 1-w+w cos t)  (+parent world twist)");
{
  const wrapPi = (a) => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x <= -Math.PI) x += 2 * Math.PI; return x; };
  const worldTwist = (pose, parent) => { let s = 0; for (let k = 1; k <= parent; k++) s += pose.twist[k] ?? 0; return s * DEG; };
  let pairs = 0, worst = 0;
  for (const scn of scns) {
    if (!scn.pureTwist) continue;
    for (const t of TAU) {
      const tr = skinMatrices(scn.rig, poseAt(scn, t));
      const def = skin("lbs", tr, scn.mesh.verts, scn.mesh.weights);
      const pose = poseAt(scn, t);
      for (let r = 0; r < scn.mesh.ringIdx.length; r++) {
        const w = scn.mesh.weights[scn.mesh.ringIdx[r][0]];
        if (w.length !== 2) continue;
        const theta = (pose.twist[w[1][0]] ?? 0) * DEG;
        const base = worldTwist(pose, w[0][0]);
        const c0 = scn.mesh.ringCentroid[r];
        const c1 = vec.mean(scn.mesh.ringIdx[r].map((i) => def[i]));
        const vi = scn.mesh.ringIdx[r][0];
        const a0 = Math.atan2(scn.mesh.verts[vi][2] - c0[2], scn.mesh.verts[vi][1] - c0[1]);
        const a1 = Math.atan2(def[vi][2] - c1[2], def[vi][1] - c1[1]);
        const err = Math.abs(wrapPi(a1 - a0 - base - analyticLBSJointAngle(w[1][1], theta)));
        pairs++;
        if (err > worst) worst = err;
      }
    }
  }
  check("max angle error <= 1e-12 rad", worst <= 1e-12, `pairs=${pairs} worstRad=${worst.toExponential(3)} worstDeg=${(worst / DEG).toExponential(3)}`);
}

/* ---------- 4/5. DQS is rigid: pairwise distances and angle preserved ---------- */
console.log("\n[4] DQS preserves every ring's pairwise distances (rigidity, property oracle)");
{
  let pairs = 0, worst = 0;
  for (const scn of scns) {
    for (const t of TAU) {
      const tr = skinMatrices(scn.rig, poseAt(scn, t));
      const def = skin("dqs", tr, scn.mesh.verts, scn.mesh.weights);
      for (const ring of scn.mesh.ringIdx) {
        for (let a = 0; a < ring.length; a++) {
          for (let b = a + 1; b < ring.length; b++) {
            const d0 = vec.len(vec.sub(scn.mesh.verts[ring[a]], scn.mesh.verts[ring[b]]));
            const d1 = vec.len(vec.sub(def[ring[a]], def[ring[b]]));
            const err = Math.abs(d1 / d0 - 1);
            pairs++;
            if (err > worst) worst = err;
          }
        }
      }
    }
  }
  check("max relative pairwise-distance drift <= 1e-14", worst <= 1e-14, `pairs=${pairs} worstRelDrift=${worst.toExponential(3)}`);
}
console.log("\n[5] DQS ring rotation == closed form  2 atan2(w sin(t/2), 1-w+w cos(t/2)), wrapped");
{
  const wrapPi = (a) => { let x = a % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x <= -Math.PI) x += 2 * Math.PI; return x; };
  const worldTwist = (pose, parent) => { let s = 0; for (let k = 1; k <= parent; k++) s += pose.twist[k] ?? 0; return s * DEG; };
  let pairs = 0, worst = 0, skipped = 0;
  for (const scn of scns) {
    if (!scn.pureTwist) continue;
    for (const t of TAU) {
      const tr = skinMatrices(scn.rig, poseAt(scn, t));
      const def = skin("dqs", tr, scn.mesh.verts, scn.mesh.weights);
      const pose = poseAt(scn, t);
      for (let r = 0; r < scn.mesh.ringIdx.length; r++) {
        const w = scn.mesh.weights[scn.mesh.ringIdx[r][0]];
        if (w.length !== 2) continue;
        const theta = (pose.twist[w[1][0]] ?? 0) * DEG;
        const pred = analyticDQSJointAngle(w[1][1], theta);
        // exactly +-pi is sign-ambiguous for an angle readout; disclosed, not counted
        if (Math.abs(Math.abs(pred) - Math.PI) < 1e-9) { skipped++; continue; }
        const base = worldTwist(pose, w[0][0]);
        const c0 = scn.mesh.ringCentroid[r];
        const c1 = vec.mean(scn.mesh.ringIdx[r].map((i) => def[i]));
        const vi = scn.mesh.ringIdx[r][0];
        const a0 = Math.atan2(scn.mesh.verts[vi][2] - c0[2], scn.mesh.verts[vi][1] - c0[1]);
        const a1 = Math.atan2(def[vi][2] - c1[2], def[vi][1] - c1[1]);
        const err = Math.abs(wrapPi(a1 - a0 - base - pred));
        pairs++;
        if (err > worst) worst = err;
      }
    }
  }
  check("max angle error <= 1e-12 rad", worst <= 1e-12, `pairs=${pairs} skippedSignAmbiguous=${skipped} worstDeg=${(worst / DEG).toExponential(3)}`);
}

/* ---------- 6. volume: two independent accumulation orders ---------- */
console.log("\n[6] mesh volume: divergence-theorem vs per-face centroid/area/normal");
{
  const volume2 = (verts, tris) => {
    let s = 0;
    for (const t of tris) {
      const a = verts[t[0]], b = verts[t[1]], c = verts[t[2]];
      const n = vec.cross(vec.sub(b, a), vec.sub(c, a));
      const area = vec.len(n) / 2;
      const unit = vec.norm(n);
      const cen = vec.mul(vec.add(vec.add(a, b), c), 1 / 3);
      s += vec.dot(cen, unit) * area;
    }
    return s / 3;
  };
  let worst = 0, samples = 0;
  for (const scn of scns) {
    for (const t of [0, 0.5, 1]) {
      const tr = skinMatrices(scn.rig, poseAt(scn, t));
      for (const mode of ["lbs", "dqs"]) {
        const def = skin(mode, tr, scn.mesh.verts, scn.mesh.weights);
        const v1 = meshVolume(def, scn.mesh.tris), v2 = volume2(def, scn.mesh.tris);
        worst = Math.max(worst, Math.abs(v1 - v2) / Math.abs(v1));
        samples++;
      }
    }
  }
  check("max relative disagreement <= 1e-12", worst <= 1e-12, `samples=${samples} worstRelDiff=${worst.toExponential(3)}`);
}

/* ---------- 7. sweep maximum vs closed form ---------- */
console.log("\n[7] sweep-wide worst case == 1 - cos(theta_max/2) on pure-twist rigs");
{
  let worst = 0;
  for (const scn of scns) {
    if (!scn.pureTwist) continue;
    const ctx = scenarioContext(scn);
    const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
    const N = 4096;
    let brute = -Infinity, arg = 0;
    for (let i = 0; i <= N; i++) { const t = i / N; const v = f(t); if (v > brute) { brute = v; arg = t; } }
    // local golden-section polish inside the best bracket (independent of the
    // Lipschitz machinery the certificate uses)
    let lo = Math.max(0, arg - 1 / N), hi = Math.min(1, arg + 1 / N);
    const gr = (1 + Math.sqrt(5)) / 2;
    for (let it = 0; it < 60; it++) {
      const m1 = hi - (hi - lo) / gr, m2 = lo + (hi - lo) / gr;
      if (f(m1) > f(m2)) hi = m2; else lo = m1;
    }
    const best = Math.max(brute, f((lo + hi) / 2));
    const err = Math.abs(best - scn.analyticMaxShrink);
    check(`${scn.id}: |sweepMax - closed form| <= 1e-9`, err <= 1e-9,
      `sweepMax=${num(best)} closedForm=${num(scn.analyticMaxShrink)} absErr=${err.toExponential(2)}`);
    worst = Math.max(worst, err);
  }
  check("all pure-twist rigs agree", worst <= 1e-9, `worstAbsErr=${worst.toExponential(2)}`);
}

/* ---------- 8. enclosure: non-violating AND non-vacuous ---------- */
console.log("\n[8] adaptive enclosure contains the brute-force maximum and is tight");
{
  const rows = [];
  for (const scn of scns) {
    const ctx = scenarioContext(scn);
    const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
    const enc = encloseMax(f, { tol: 1e-4, probe: 33, safety: 2 });
    let brute = -Infinity, arg = 0;
    const N = 4096;
    for (let i = 0; i <= N; i++) { const t = i / N; const v = f(t); if (v > brute) { brute = v; arg = t; } }
    const gr = (1 + Math.sqrt(5)) / 2;
    let lo = Math.max(0, arg - 1 / N), hi = Math.min(1, arg + 1 / N);
    for (let it = 0; it < 60; it++) {
      const m1 = hi - (hi - lo) / gr, m2 = lo + (hi - lo) / gr;
      if (f(m1) > f(m2)) hi = m2; else lo = m1;
    }
    const truth = Math.max(brute, f((lo + hi) / 2));
    const nonViolation = truth <= enc.upper + 1e-15;
    const tightAbs = enc.upper - truth;
    const tightRel = tightAbs / Math.max(truth, Number.MIN_VALUE);
    rows.push({ id: scn.id, evals: enc.evals, relWidth: enc.relWidth, tightRel });
    check(`${scn.id}: enclosure not violated and tight (relGap <= 2e-4)`,
      nonViolation && tightRel <= 2e-4,
      `enclosure=[${num(enc.lower)}, ${num(enc.upper)}] refinedTruth=${num(truth)} relGap=${tightRel.toExponential(2)} relWidth=${enc.relWidth.toExponential(2)} evals=${enc.evals}`);
  }
}

/* ---------- 9. adaptive vs uniform at equal and at equal-width budget ---------- */
console.log("\n[9] adaptive band vs uniform band");
{
  for (const scn of scns) {
    const ctx = scenarioContext(scn);
    const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
    const L = estimateLipschitz(f, 33, 0, 1, 2);
    const uni = uniformEnclosure(f, 4096, { lipschitz: L });
    const ad = encloseMax(f, { tol: 1e-4, probe: 33, safety: 2 });
    check(`${scn.id}: adaptive width <= uniform-4096 width`, ad.relWidth < uni.relWidth,
      `adaptive=${ad.relWidth.toExponential(2)} (${ad.evals} evals) vs uniform4096=${uni.relWidth.toExponential(2)} (4097 evals) ratio=${(uni.relWidth / ad.relWidth).toFixed(1)}x`);
  }
  const scn = scns[1];
  const ctx = scenarioContext(scn);
  const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
  const L = estimateLipschitz(f, 33, 0, 1, 2);
  const ad = encloseMax(f, { tol: 1e-4, probe: 33, safety: 2 });
  let uniN = 4096, uni = uniformEnclosure(f, uniN, { lipschitz: L });
  while (uni.relWidth > 1e-4 && uniN < 1 << 20) { uniN *= 2; uni = uniformEnclosure(f, uniN, { lipschitz: L }); }
  check("uniform needs far more evaluations to reach the same 1e-4 width",
    uni.evals > ad.evals * 10,
    `uniform N=${uniN} evals=${uni.evals} relWidth=${uni.relWidth.toExponential(2)} vs adaptive evals=${ad.evals} relWidth=${ad.relWidth.toExponential(2)} ratio=${(uni.evals / ad.evals).toFixed(0)}x`);
}

/* ---------- 10. shape-only thresholds: scale invariance 1e-6 .. 1e6 ---------- */
console.log("\n[10] scale invariance (1e-6 .. 1e6), all quantities dimensionless");
{
  const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
  let worstShrink = 0, worstVol = 0, worstDqs = 0;
  for (const scn of scns) {
    const ref = null;
    let base = null;
    for (const s of scales) {
      const st = { ...scn, rig: scaleRig(scn.rig, s), mesh: scaleMesh(scn.mesh, s) };
      const ctx = scenarioContext(st);
      const a = evalMetric(ctx, st, "lbs", 1);
      const b = evalMetric(ctx, st, "dqs", 1);
      const v = { shrink: a.maxShrink, vol: a.volumeRatio, dqs: b.maxShrink };
      void ref;
      if (base === null) base = v;
      else {
        worstShrink = Math.max(worstShrink, Math.abs(v.shrink - base.shrink) / Math.max(base.shrink, 1e-300));
        worstVol = Math.max(worstVol, Math.abs(v.vol - base.vol) / base.vol);
        worstDqs = Math.max(worstDqs, Math.abs(v.dqs - base.dqs));
      }
    }
  }
  check("LBS shrink ratio scale-invariant <= 1e-12", worstShrink <= 1e-12, `worstRelDrift=${worstShrink.toExponential(3)} over 6 rigs x 5 magnitudes`);
  check("LBS volume ratio scale-invariant <= 1e-12", worstVol <= 1e-12, `worstRelDrift=${worstVol.toExponential(3)}`);
  // DQS shrink is structurally ZERO (rigid motion, ~1e-16 noise): a relative
  // tolerance would divide noise by noise, so this one is checked absolutely.
  check("DQS shrink scale-invariant (absolute <= 1e-14)", worstDqs <= 1e-14, `worstAbsDrift=${worstDqs.toExponential(3)} (dimensionless, values are ~1e-16 noise)`);
}

/* ---------- 11. mutation self-test ---------- */
console.log("\n[11] mutation self-test: every mutant must be rejected");
{
  const rig = makeRig({ bones: 2, L: 1 });
  const mesh = buildTube(rig, { radius: 0.35, perBone: 9, seg: 32, blend: 0.25 });
  const ring = mesh.ringIdx.find((idx) => mesh.weights[idx[0]].length === 2 && Math.abs(mesh.weights[idx[0]][1][1] - 0.5) < 1e-12);
  const c0 = vec.mean(ring.map((i) => mesh.verts[i]));
  const poseOf = (deg) => ({ twist: [0, deg], bend: [0, 0] });
  const angleOf = (def, center) => {
    const vi = ring[0];
    const a0 = Math.atan2(mesh.verts[vi][2] - c0[2], mesh.verts[vi][1] - c0[1]);
    return Math.atan2(def[vi][2] - center[2], def[vi][1] - center[1]) - a0;
  };
  const centroidOf = (def) => vec.mean(ring.map((i) => def[i]));
  const ratioOf = (def, center) =>
    vec.len(vec.sub(def[ring[0]], center)) / vec.len(vec.sub(mesh.verts[ring[0]], c0));
  const robustAngle = (def, center) => { // wrap to (-pi, pi]
    let a = angleOf(def, center);
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a <= -Math.PI) a += 2 * Math.PI;
    return a;
  };

  const dqsNoFlip = (transforms, verts, weights) => {
    const dqs = transforms.map(rigidToDQ);
    return verts.map((p, vi) => {
      const w = weights[vi];
      const acc = [0, 0, 0, 0, 0, 0, 0, 0];
      for (const [i, ww] of w) for (let m = 0; m < 8; m++) acc[m] += ww * dqs[i][m];
      return rapply(dqToRigid(acc), p);
    });
  };
  const dqsNoNorm = (transforms, verts, weights) => {
    const dqs = transforms.map(rigidToDQ);
    return verts.map((p, vi) => {
      const w = weights[vi];
      let pi = w[0][0], pw = -1;
      for (const [i, ww] of w) if (ww > pw) { pw = ww; pi = i; }
      const acc = [0, 0, 0, 0, 0, 0, 0, 0];
      for (const [i, ww] of w) {
        const s = dqDot(dqs[i], dqs[pi]) < 0 ? -ww : ww;
        for (let m = 0; m < 8; m++) acc[m] += s * dqs[i][m];
      }
      const r = acc.slice(0, 4), d = acc.slice(4);
      const t = qmul([d[0], d[1], d[2], d[3]], qconj(r));
      return rapply({ q: r, t: [t[0] * 2, t[1] * 2, t[2] * 2] }, p);
    });
  };

  const tr90 = skinMatrices(rig, poseOf(90));
  const tr270 = skinMatrices(rig, poseOf(270));
  const trNeg = skinMatrices(rig, poseOf(-90));
  const good = skin("lbs", tr90, mesh.verts, mesh.weights);
  const badW = skin("lbs", tr90, mesh.verts, mesh.weights.map((w) => w.map(([i, x]) => [i, x * 1.1])));

  let centroidOffset = 0;
  const mutants = [
    ["M1 dqs-without-antipodality (270deg twist)",
      Math.abs(robustAngle(dqsNoFlip(tr270, mesh.verts, mesh.weights), centroidOf(dqsNoFlip(tr270, mesh.verts, mesh.weights))) - analyticDQSJointAngle(0.5, 270 * DEG)), 1e-6],
    ["M2 dqs-without-normalisation (pairwise rigidity)",
      (() => {
        const d = dqsNoNorm(tr90, mesh.verts, mesh.weights);
        let worst = 0;
        for (let a = 0; a < ring.length; a++) for (let b = a + 1; b < ring.length; b++) {
          const d0 = vec.len(vec.sub(mesh.verts[ring[a]], mesh.verts[ring[b]]));
          const d1 = vec.len(vec.sub(d[ring[a]], d[ring[b]]));
          worst = Math.max(worst, Math.abs(d1 / d0 - 1));
        }
        return worst;
      })(), 1e-14],
    ["M3 lbs-unnormalised-weights", Math.abs(ratioOf(badW, centroidOf(badW)) - analyticLBSRadiusRatio(0.5, 90 * DEG)), 1e-12],
    ["M4 relative-twist-sign-inverted",
      Math.abs(robustAngle(skin("lbs", trNeg, mesh.verts, mesh.weights), centroidOf(skin("lbs", trNeg, mesh.verts, mesh.weights))) - analyticLBSJointAngle(0.5, 90 * DEG)), 1e-12],
    ["M5 shrink-measured-against-rest-centroid (bent rig, c1 != c0)",
      (() => {
        // On a PURE-TWIST joint ring the deformed centroid coincides with the
        // rest centroid, so this mutant is structurally undetectable there
        // (we found that by running it). The bent rig moves the centroid, so
        // the test becomes non-vacuous. We assert that offset is real.
        const bent = scns[4];
        const tb = 1;
        const trb = skinMatrices(bent.rig, poseAt(bent, tb));
        const defb = skin("lbs", trb, bent.mesh.verts, bent.mesh.weights);
        const rb = [...bent.mesh.ringIdx].reverse().find((idx) => bent.mesh.weights[idx[0]].length === 2 && Math.abs(bent.mesh.weights[idx[0]][1][1] - 0.5) < 1e-12);
        const cb0 = vec.mean(rb.map((i) => bent.mesh.verts[i]));
        const cb1 = vec.mean(rb.map((i) => defb[i]));
        centroidOffset = vec.len(vec.sub(cb1, cb0));
        const r0 = vec.len(vec.sub(bent.mesh.verts[rb[0]], cb0));
        const measured = vec.len(vec.sub(defb[rb[0]], cb0)) / r0;
        const measuredRight = vec.len(vec.sub(defb[rb[0]], cb1)) / r0;
        return Math.abs(measured - measuredRight);
      })(), 1e-12],
  ];
  for (const [name, observed, tol] of mutants) {
    check(`${name} rejected`, !(observed <= tol), `observed=${observed.toExponential(3)} tolerance=${tol.toExponential(0)}`);
  }
  check("M5 pre-condition: the bent rig really moves the ring centroid", centroidOffset > 1e-3,
    `|c1-c0|=${centroidOffset.toExponential(3)} (on the pure-twist ring this offset is 0 by symmetry, which is why M5 lives here)`);
}

console.log(`\nRESULT ${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
