import { Vector3, Quaternion, Matrix4, Euler } from 'three';
import { INTRO_REST_POSE, copyPose } from '../shared/story-space.js';

export const SPACE = Object.freeze({
  // 88倍叙事展示使真实孔的半净空=.38984m，容纳T2最大.32m横向偏移。
  portalZ: -22, portalY: 2.8, portalScale: 88,
  courtZ: -32.2, teamZ: -48, portraitAspect: 500 / 421.05,
});
const up = new Vector3(0, 1, 0), matrix = new Matrix4();
const flight = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0));
const frames = [
  { p: 0, pose: INTRO_REST_POSE },
  { p: .10, camera: [.5, 3.2, 6], target: [0, 2.8, -22], shuttle: [.8, 2.6, -7], scale: 14 },
  // 近孔时保持约3.2m前导，避免真实T2横移把近在镜前的球推出手机画幅。
  { p: .20, camera: [0, 2.8, -18], target: [0, 2.8, -26], shuttle: [0, 2.8, -21.2], scale: 3 },
  { p: .24, camera: [0, 2.8, -21.3], target: [0, 2.8, -26], shuttle: [0, 2.8, -24.5], scale: 3 },
  { p: .28, camera: [0, 2.8, -22.4], target: [0, 2.8, -26], shuttle: [0, 2.8, -25.6], scale: 3 },
  { p: .36, camera: [0, 3.2, -24], target: [.9, 3.6, -27], shuttle: [.9, 3.6, -27], scale: 10 },
  { p: .50, camera: [3.8, 4.8, -26.4], target: [-.7, 2.6, -32], shuttle: [-.7, 2.6, -32], scale: 13 },
  { p: .75, camera: [1.1, 3.1, -39], target: [0, 2.2, -47], shuttle: [2.5, 2.1, -44], scale: 10 },
  { p: .90, camera: [.2, 2.6, -41], target: [0, 2.4, -48], shuttle: [3.8, 1.6, -46], scale: 5 },
  { p: 1, camera: [0, 2.35, -41], target: [0, 2.35, -48], shuttle: [4.2, 1.5, -47], scale: 4 },
].map(frame => {
  if (frame.pose) return frame;
  const position = new Vector3(...frame.camera), target = new Vector3(...frame.target);
  return { p: frame.p, pose: {
    camera: { position, quaternion: new Quaternion().setFromRotationMatrix(matrix.lookAt(position, target, up)), fov: 42 },
    shuttle: { position: new Vector3(...frame.shuttle), quaternion: flight.clone(), scale: frame.scale },
  } };
});

export const PATH_BREAKS = Object.freeze(frames.map(frame => frame.p));

export function sampleJourneyPose(progress, out, reducedMotion = false) {
  let p = Math.max(0, Math.min(1, progress));
  if (reducedMotion) p = p < .12 ? 0 : p < .375 ? .20 : p < .625 ? .5 : p < .875 ? .75 : 1;
  if (p === 0) return copyPose(INTRO_REST_POSE, out);
  let index = 0;
  while (index < frames.length - 2 && p > frames[index + 1].p) index++;
  const a = frames[index], b = frames[index + 1];
  const fraction = (p - a.p) / (b.p - a.p);
  const t = fraction * fraction * (3 - 2 * fraction);
  out.camera.position.lerpVectors(a.pose.camera.position, b.pose.camera.position, t);
  out.camera.quaternion.slerpQuaternions(a.pose.camera.quaternion, b.pose.camera.quaternion, t);
  out.camera.fov = a.pose.camera.fov + (b.pose.camera.fov - a.pose.camera.fov) * t;
  out.shuttle.position.lerpVectors(a.pose.shuttle.position, b.pose.shuttle.position, t);
  out.shuttle.quaternion.slerpQuaternions(a.pose.shuttle.quaternion, b.pose.shuttle.quaternion, t);
  out.shuttle.scale = a.pose.shuttle.scale + (b.pose.shuttle.scale - a.pose.shuttle.scale) * t;
  // 球场展开段持续跟随同一羽球；只插值两端朝向会在侧移中途再次丢失主体。
  if (p >= .28 && p <= .5) out.camera.quaternion.setFromRotationMatrix(matrix.lookAt(out.camera.position, out.shuttle.position, up));
  return out;
}
