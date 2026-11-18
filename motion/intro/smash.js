import { Matrix4, Quaternion, Vector3 } from 'three';
import { INTRO_REST_POSE, copyPose } from '../shared/story-space.js';

export const SMASH = Object.freeze({ scale: 8, impact: .64, exit: .78, reset: .84, brandStart: .86, brandReady: 1.25 });
const keys = [
  [0, 12, 0], [.12, 11, -20], [.38, 6, -25], [.52, 2.4, -25],
  [.62, .55, -15], [.68, -.1, -10], [.78, -1.9, -22],
];
export const smoothRange = (a, b, value) => {
  const x = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
export function flightDepth(time) {
  const t = Math.max(0, time);
  if (t >= .78) return -1.9 - 22 * (t - .78);
  let index = 0;
  while (index < keys.length - 2 && t > keys[index + 1][0]) index++;
  const [a, da, va] = keys[index], [b, db, vb] = keys[index + 1];
  const span = b - a, u = (t - a) / span, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * da + (u3 - 2 * u2 + u) * span * va
    + (-2 * u3 + 3 * u2) * db + (u3 - u2) * span * vb;
}

export function openingPresentation(time) {
  const pressure = smoothRange(.06, .42, time) * (1 - smoothRange(.7, .78, time));
  const impact = time >= .605 && time <= .675 ? Math.sin(Math.PI * (time - .605) / .07) ** 2 : 0;
  const brand = smoothRange(SMASH.brandStart, SMASH.brandReady, time);
  return {
    ball: time < SMASH.exit ? 1 : 0,
    trail: smoothRange(.12, .40, time) * (1 - smoothRange(.74, 1.0, time)),
    impact,
    brand,
    reveal: brand,
    sheen: time >= .86 && time < 1.25 ? Math.sin(Math.PI * (time - .86) / .39) : 0,
    bend: pressure * .032,
    flutter: pressure * Math.sin(time * 27) * .004,
  };
}

export function journeyPresentation(progress) {
  const s = progress.index === 0 ? progress.segment : 1;
  return { ball: smoothRange(.04, .32, s), trail: 0, impact: 0,
    brand: 1 - smoothRange(0, .45, s), reveal: 1, sheen: 0,
    bend: .004 * smoothRange(.04, .32, s), flutter: 0 };
}

export function createSmashTrajectory() {
  const tangent = Math.tan(INTRO_REST_POSE.camera.fov * Math.PI / 360);
  // 无resize时的明确参考是1440×900、FOV42；真实场景始终由story传投影快照。
  const projection = new Matrix4().makePerspective(-tangent * 1440 / 900, tangent * 1440 / 900, tangent, -tangent, 1, 100);
  const inverse = projection.clone().invert();
  let width = 1440, height = 900;
  const local = new Vector3(), velocity = new Vector3(), previous = new Vector3(), next = new Vector3();
  const headAxis = new Vector3(0, -1, 0), xAxis = new Vector3(1, 0, 0), kick = new Quaternion();

  function point(time, out) {
    const d = flightDepth(time), steer = smoothRange(0, .52, time);
    const x = .10 * (1 - steer), y = .50 - .32 * steer;
    out.set(x, y, -1).applyMatrix4(inverse).multiplyScalar(1 / -out.z);
    out.multiplyScalar(d); out.x += .015; out.y -= .19;
    return out.applyQuaternion(INTRO_REST_POSE.camera.quaternion).add(INTRO_REST_POSE.camera.position);
  }
  return {
    resize(snapshot) {
      width = snapshot.width; height = snapshot.height;
      projection.fromArray(snapshot.projectionMatrix); inverse.copy(projection).invert();
    },
    point,
    sample(time, out) {
      copyPose(INTRO_REST_POSE, out);
      if (time >= SMASH.reset) return out;
      point(time, out.shuttle.position);
      point(Math.max(0, time - .001), previous); point(time + .001, next);
      velocity.subVectors(next, previous).normalize();
      out.shuttle.quaternion.setFromUnitVectors(headAxis, velocity);
      out.shuttle.scale = SMASH.scale;
      if (time >= .58 && time <= .70) {
        const angle = 6 / (height * projection.elements[5]) * Math.sin(Math.PI * (time - .58) / .12);
        out.camera.quaternion.multiply(kick.setFromAxisAngle(xAxis, angle));
      }
      return out;
    },
    pixelScale(depth) { return 2 * depth / (height * Math.abs(projection.elements[5])); },
    screenPoint(x, y, depth, out = local) {
      out.set(x, y, -1).applyMatrix4(inverse).multiplyScalar(depth / -out.z);
      return out.applyQuaternion(INTRO_REST_POSE.camera.quaternion).add(INTRO_REST_POSE.camera.position);
    },
    inspect: () => ({ width, height, projection: projection.toArray() }),
  };
}
