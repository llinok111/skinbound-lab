/*
 * skinbound-lab — scenario catalogue.
 * Pure data + pure functions; no IO, no DOM, no three.js.
 */
import { makeRig, buildTube, poseAt, DEG, RAD } from "./core.mjs";

const P = (twist, bend) => ({ twist, bend });

/**
 * Six deterministic rigs. `pureTwist` scenarios (all bends zero) admit a
 * closed-form oracle: a ring whose child-bone weight is w and whose local
 * twist is theta shrinks its radius by exactly
 *     1 - sqrt((1-w)^2 + w^2 + 2 w (1-w) cos theta).
 */
export function buildScenarios() {
  const defs = [
    {
      id: "twist2-60", bones: 2, L: 1, radius: 0.35, perBone: 9, seg: 32, blend: 0.25,
      pureTwist: true,
      keys: [
        { t: 0, pose: P([0, 0], [0, 0]) },
        { t: 1, pose: P([0, 60], [0, 0]) },
      ],
    },
    {
      id: "twist2-90", bones: 2, L: 1, radius: 0.35, perBone: 9, seg: 32, blend: 0.25,
      pureTwist: true,
      keys: [
        { t: 0, pose: P([0, 0], [0, 0]) },
        { t: 1, pose: P([0, 90], [0, 0]) },
      ],
    },
    {
      id: "twist2-120", bones: 2, L: 1, radius: 0.35, perBone: 9, seg: 32, blend: 0.25,
      pureTwist: true,
      keys: [
        { t: 0, pose: P([0, 0], [0, 0]) },
        { t: 1, pose: P([0, 120], [0, 0]) },
      ],
    },
    {
      id: "twist3-90", bones: 3, L: 1, radius: 0.35, perBone: 9, seg: 32, blend: 0.25,
      pureTwist: true,
      keys: [
        { t: 0, pose: P([0, 0, 0], [0, 0, 0]) },
        { t: 1, pose: P([0, 90, 90], [0, 0, 0]) },
      ],
    },
    {
      id: "twist-bend3", bones: 3, L: 1, radius: 0.35, perBone: 9, seg: 32, blend: 0.25,
      pureTwist: false,
      keys: [
        { t: 0, pose: P([0, 0, 0], [0, 0, 0]) },
        { t: 0.5, pose: P([0, 70, 40], [0, 25, -15]) },
        { t: 1, pose: P([0, 95, 60], [0, 10, 20]) },
      ],
    },
    {
      id: "twist-scrub2", bones: 2, L: 1, radius: 0.35, perBone: 9, seg: 32, blend: 0.25,
      pureTwist: true,
      keys: [
        { t: 0, pose: P([0, 10], [0, 0]) },
        { t: 0.25, pose: P([0, 100], [0, 0]) },
        { t: 0.6, pose: P([0, 20], [0, 0]) },
        { t: 1, pose: P([0, 88], [0, 0]) },
      ],
    },
  ];
  return defs.map((d) => {
    const rig = makeRig({ bones: d.bones, L: d.L });
    const mesh = buildTube(rig, { radius: d.radius, perBone: d.perBone, seg: d.seg, blend: d.blend });
    // closed-form worst-case LBS shrink over the whole sweep (pure twist only)
    let analyticMaxShrink = null;
    if (d.pureTwist) {
      let thetaMax = 0;
      for (let k = 1; k < d.bones; k++) {
        for (const key of d.keys) thetaMax = Math.max(thetaMax, Math.abs(key.pose.twist[k] ?? 0));
      }
      analyticMaxShrink = 1 - Math.cos((thetaMax * DEG) / 2);
    }
    return { ...d, rig, mesh, analyticMaxShrink };
  });
}

/** the relative twist angle (deg) applied at each interior joint at time t */
export function localTwists(scn, t) {
  const pose = poseAt(scn, t);
  const out = [];
  for (let k = 1; k < scn.rig.bones; k++) out.push(pose.twist[k] ?? 0);
  return out;
}

export function thetaMaxOf(scn) {
  let tm = 0;
  for (let k = 1; k < scn.rig.bones; k++) {
    for (const key of scn.keys) tm = Math.max(tm, Math.abs(key.pose.twist[k] ?? 0));
  }
  return tm;
}

export const fmtDeg = (rad) => rad * RAD;
