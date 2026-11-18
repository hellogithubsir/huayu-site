import { Vector2, Vector3, Quaternion, Matrix4, Euler } from 'three';

export function createPose() {
  return {
    camera: { position: new Vector3(), quaternion: new Quaternion(), fov: 42 },
    shuttle: { position: new Vector3(), quaternion: new Quaternion(), scale: 46 },
  };
}

export function copyPose(from, to) {
  to.camera.position.copy(from.camera.position);
  to.camera.quaternion.copy(from.camera.quaternion);
  to.camera.fov = from.camera.fov;
  to.shuttle.position.copy(from.shuttle.position);
  to.shuttle.quaternion.copy(from.shuttle.quaternion);
  to.shuttle.scale = from.shuttle.scale;
  return to;
}

export const INTRO_REST_POSE = createPose();
INTRO_REST_POSE.camera.position.set(0, 3.4, 12);
INTRO_REST_POSE.camera.quaternion.setFromRotationMatrix(
  new Matrix4().lookAt(INTRO_REST_POSE.camera.position, new Vector3(0, 2.25, 0), new Vector3(0, 1, 0)),
);
INTRO_REST_POSE.shuttle.position.set(1.3, 1.3, 0);
INTRO_REST_POSE.shuttle.quaternion.setFromEuler(new Euler(.32, -.34, -.64));

export function createOffset() {
  return {
    cameraPosition: new Vector3(), cameraQuaternion: new Quaternion(),
    shuttleQuaternion: new Quaternion(), nearParallax: new Vector2(),
    farParallax: new Vector2(), flow: new Vector2(), light: new Vector2(),
  };
}

export function resetOffset(offset) {
  offset.cameraPosition.set(0, 0, 0);
  offset.cameraQuaternion.identity();
  offset.shuttleQuaternion.identity();
  for (const key of ['nearParallax', 'farParallax', 'flow', 'light']) offset[key].set(0, 0);
  return offset;
}

export function composeStoryPose(base, offset, out) {
  copyPose(base, out);
  out.camera.position.copy(offset.cameraPosition).applyQuaternion(base.camera.quaternion).add(base.camera.position);
  out.camera.quaternion.multiply(offset.cameraQuaternion);
  out.shuttle.quaternion.multiply(offset.shuttleQuaternion);
  return out;
}

export function makeResidual(current, target) {
  return {
    cameraPosition: current.camera.position.clone().sub(target.camera.position),
    cameraQuaternion: target.camera.quaternion.clone().invert().multiply(current.camera.quaternion),
    fov: current.camera.fov - target.camera.fov,
    shuttlePosition: current.shuttle.position.clone().sub(target.shuttle.position),
    shuttleQuaternion: target.shuttle.quaternion.clone().invert().multiply(current.shuttle.quaternion),
    scale: current.shuttle.scale - target.shuttle.scale,
  };
}

const residualRotation = new Quaternion();
export function applyResidual(target, residual, weight, out) {
  copyPose(target, out);
  out.camera.position.addScaledVector(residual.cameraPosition, weight);
  residualRotation.identity().slerp(residual.cameraQuaternion, weight);
  out.camera.quaternion.multiply(residualRotation);
  out.camera.fov += residual.fov * weight;
  out.shuttle.position.addScaledVector(residual.shuttlePosition, weight);
  residualRotation.identity().slerp(residual.shuttleQuaternion, weight);
  out.shuttle.quaternion.multiply(residualRotation);
  out.shuttle.scale += residual.scale * weight;
  return out;
}
