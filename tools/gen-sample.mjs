/*
 * tools/gen-sample.mjs — deterministic sample/reference generator.
 *
 *   node tools/gen-sample.mjs
 *
 * Writes data/rigs.json (rig + animation parameters) and data/reference.json
 * (node-computed numbers the browser re-derives from the same src/core.mjs).
 * Fixed content, no RNG, no clock, no network: two runs are byte-identical.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scenarioContext, evalMetric, encloseMax, encloseMin, scaleRig, scaleMesh, poseAt,
  analyticLBSRadiusRatio, analyticLBSJointAngle, analyticDQSJointAngle,
  skinMatrices, skin, DEG,
} from "../src/core.mjs";
import { buildScenarios } from "../src/scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");

const SCALES = [1e-6, 1e-3, 1, 1e3, 1e6];
const round = (v, d = 12) => Number(v.toPrecision(d));

function sweep(scn, ctx, mode, metric, tol = 1e-4) {
  const f = (t) => (metric === "volume"
    ? evalMetric(ctx, scn, mode, t).volumeRatio
    : evalMetric(ctx, scn, mode, t).maxShrink);
  // shrink: the worst case is the MAXIMUM; volume ratio: the worst case is the MINIMUM.
  const e = metric === "volume"
    ? encloseMin(f, { tol, probe: 33, safety: 2 })
    : encloseMax(f, { tol, probe: 33, safety: 2 });
  return { lower: round(e.lower), upper: round(e.upper), relWidth: round(e.relWidth, 6), evals: e.evals };
}

/** index of the ring that sits exactly on an interior joint (50/50 weights) */
export function jointRings(scn) {
  const out = [];
  for (let r = 0; r < scn.mesh.ringIdx.length; r++) {
    const w = scn.mesh.weights[scn.mesh.ringIdx[r][0]];
    if (w.length === 2 && Math.abs(w[1][1] - 0.5) < 1e-12) out.push({ ring: r, child: w[1][0] });
  }
  return out;
}

/** closed-form vs measured radius/angle oracles on the 50/50 joint ring */
function oracleRows(scn) {
  if (!scn.pureTwist) return [];
  const jr = jointRings(scn);
  if (!jr.length) return [];
  const rows = [];
  for (const t of [0.25, 0.5, 0.75, 1]) {
    const tr = skinMatrices(scn.rig, poseAt(scn, t));
    const defL = skin("lbs", tr, scn.mesh.verts, scn.mesh.weights);
    const defD = skin("dqs", tr, scn.mesh.verts, scn.mesh.weights);
    const pose = poseAt(scn, t);
    let worst = null;
    for (const { ring, child } of jr) {
      const theta = (pose.twist[child] ?? 0) * DEG;
      const idx = scn.mesh.ringIdx[ring];
      const c0 = scn.mesh.ringCentroid[ring];
      const centroid = (def, list) => {
        const c = [0, 0, 0];
        for (const vi of list) { c[0] += def[vi][0]; c[1] += def[vi][1]; c[2] += def[vi][2]; }
        return c.map((v) => v / list.length);
      };
      const cL = centroid(defL, idx), cD = centroid(defD, idx);
      const vi = idx[0];
      const radius = (def, c) => Math.hypot(def[vi][0] - c[0], def[vi][1] - c[1], def[vi][2] - c[2]);
      const ang = (def, c) => Math.atan2(def[vi][2] - c[2], def[vi][1] - c[1]);
      const a0 = Math.atan2(scn.mesh.verts[vi][2] - c0[2], scn.mesh.verts[vi][1] - c0[1]);
      const row = {
        t, child, thetaDeg: round(theta / DEG, 6),
        measuredRatio: round(radius(defL, cL) / radius(scn.mesh.verts, c0)),
        predictedLBSratio: round(analyticLBSRadiusRatio(0.5, theta)),
        measuredLBSangleDeg: round((ang(defL, cL) - a0) / DEG, 9),
        predictedLBSangleDeg: round(analyticLBSJointAngle(0.5, theta) / DEG, 9),
        measuredDQSRatio: round(radius(defD, cD) / radius(scn.mesh.verts, c0), 15),
        measuredDQSangleDeg: round((ang(defD, cD) - a0) / DEG, 9),
        predictedDQSangleDeg: round(analyticDQSJointAngle(0.5, theta) / DEG, 9),
      };
      row.ratioAbsErr = round(Math.abs(row.measuredRatio - row.predictedLBSratio), 6);
      const aErr = Math.abs(row.measuredLBSangleDeg - row.predictedLBSangleDeg);
      if (!worst || aErr > worst.angleAbsErr) worst = { ...row, angleAbsErr: round(aErr, 9) };
    }
    rows.push(worst);
  }
  return rows;
}

function scaleRows(scns) {
  const out = [];
  for (const scn of scns) {
    const row = { id: scn.id, values: [] };
    for (const s of SCALES) {
      const st = { ...scn, rig: scaleRig(scn.rig, s), mesh: scaleMesh(scn.mesh, s) };
      const ctx = scenarioContext(st);
      const a = evalMetric(ctx, st, "lbs", 1);
      const b = evalMetric(ctx, st, "dqs", 1);
      row.values.push({ scale: s, lbsShrink: round(a.maxShrink), lbsVol: round(a.volumeRatio), dqsShrink: round(b.maxShrink), dqsVol: round(b.volumeRatio) });
    }
    out.push(row);
  }
  return out;
}

export function buildReference() {
  const scns = buildScenarios();
  const scenarios = [];
  for (const scn of scns) {
    const ctx = scenarioContext(scn);
    const samples = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const a = evalMetric(ctx, scn, "lbs", t);
      const b = evalMetric(ctx, scn, "dqs", t);
      samples.push({ t, lbsShrink: round(a.maxShrink), dqsShrink: round(b.maxShrink), lbsVol: round(a.volumeRatio), dqsVol: round(b.volumeRatio) });
    }
    scenarios.push({
      id: scn.id, bones: scn.rig.bones, L: scn.rig.L, radius: scn.radius,
      perBone: scn.perBone, seg: scn.seg, blend: scn.blend, pureTwist: scn.pureTwist,
      analyticMaxShrink: scn.analyticMaxShrink === null ? null : round(scn.analyticMaxShrink),
      keys: scn.keys.map((k) => ({ t: k.t, twist: k.pose.twist, bend: k.pose.bend })),
      jointRings: jointRings(scn).map((j) => ({ ring: j.ring, child: j.child })),
      sweep: {
        lbsShrink: sweep(scn, ctx, "lbs", "shrink"),
        dqsShrink: sweep(scn, ctx, "dqs", "shrink"),
        lbsVolume: sweep(scn, ctx, "lbs", "volume"),
        dqsVolume: sweep(scn, ctx, "dqs", "volume"),
      },
      oracle: oracleRows(scn),
      samples,
    });
  }
  return {
    generator: "tools/gen-sample.mjs",
    schema: "skinbound/reference@1",
    scales: SCALES,
    scenarios,
    scaleInvariance: scaleRows(scns),
  };
}

const ref = buildReference();
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "reference.json"), JSON.stringify(ref, null, 1) + "\n");
const rigs = {
  schema: "skinbound/rigs@1",
  tubeDefaults: { perBone: 9, seg: 32, blend: 0.25, radius: 0.35 },
  scenarios: ref.scenarios.map((s) => ({ id: s.id, bones: s.bones, L: s.L, radius: s.radius, perBone: s.perBone, seg: s.seg, blend: s.blend, pureTwist: s.pureTwist, keys: s.keys })),
};
writeFileSync(join(dataDir, "rigs.json"), JSON.stringify(rigs, null, 1) + "\n");

let verts = 0, tris = 0, oracleN = 0;
for (const scn of buildScenarios()) { verts += scn.mesh.verts.length; tris += scn.mesh.tris.length; }
for (const s of ref.scenarios) oracleN += s.oracle.length;
console.log(`data/reference.json + data/rigs.json written | scenarios=${ref.scenarios.length} scales=${ref.scales.length} verts=${verts} tris=${tris} oracleRows=${oracleN}`);
