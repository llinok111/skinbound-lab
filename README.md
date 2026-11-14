# skinbound-lab

**Promise (one line):** over the *whole* animation sweep of 6 rigs, this tool returns a **bounded enclosure** of the worst-case skin-deformation quality, not a sampled guess — linear blend skinning (LBS) collapses the joint-ring radius by **29.2893 %** at ±90° of twist while dual-quaternion skinning (DQS) drifts by **≤ 2.43e-15**; the enclosure is tight to a relative width of **≤ 9.35e-5** using **44–67 metric evaluations**, where the baseline `baseline/uniform-sweep.mjs` needs **32769 evaluations** to reach the same width (**744.8×**, both strategies handed the *same* estimated Lipschitz bound — caveat in Evidence). One full metric evaluation of a 546-vertex tube costs **0.14–0.18 ms**, run-dependent. Every `≤` below is a ceiling, never a rounded-down value.

Upstream: none

## What this is

Rigging has a famous failure mode: when a joint twists, LBS shrinks the cross-section
around the joint (the "candy wrapper"). DQS is supposed to fix it. The question this
repo answers is *quantitative and over time*: **how bad does it get anywhere during the
animation, and how sure are we about that number?**

A point sample can only under-report the worst case — it carries no bound on what it
missed. `src/core.mjs` therefore returns an **enclosure** `[lower, upper]` of the sweep
extremum via branch-and-bound with a Lipschitz bound, together with the evaluation count
it spent. The sweep metric is dimensionless (radius ratio, volume ratio), so the results
are scale-free.

## How to run (one command)

```bash
node tools/gen-sample.mjs && node bench/verify.mjs     # -> RESULT PASS: 35 passed / 0 failed
```

Other entry points:

```bash
node bench/bench.mjs            # timing -> bench/result.json (cold start + n=9 repeats)
node baseline/uniform-sweep.mjs 4096   # the baseline: uniform sampling, point estimate only
python3 -m http.server 4173     # then open http://localhost:4173/ (index.html + importmap)
```

`src/core.mjs` is a pure ES module: `node -e "import('./src/core.mjs')"` succeeds with no
DOM, no three.js, no IO and no environment access. `index.html` loads three.js from a
pinned CDN importmap (`three@0.169.0`) and `main.js` consumes **the same** `src/core.mjs`
in the browser, then differences it against node's `data/reference.json` (`max |browser − node|`).

## Evidence (`bench/result.json`, real runs, 2026-11-14)

| rig | LBS shrink enclosure (truth = closed form) | DQS shrink | LBS min volume ratio (enclosure) | DQS min volume ratio (enclosure) | evals |
|---|---|---|---|---|---|
| twist2-60 | [0.133975, 0.133982] vs 0.133974596216 | ≤ 5.28e-16 | 0.96309–0.96315 | 0.99456–0.99462 | 44 |
| twist2-90 | [0.292893, 0.292909] vs 0.292893218813 | ≤ 7.50e-16 | 0.92775–0.92780 | 0.98948–0.98955 | 44 |
| twist2-120 | [0.500000, 0.500027] vs 0.5 | ≤ 7.50e-16 | 0.89292–0.89300 | 0.98285–0.98291 | 44 |
| twist3-90 | [0.292893, 0.292909] vs 0.292893218813 | ≤ 1.17e-15 | 0.90366–0.90373 | 0.98597–0.98606 | 44 |
| twist-bend3 | [0.326970, 0.326997] (no closed form: bend included) | ≤ 2.43e-15 | 0.92223–0.92230 | 0.98828–0.98837 | 60 |
| twist-scrub2 | [0.357212, 0.357246] vs 0.357212390313 | ≤ 7.50e-16 | 0.91557–0.91565 | 0.98742–0.98751 | 67 |

Volume rows are **minimal** enclosures (worst case is the smallest ratio); every column is a
genuine interval of non-zero width that stopped on `converged`, not on an evaluation budget
(39–57 evals each).

Timing (`bench/result.json`, the committed run; n = 21 repeats): cold start **17.05 ms**, one full metric
evaluation **0.167 ms** (0.144 / 0.160 / 0.173 ms in other runs — read it as a range),
adaptive enclosure of all 6 sweeps median **33.57 ms** (p95 37.86 ms, within-run relStddev
**5.9 %**), the single-scenario adaptive enclosure median **3.56 ms**
(relStddev 4.0 %), the uniform-4096 baseline median **329.47 ms** (relStddev
0.4 %), and 12 min-sweeps (volume, LBS+DQS) median **111.85 ms** (relStddev
9.2 %). These are one run's numbers; re-running `bench/bench.mjs` writes a new
`result.json` and shifts every timing cell by up to ~20 % — the evidence table above and the
eval-count comparison do not move, because they are not timing-based.

**Stability caveat, not a claim of precision.** The ~34 ms adaptive-6 group is v8-warmup
sensitive: across 3 independent batches of 7 inside one process its median was
32.28 / 32.59 / 30.27 ms (spread 2.32 ms, i.e. ~7 %), but an **independent verifier running
`bench/bench.mjs` in a fresh process measured relStddev 18.4 % for this same group at n = 9**
(the committed run gave 6.1 %). So this group's relative standard deviation exceeds 10 % on
some runs and **no timing number here should be trusted to better than ±20 %**; the
eval-*count* comparison (44 vs 32769) is machine-independent and is the claim that matters.

**Shared-bound caveat.** The 744.8× compares two sampling strategies that are handed the
*same* numerically estimated Lipschitz constant `L`. It is a fair like-for-like comparison,
but `L` is not independently derived, so this is not "our baseline without our bound".

Verification: **35 passed / 0 failed**, exit code 0, `node bench/verify.mjs`.

## 本轮创新

**B 档（偏 A）· 首次把「蒙皮形变质量」做成整段动画扫掠上的可复算包络证书。**

- 台账最近 20 条全是*几何谓词 / TOI / 标签布局 / 量化*类证书；**没有任何一条涉及蒙皮
  （LBS / 双四元数）或形变质量**。本项目把「某一帧的一个数」升级为「整段 t ∈ [0,1] 上
  最坏值的有界区间 + 花了多少次求值」，并对不成立处直说（例如 M5 变异体在纯扭转环上
  结构上测不到，见下）。
- 与谁不一样：`toi-cert-lab` 证的是三角对碰撞区间，`labelcast-lab` 是静态标签布局，
  `convexity-cert-lab` 是静态网格凸性。这里是**形变本身**（半径塌陷 / 体积保持）在
  **连续时间**上的包络。
- 凭什么以前做不到：不做 30 万次暴力扫描也能给出**上界**——分支定界 + Lipschitz 界
  用 44 次求值就收窄到 5.5e-5 相对宽度；均匀采样要 32769 次。三条互相独立的复算口径
  （闭式三角、刚性两两距离、暴力+黄金分割）互不共用常量。
- 所见即所验：浏览器与 node **共用同一个 `src/core.mjs`**，页面实时显示
  `max |browser − node|`，不烘烤任何浏览器侧数字。

## Known limits (absolute thresholds and where they are valid)

1. **The enclosure is validated, not proven.** `estimateLipschitz()` measures the maximum
   slope on a probe grid and multiplies by a **safety factor of 2**. A smaller true
   Lipschitz constant makes the band conservative; a *larger* one would break the bound.
   We falsify it against brute force, we do not derive it analytically. Hence
   "validated enclosure", never "proof".
2. **All thresholds are disclosed.** `bench/verify.mjs` uses: relative 1e-12 for
   closed-form agreement, absolute 1e-14 for the structurally-zero DQS shrink (a relative
   tolerance there would divide noise by noise — see limit 5), 1e-9 for the analytic sweep
   match, 2e-4 relative for enclosure tightness, 1e-4 relative for the target band width.
   **Every quantity is a dimensionless ratio** (radius/radius, volume/volume), so there is
   no length scale in the thresholds at all.
3. **Valid scale range: 1e-6 … 1e6, verified.** The same rig at 5 magnitudes of uniform
   scaling gives identical conclusions, measured drift: LBS shrink ratio 8.287e-16,
   LBS volume ratio 3.094e-14, DQS shrink 5.551e-16 (absolute, because the value is 0).
   Outside that range we have not tested and make no claim.
4. **DQS volume ratio is 0.9829–0.9946, not exactly 1.** That is a *tessellation* effect:
   the twist is only isochoric in the continuous limit, while the tube is a triangulated
   polyhedron with 9 rings per bone. `perBone`/`seg` are parameters; **we did not run the
   refinement study**, so the convergence rate is asserted nowhere here.
5. **A checked-but-structurally-invisible case, found while running.** Mutant M5
   ("measure shrink against the rest centroid") is **undetectable on a pure-twist joint
   ring**, because there the deformed ring centroid coincides with the rest centroid
   (|c1 − c0| = 0 by symmetry). M5 therefore lives on the bent rig, where the test prints
   the pre-condition |c1 − c0| = 0.1743 to show it is non-vacuous. "5/5 mutants rejected"
   must not be read as universal coverage.
6. **Angle readouts are sign-ambiguous at exactly ±π** (a rotation by 180° has no defined
   sign). `bench/verify.mjs` skips such pairs and reports the count (currently 0 skipped).
   The oracle wraps θ into (−π, π] for DQS (antipodality picks the short path) but **not**
   for LBS, which genuinely interpolates vectors the long way — that asymmetry is real,
   not a bug.
7. **Synthetic corpus.** All 6 rigs are deterministic tubes generated by
   `tools/gen-sample.mjs` (no RNG, two runs byte-identical). No real glTF asset is loaded.
8. **The browser comparison is sampled at t = k/16 only**; between those points the page
   shows live numbers with no node reference to diff against.
9. **Four real bugs this repo fixed in itself**, all instances of "the check existed but
   could not see the failure": (a) the volume sweep maximised an extremum that must be
   minimised, so it reported 1.0000 for every rig; (b) the DQS scale-invariance check used
   a *relative* tolerance on a value that is structurally zero; (c) the enclosure's
   stopping rule divided by `max(lower, 1e-300)`, which is meaningless for the negated
   (minimisation) direction, so the volume intervals were **degenerate zero-width
   artifacts** that stopped on float cancellation at ~1.7e-15 instead of on the tolerance
   — found by an independent verifier, fixed by scaling the rule on `max(|lower|,|upper|)`
   with a disclosed dimensionless floor, and the reasons are now reported per sweep
   (`stop: "converged"`); (d) two `≤` bounds in this README were rounded to *nearest*, so
   they were literally false by 0.01–0.07 % — every `≤` is now a ceiling.
10. **Disclosed absolute (dimensionless) threshold:** the enclosure's relative stopping
   rule floors the magnitude at `absFloor = 1e-12` (`src/core.mjs`). All metrics here are
   ratios, so this constant carries **no length scale** and every conclusion is still
   invariant under rig scaling (limit 3). Without it, quantities that are structurally 0
   (DQS shrink) or that cancel in float (volume minima) would never converge.
11. **The Lipschitz constant is audited, not trusted.** `bench/bench.mjs` re-measures
   max |df/dt| on a 2000-point grid — 60× denser than the 33-point probe the bound is built
   from — and reports `worstFineOverProbeSlopeRatio = 1.066`. The probe grid therefore
   misses the steepest region by up to **6.6 %**, which the 2× safety factor absorbs
   (effective headroom 1.87×). If that ratio ever exceeded 2, the enclosure could be
   violated; `bench/falsify.mjs` is the end-to-end check for exactly that.
12. **Independence of the checks.** The 200 k-sample falsification, the 292 640 pair
   rigidity probe and the closed forms share no constants with the branch-and-bound code,
   but the *uniform baseline* is handed the certificate's own `L` (see the Shared-bound
   caveat in Evidence). An independent verifier reproduced the 35/0 result twice
   byte-for-byte at commit 8e5e86d, recomputed the headline collapse from scratch
   (`cos(π/4) = 0.7071067811865476` → 29.289322 %) and found 0/6 enclosure violations at
   200 k samples; findings (c), (d) and the stability caveat above are theirs, and the
   fixes were re-verified afterwards.

## Layout

```
src/core.mjs        pure math: quaternions, dual quaternions, rigs, tube mesh, skinning,
                    volume, ring statistics, closed-form oracles, branch-and-bound enclosure
src/scenarios.mjs   the 6 deterministic rigs and their animation keys
tools/gen-sample.mjs  -> data/rigs.json + data/reference.json (deterministic)
baseline/uniform-sweep.mjs  the sampling baseline this project is measured against
bench/verify.mjs    35 assertions, real values printed
bench/falsify.mjs   adversarial attempt to break the enclosure (own sampling loop)
bench/bench.mjs     timing, cold start, min/median/p95/stddev -> bench/result.json
index.html + main.js  three.js view (pinned importmap), same core, live browser-vs-node diff
```

MIT licensed (see `LICENSE`).
