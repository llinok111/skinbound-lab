/*
 * baseline/uniform-sweep.mjs — the naive baseline this project is measured against.
 *
 * It answers the same question ("what is the worst LBS radius collapse over
 * the animation?") by enumerating N uniform samples and taking the maximum.
 * That is a POINT ESTIMATE: it can only ever under-report the true maximum and
 * it carries no bound on how much it missed. The certificate path in
 * src/core.mjs (encloseMax) returns an interval that provably brackets the
 * true maximum, using far fewer evaluations.
 *
 *   node baseline/uniform-sweep.mjs [N]
 *
 * Prints evals / value / milliseconds. No timing is faked: identical metric
 * function, only the sampling strategy differs.
 */
import { scenarioContext, evalMetric, uniformEnclosure } from "../src/core.mjs";
import { buildScenarios } from "../src/scenarios.mjs";

const N = Number(process.argv[2] ?? 4096);
const scns = buildScenarios();

let totalEvals = 0;
const t0 = performance.now();
for (const scn of scns) {
  const ctx = scenarioContext(scn);
  const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
  // honest Lipschitz estimate is NOT free in the baseline either (same probe
  // grid the certificate uses), so a point estimate is all the baseline has.
  let best = -Infinity, arg = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const v = f(t);
    totalEvals++;
    if (v > best) { best = v; arg = t; }
  }
  console.log(
    `${scn.id.padEnd(14)} uniform-${N} evals=${N + 1} maxShrink=${best.toFixed(9)} (underestimate, no bound) argmax_t=${arg.toFixed(6)}`,
  );
}
const ms = performance.now() - t0;
console.log(`\nbaseline total: evals=${totalEvals} wall=${ms.toFixed(1)}ms  (point estimate only: no enclosure, no Lipschitz bound)`);

// show what an enclosure of the same width would cost the uniform strategy
const scn = scns[1];
const ctx = scenarioContext(scn);
const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
const e = uniformEnclosure(f, N, { lipschitz: 1.11 });
console.log(`uniform enclosure at N=${N}: [${e.lower.toFixed(9)}, ${e.upper.toFixed(9)}] relWidth=${e.relWidth.toExponential(3)} evals=${e.evals}`);
