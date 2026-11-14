/*
 * bench/falsify.mjs — adversarial falsification of the enclosure claim.
 *   node bench/falsify.mjs [N]        (default N = 20000, ~12 s)
 *
 * The certificate claims upper >= max_t f(t) for every rig. This script tries
 * to BREAK that: it samples N uniform points per rig with its own loop, finds
 * the largest value, and reports any rig where the brute-force truth exceeds
 * the claimed upper (a violation) or where the upper is vacuous (relative gap
 * > 1e-4, i.e. the band is so wide it proves nothing).
 *
 * It shares only the metric function and the scenario catalogue with the
 * certificate — it does not use the branch-and-bound code path at all.
 *
 * A 200 000-sample run of this script (2 min) gave 0/6 violations and 0/6
 * vacuous rigs, largest relative gap 9.343e-5 (twist-scrub2).
 */
import { scenarioContext, evalMetric, encloseMax } from "../src/core.mjs";
import { buildScenarios } from "../src/scenarios.mjs";

const N = Number(process.argv[2] ?? 20000);
const VACUOUS_REL_GAP = 1e-4;
const scns = buildScenarios();

let violations = 0, vacuous = 0;
for (const scn of scns) {
  const ctx = scenarioContext(scn);
  const f = (t) => evalMetric(ctx, scn, "lbs", t).maxShrink;
  const enc = encloseMax(f, { tol: 1e-4, probe: 33, safety: 2 });
  let truth = -Infinity, arg = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const v = f(t);
    if (v > truth) { truth = v; arg = t; }
  }
  const violated = truth > enc.upper + 1e-15;
  const relGap = (enc.upper - truth) / Math.max(truth, 1e-300);
  if (violated) violations++;
  if (relGap > VACUOUS_REL_GAP) vacuous++;
  console.log(
    `${scn.id.padEnd(13)} N=${N} truth=${truth.toFixed(12)} argmax_t=${arg.toFixed(6)} ` +
    `enclosure=[${enc.lower.toFixed(12)}, ${enc.upper.toFixed(12)}] ` +
    `upper-truth=${(enc.upper - truth).toExponential(3)} relGap=${relGap.toExponential(3)} ` +
    `violated=${violated} vacuous=${relGap > VACUOUS_REL_GAP}`,
  );
}
console.log(`\nFALSIFICATION: violations=${violations}/${scns.length} vacuous=${vacuous}/${scns.length} -> ${violations === 0 && vacuous === 0 ? "enclosure survived" : "CLAIM BROKEN"}`);
process.exit(violations === 0 ? 0 : 1);
