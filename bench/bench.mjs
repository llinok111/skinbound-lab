/*
 * bench/bench.mjs — timing + headline numbers -> bench/result.json
 *   node bench/bench.mjs
 *
 * 1 cold-start run (first call, JIT/v8 warmup included) is reported
 * separately from n>=5 repeated runs (min / median / p95 / stddev).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  scenarioContext, evalMetric, encloseMax, encloseMin, uniformEnclosure,
  estimateLipschitz, meshVolume,
} from "../src/core.mjs";
import { buildScenarios } from "../src/scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const N_REPEAT = 21;
const UNIFORM_N = 4096;

const scns = buildScenarios();
const ctxs = scns.map((s) => scenarioContext(s));
const fns = scns.map((s, i) => ({
  shrink: (t) => evalMetric(ctxs[i], s, "lbs", t).maxShrink,
  dqsShrink: (t) => evalMetric(ctxs[i], s, "dqs", t).maxShrink,
  lbsVolume: (t) => evalMetric(ctxs[i], s, "lbs", t).volumeRatio,
  dqsVolume: (t) => evalMetric(ctxs[i], s, "dqs", t).volumeRatio,
}));

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const varp = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const pct = (p) => s[Math.min(n - 1, Math.max(0, Math.ceil(p * n) - 1))];
  return {
    n,
    min: Number(s[0].toFixed(4)),
    median: Number(pct(0.5).toFixed(4)),
    p95: Number(pct(0.95).toFixed(4)),
    max: Number(s[n - 1].toFixed(4)),
    mean: Number(mean.toFixed(4)),
    stddev: Number(Math.sqrt(varp).toFixed(4)),
    relStddev: Number((Math.sqrt(varp) / (mean || 1)).toFixed(4)),
  };
};
const timeIt = (fn) => { const a = performance.now(); fn(); return performance.now() - a; };

/* ---------- cold start: very first enclosure call in this process ---------- */
const coldStartMs = Number(timeIt(() => encloseMax(fns[0].shrink, { tol: 1e-4, probe: 33, safety: 2 })).toFixed(4));

/* ---------- metric evaluation cost (per frame) ---------- */
{
  const a = performance.now();
  const N = 200;
  for (let i = 0; i < N; i++) fns[0].shrink(i / (N - 1));
  const perEvalMs = (performance.now() - a) / N;
  var perEval = Number(perEvalMs.toFixed(5));
}

/* ---------- adaptive enclosure, all scenarios, repeated ---------- */
const adaptiveRuns = [];
for (let r = 0; r < N_REPEAT; r++) {
  const a = performance.now();
  for (let i = 0; i < scns.length; i++) encloseMax(fns[i].shrink, { tol: 1e-4, probe: 33, safety: 2 });
  adaptiveRuns.push(performance.now() - a);
}

/* ---------- cross-invocation stability: 3 independent batches ---------- */
const batchMedians = [];
for (let b = 0; b < 3; b++) {
  const runs = [];
  for (let r = 0; r < 7; r++) {
    const a = performance.now();
    for (let i = 0; i < scns.length; i++) encloseMax(fns[i].shrink, { tol: 1e-4, probe: 33, safety: 2 });
    runs.push(performance.now() - a);
  }
  batchMedians.push(Number(stats(runs).median.toFixed(4)));
}

/* ---------- is the estimated Lipschitz constant adequate? ---------- */
const lipschitzAudit = scns.map((scn, i) => {
  const probeSlope = estimateLipschitz(fns[i].shrink, 33, 0, 1, 1);
  const N = 2000;
  let fineSlope = 0, prev = fns[i].shrink(0);
  for (let k = 1; k <= N; k++) {
    const cur = fns[i].shrink(k / N);
    fineSlope = Math.max(fineSlope, Math.abs(cur - prev) * N);
    prev = cur;
  }
  return { id: scn.id, probeMaxSlope: Number(probeSlope.toPrecision(6)), fineMaxSlope: Number(fineSlope.toPrecision(6)), ratioFineOverProbe: Number((fineSlope / probeSlope).toPrecision(6)) };
});
const worstLipschitzRatio = Math.max(...lipschitzAudit.map((r) => r.ratioFineOverProbe));

/* ---------- single scenario: adaptive vs uniform at equal width ---------- */
const i1 = 1;
const L1 = estimateLipschitz(fns[i1].shrink, 33, 0, 1, 2);
const uniformRuns = [];
for (let r = 0; r < 5; r++) uniformRuns.push(timeIt(() => uniformEnclosure(fns[i1].shrink, UNIFORM_N, { lipschitz: L1 })));
const adaptive1Runs = [];
for (let r = 0; r < N_REPEAT; r++) adaptive1Runs.push(timeIt(() => encloseMax(fns[i1].shrink, { tol: 1e-4, probe: 33, safety: 2 })));

/* ---------- volume sweeps (min) ---------- */
const volumeRuns = [];
for (let r = 0; r < 5; r++) {
  volumeRuns.push(timeIt(() => {
    for (let i = 0; i < scns.length; i++) {
      encloseMin(fns[i].lbsVolume, { tol: 1e-4, probe: 33, safety: 2 });
      encloseMin(fns[i].dqsVolume, { tol: 1e-4, probe: 33, safety: 2 });
    }
  }));
}

/* ---------- headline values (recomputed here, not copied) ---------- */
const headline = scns.map((s, i) => {
  const encL = encloseMax(fns[i].shrink, { tol: 1e-4, probe: 33, safety: 2 });
  const encD = encloseMax(fns[i].dqsShrink, { tol: 1e-4, probe: 33, safety: 2 });
  const volL = encloseMin(fns[i].lbsVolume, { tol: 1e-4, probe: 33, safety: 2 });
  const volD = encloseMin(fns[i].dqsVolume, { tol: 1e-4, probe: 33, safety: 2 });
  const rest = meshVolume(s.mesh.verts, s.mesh.tris);
  return {
    id: s.id,
    bones: s.rig.bones,
    pureTwist: s.pureTwist,
    analyticMaxShrink: s.analyticMaxShrink === null ? null : Number(s.analyticMaxShrink.toPrecision(12)),
    lbsShrink: { lower: Number(encL.lower.toPrecision(12)), upper: Number(encL.upper.toPrecision(12)), relWidth: Number(encL.relWidth.toPrecision(4)), evals: encL.evals, stop: encL.stop },
    dqsShrink: { lower: Number(encD.lower.toPrecision(12)), upper: Number(encD.upper.toPrecision(12)), relWidth: Number(encD.relWidth.toPrecision(4)), evals: encD.evals },
    lbsVolumeRatio: { lower: Number(volL.lower.toPrecision(12)), upper: Number(volL.upper.toPrecision(12)), evals: volL.evals, stop: volL.stop },
    dqsVolumeRatio: { lower: Number(volD.lower.toPrecision(12)), upper: Number(volD.upper.toPrecision(12)), evals: volD.evals, stop: volD.stop },
    restVolume: Number(rest.toPrecision(12)),
    verts: s.mesh.verts.length,
    tris: s.mesh.tris.length,
  };
});

const uniformAt4096 = uniformEnclosure(fns[i1].shrink, UNIFORM_N, { lipschitz: L1 });
let uniformN = UNIFORM_N, uniformToTol = uniformAt4096;
while (uniformToTol.relWidth > 1e-4 && uniformN < 1 << 20) { uniformN *= 2; uniformToTol = uniformEnclosure(fns[i1].shrink, uniformN, { lipschitz: L1 }); }
const adaptiveAt = encloseMax(fns[i1].shrink, { tol: 1e-4, probe: 33, safety: 2 });

const out = {
  generatedBy: "bench/bench.mjs",
  runtime: { node: process.version, platform: process.platform, cores: (await import("node:os")).cpus().length },
  timeUnitMs: "milliseconds",
  coldStartMs,
  adaptiveSweep6BatchMediansMs: batchMedians,
  adaptiveSweep6BatchSpreadMs: Number((Math.max(...batchMedians) - Math.min(...batchMedians)).toFixed(4)),
  lipschitzAudit,
  worstFineOverProbeSlopeRatio: Number(worstLipschitzRatio.toPrecision(6)),
  perMetricEvalMs: perEval,
  repeats: N_REPEAT,
  adaptiveSweep6ScenariosMs: stats(adaptiveRuns),
  adaptiveSingleScenarioMs: stats(adaptive1Runs),
  uniform4096SingleScenarioMs: stats(uniformRuns),
  volumeSweep12MinSweepsMs: stats(volumeRuns),
  lipschitzEstimated: Number(L1.toPrecision(6)),
  evalBudget: {
    scenario: scns[i1].id,
    adaptiveEvals: adaptiveAt.evals,
    adaptiveRelWidth: Number(adaptiveAt.relWidth.toExponential(3)),
    uniform4096RelWidth: Number(uniformAt4096.relWidth.toExponential(3)),
    uniformEvalsToReachSameWidth: uniformToTol.evals,
    uniformRelWidthAtThatN: Number(uniformToTol.relWidth.toExponential(3)),
    evalCountRatio: Number((uniformToTol.evals / adaptiveAt.evals).toFixed(1)),
  },
  headline,
  notes: [
    "adaptive = branch-and-bound enclosure of the sweep extremum, driven by a numerically estimated Lipschitz bound (x2 safety factor); NOT a formal proof.",
    "uniform = the baseline sampling strategy in baseline/uniform-sweep.mjs; it yields a point estimate, and an enclosure only when handed the same Lipschitz bound.",
    "perMetricEvalMs is one full LBS evaluation of the whole tube mesh (transform build + skin + ring statistics + volume).",
    "The uniform baseline is handed the SAME numerically estimated Lipschitz constant as the certificate; the eval-count ratio compares sampling strategies under one shared bound, it is not an independently derived baseline rate.",
    "lipschitzAudit re-measures max |df/dt| on a 2000-point grid (60x denser than the 33-point probe the bound is built from). ratioFineOverProbe <= 1 means the probe grid did not miss a steeper region.",
  ],
};
writeFileSync(join(here, "result.json"), JSON.stringify(out, null, 1) + "\n");

console.log(`cold start            : ${coldStartMs} ms`);
console.log(`adaptive-6 batch medians: ${batchMedians.join(" / ")} ms (spread ${out.adaptiveSweep6BatchSpreadMs} ms across 3 independent batches)`);
console.log(`Lipschitz adequacy    : worst fine/probe slope ratio = ${out.worstFineOverProbeSlopeRatio} (<=1 means the 33-point probe did not miss a steeper region)`);
console.log(`per metric eval       : ${out.perMetricEvalMs} ms`);
console.log(`adaptive 6 scenarios  : n=${out.adaptiveSweep6ScenariosMs.n} median=${out.adaptiveSweep6ScenariosMs.median} ms p95=${out.adaptiveSweep6ScenariosMs.p95} relStddev=${(out.adaptiveSweep6ScenariosMs.relStddev * 100).toFixed(1)}%`);
console.log(`adaptive 1 scenario   : median=${out.adaptiveSingleScenarioMs.median} ms relStddev=${(out.adaptiveSingleScenarioMs.relStddev * 100).toFixed(1)}%`);
console.log(`uniform 4096 baseline : median=${out.uniform4096SingleScenarioMs.median} ms relStddev=${(out.uniform4096SingleScenarioMs.relStddev * 100).toFixed(1)}%`);
console.log(`volume 12 min-sweeps  : median=${out.volumeSweep12MinSweepsMs.median} ms relStddev=${(out.volumeSweep12MinSweepsMs.relStddev * 100).toFixed(1)}%`);
console.log(`eval budget (${out.evalBudget.scenario}): adaptive ${out.evalBudget.adaptiveEvals} evals -> relWidth ${out.evalBudget.adaptiveRelWidth}; uniform needs ${out.evalBudget.uniformEvalsToReachSameWidth} evals -> ${out.evalBudget.evalCountRatio}x`);
// print every bound as a true ceiling, matching README's convention
const ceilSig = (v, d = 3) => { const m = 10 ** (d - 1 - Math.floor(Math.log10(Math.abs(v)))); return Math.ceil(v * m) / m; };
console.log(`headline: ${headline.map((h) => `${h.id} LBS<=${ceilSig(h.lbsShrink.upper, 7).toFixed(6)} DQS<=${ceilSig(h.dqsShrink.upper).toExponential(2)}`).join(" | ")}`);
console.log("bench/result.json written");
