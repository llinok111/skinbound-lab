# skinbound-lab

**Promise (one line):** over the *whole* animation sweep of 6 rigs, this tool returns a **bounded enclosure** of the worst-case skin-deformation quality, not a sampled guess — linear blend skinning (LBS) collapses the joint-ring radius by **29.2893 %** at ±90° of twist while dual-quaternion skinning (DQS) drifts by **≤ 2.33e-15**; the enclosure is tight to a relative width of **≤ 9.34e-5** using **44–67 metric evaluations**, where the baseline `baseline/uniform-sweep.mjs` needs **32769 evaluations** to reach the same width (**744.8×**). One full metric evaluation of a 546-vertex tube costs **0.160 ms**.

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

| rig | LBS shrink enclosure (truth = closed form) | DQS shrink | LBS min volume ratio | DQS min volume ratio | evals |
|---|---|---|---|---|---|
| twist2-60 | [0.133975, 0.133982] vs 0.133974596216 | ≤ 6.66e-16 | 0.96315 | 0.99462 | 44 |
| twist2-90 | [0.292893, 0.292909] vs 0.292893218813 | ≤ 6.66e-16 | 0.92780 | 0.98955 | 44 |
| twist2-120 | [0.500000, 0.500027] vs 0.5 | ≤ 7.77e-16 | 0.89300 | 0.98291 | 44 |
| twist3-90 | [0.292893, 0.292909] vs 0.292893218813 | ≤ 1.11e-15 | 0.90373 | 0.98606 | 44 |
| twist-bend3 | [0.326970, 0.326997] (no closed form: bend included) | ≤ 2.33e-15 | 0.92230 | 0.98837 | 60 |
| twist-scrub2 | [0.357212, 0.357246] vs 0.357212390313 | ≤ 6.66e-16 | 0.91565 | 0.98751 | 67 |

Timing (n = 9 repeats, `bench/result.json`): cold start **27.28 ms**, one full metric
evaluation **0.160 ms**, adaptive enclosure of all 6 sweeps median **34.18 ms**
(p95 39.78 ms, relStddev 6.1 %), the single-scenario adaptive enclosure median
**4.08 ms** (relStddev 9.7 %), the uniform-4096 baseline median **335.94 ms**
(relStddev 5.0 %), and 12 min-sweeps (volume, LBS+DQS) median **332.57 ms** (relStddev 5.4 %).
Every group's relative standard deviation is below 10 %, so no number here needs a caveat.
Verification: **35 passed / 0 failed**, exit code 0, `node bench/verify.mjs`.

### The three independent oracles (`bench/verify.mjs`)
1. **Closed-form trigonometry** — a ring whose child-bone weight is `w` and whose local
   twist is `θ` shrinks its radius by exactly `1 - sqrt((1-w)² + w² + 2w(1-w)cos θ)`; no
   mesh, no sampling and no shared constant with the renderer is involved (2880 pairs).
2. **Rigidity as a property** — DQS must preserve *every pairwise distance inside a ring*;
   292 640 measured pairs drift by at most **5.995e-15** relative.
3. **Brute force + golden-section polish** — 4096 uniform samples refined locally, used
   only to falsify the enclosure (it must contain the refined truth and stay tight).

`node bench/falsify.mjs 20000` attacks the headline claim directly with its own sampling
loop (it shares no code with the branch-and-bound path): **0/6 enclosure violations,
0/6 vacuous rigs**, largest relative gap 9.343e-5. A 200 000-sample run of the same script
(2 min) gives the identical verdict. Run it yourself before believing the table.

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
9. **Two real bugs this repo fixed in itself**, both instances of "the check existed but
   could not see the failure": (a) the volume sweep maximised an extremum that must be
   minimised, so it reported 1.0000 for every rig; (b) the DQS scale-invariance check used
   a *relative* tolerance on a value that is structurally zero. Neither is hidden; both are
   now regression-checked.

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
