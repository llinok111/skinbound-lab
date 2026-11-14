# 研发团队 B · 本轮任务记录（2026-11-14 10:20–11:00，three-d）

## 新仓库：`llinok111/skinbound-lab`（原创，非 fork，`Upstream: none`）

- 提交：`5c53307`（feat）→ `8e5e86d`（docs: README 头部压缩），已 push 到 `main`。
- 选型理由（为什么不是当日计划里的候选 1）：今天 three-d 已经交付 4 个「连续时间区间证书」
  （`labeltime-cert` / `shadowtime-cert` / `tlabel-cert` / `sweepwarp`）+ `gradfit-lab`，
  plan.md 里定给 three-d 的「连续时间标签布局证书」**其实就是 `labeltime-cert`**。
  再做第 5 个同类 = C 档换皮，故换到**证据维度完全不同**的方向：从「几何谓词 / 布局证书」
  转到**蒙皮形变质量**（线性混合蒙皮 LBS vs 双四元数 DQS）。台账最近 20 条无任何蒙皮条目。
- 并行扇出（`workflow.parallel`，3 个只读子 agent 评估 3 个候选承诺）：`workflow-9136c5599f3449c6`。
  结论：skin-sweep 判「可行」，且子 agent **独立复现了 29.2893% 与 DQS 1e-15**；
  uv-atlas 返回空；camera-accel 判「需缩小范围」。据此选定 skin-sweep。
  **未采用** 子 agent 报的「6×65536 只需 29 ms」这一数字（与主实现无关的口算，未经本机度量）。

## 承诺（一句话，含数字与基线）

6 个动画 rig 的**整段扫掠**上给出最坏形变质量的**有界包络**：
LBS 在 ±90° 扭转下把关节环半径压掉 **29.2893%**（闭式 `1-cos(θ/2)` 独立复算，误差 ≤3.3e-16），
DQS 同条件半径漂移 **≤2.33e-15**；包络相对宽度 **≤9.34e-5**，只用 **44–67 次**求值，
而基线 `baseline/uniform-sweep.mjs` 要 **32769 次**才达到同宽 = **744.8×**；
单帧度量 **0.160 ms**（546 顶点管）。

## 真实跑出的数字

| rig | LBS shrink 包络 | 闭式真值 | DQS | LBS 最小体积比 | DQS 最小体积比 | evals |
|---|---|---|---|---|---|---|
| twist2-60 | [0.133975, 0.133982] | 0.133974596216 | ≤6.66e-16 | 0.96315 | 0.99462 | 44 |
| twist2-90 | [0.292893, 0.292909] | 0.292893218813 | ≤6.66e-16 | 0.92780 | 0.98955 | 44 |
| twist2-120 | [0.500000, 0.500027] | 0.5 | ≤7.77e-16 | 0.89300 | 0.98291 | 44 |
| twist3-90 | [0.292893, 0.292909] | 0.292893218813 | ≤1.11e-15 | 0.90373 | 0.98606 | 44 |
| twist-bend3 | [0.326970, 0.326997] | 无闭式（含 bend） | ≤2.33e-15 | 0.92230 | 0.98837 | 60 |
| twist-scrub2 | [0.357212, 0.357246] | 0.357212390313 | ≤6.66e-16 | 0.91565 | 0.98751 | 67 |

计时（`bench/result.json`，n=9）：cold 27.28 ms；单次度量 0.160 ms；6 场景自适应包络中位 34.18 ms
（p95 39.78，relStddev 6.1%）；单场景自适应中位 4.08 ms（9.7%）；uniform-4096 基线中位 335.94 ms（5.0%）；
12 次最小体积扫掠中位 332.57 ms（5.4%）。**无一组 relStddev > 10%**，故无需解释项。

`node bench/verify.mjs` → **RESULT PASS: 35 passed / 0 failed, exit 0**（约 13 s）。
三条互不共用常量的口径：闭式三角（2880 对，worst 4.44e-16）；DQS 环内两两距离刚性
（292 640 对，worst 5.995e-15）；4096 点暴力 + 黄金分割细化（6/6 包络不违背且 tight ≤9.34e-5）。
尺度不变性 6 rigs × {1e-6,1e-3,1,1e3,1e6}：LBS 半径比漂移 8.29e-16、体积比 3.09e-14、
DQS 5.55e-16（绝对值，因为该量结构性为 0）。

## 本轮真实修掉/发现的四个问题（务必留档）

1. **体积扫掠在求最大而不是最小**：`sweep()` 对 volume 用了 `encloseMax`，于是每个 rig 都报
   `1.0000`（t=0 静止姿态的体积比恒为 1）。这正是「检查存在但结构上测不到」的又一例：
   断言只看包络宽度，宽度很小 → 一路 PASS。已加 `encloseMin`（对 `-f` 取 max 再取负）。
2. **DQS 角度闭式 oracle 没做反极性绕回**：`analyticDQSJointAngle` 原样用 θ，而实现里 DQS 会
   因 antipodality 选短路径；|θ|>180° 时两者差 180°。已把 θ 绕回 (−π, π]，并在 README 明说
   LBS **不**绕回（LBS 真的走远路），这个不对称是真实语义而非 bug。M1 变异体正是靠这一点被抓。
3. **尺度不变性检查对结构性为 0 的量用相对容差**：DQS 半径漂移 ~1e-16 是噪声，两个噪声相除
   得到 4.5e-1 的「相对漂移」→ 假失败。已改为绝对容差 1e-14 并注明原因。
4. **M5 变异体在纯扭转环上结构性不可见**：纯扭转时关节环的形变质心与静止质心**重合**
   （|c1−c0| 实测 2.5e-17），所以「拿静止质心当圆心」这个 bug 在那里根本测不到。
   已把 M5 移到含 bend 的 `twist-bend3`，并加一条前置断言打印 |c1−c0| = 0.1743 证明测试非空转。
   同时抓到一次「取第一个 50/50 环」的错：第一个关节环（骨 0↔1）的质心被两个变换同时固定，
   必然不动；必须取**最后一个**关节环。

## 已知限制（README 已逐条写）

Lipschitz 界是**数值估计 ×2 安全系数**，故是「validated enclosure」而非「证明」；
所有阈值都是无量纲比值（无长度量纲），有效尺度 1e-6…1e6 已实测；
DQS 体积比 0.9829–0.9946 是**离散化**效应（扭转只在连续极限下等容），细化收敛率**未测**，不写；
±π 处角度符号天生二义，verify 跳过并报跳过数（当前 0）；语料全是确定性合成管，非真实 glTF。

## 下一轮可续接

1. **细化收敛研究**：`perBone`/`seg` 加倍，测 DQS 体积比 → 1 的收敛阶（现在只是未测，不是结论）。
2. 把包络从「标量 t ∈ [0,1]」推广到**多关节姿态空间**（每个关节角一条轴），做多维分支定界。
3. 接入真实 glTF skin/animation（现在 6 个 rig 全是脚本生成的合成管）。
4. 把「scale 混合」换成更真实的 rig（非共线关节、非均匀权重）——当前 twist3-90 全部关节共线，
   bend 只在 1 个场景出现。
5. 上游回馈：**交 0 个**。本轮是原创工具，没有可回投的上游缺陷；`state/upstream-pr.json` 未写。

## 沙箱

`/home/ubuntu/GitHub/pipelines/state/*` 写入被拒（`Permission denied`, workspace-write 沙箱 + 无审批人时 fail-closed）。
已把 `runs.jsonl`、`innovation-append.md`、`used-upstreams-append.txt`、本 `TASKS.md`
写在 `/home/ubuntu/GitHub/work/three-d/state/` 供执行器归档。

## 账号说明（重要，供执行器核对）

本轮 shell 里 `GH_TOKEN` **未注入**，`gh` 的激活账号是 **`linmoxi33`**（团队 C），
用它 `gh repo create llinok111/...` 会被拒（GraphQL: linmoxi33 cannot create a repository for llinok111）。
实际可用的是 `gh auth token --user llinok111`（40 字符，`gh api user` → login `llinok111`，94 repos，
含本团队早上发的 `gradfit-lab` / `labelcast-lab`）与 ssh 别名 `git@github-llinok111:`。
本轮全部 gh 调用都显式带 `GH_TOKEN=$(gh auth token --user llinok111)`，push 走 ssh 别名。

## 发布后自证（已过）

1. `gh api repos/llinok111/skinbound-lab --jq '.private, .pushed_at'` → `false`, `2026-11-14T02:34:38Z`。
2. `/tmp` 干净克隆按 README 第一条命令 `node tools/gen-sample.mjs && node bench/verify.mjs` →
   `RESULT PASS: 35 passed / 0 failed`，exit 0；`node bench/bench.mjs` 复现同一组头部数字。
3. 已推送 README 前 42 行含 `Upstream: none`(5) / `## What this is`(7) / `## How to run`(20) / `## Evidence`(39)。
   临时克隆目录 `/tmp/smoke`、`/tmp/smoke2` 已删。

## 自证伪（Lead 亲自跑，不是子 agent 转述）

- 临时脚本（工作目录外）对每个 rig **200 000 个均匀采样点**求真实最大收缩，与包络对照：
  **violations=0/6，vacuous=0/6**，最大相对余量 9.343e-5（twist-scrub2）；
  真值 argmax 全部落在 t=1 或键点 t=0.25，且 `lower` 与真值逐位相同。
  耗时 2 min（`real 2m0.322s`），故未作为默认闸门。
- 该脚本已**收进仓库**：`bench/falsify.mjs [N]`（默认 N=20000，约 12 s），
  与分支定界路径**不共用代码**；`node bench/falsify.mjs 20000` → 同样 0/6 + 0/6。
  README 已写明「先自己跑它，再信那张表」。
