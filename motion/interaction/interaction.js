import { Euler, Vector2 } from 'three';
import { resetOffset } from '../shared/story-space.js';

// 所有值是局部偏移；基础镜头始终由 shared/story.js 组合、写入。
export const INTERACTION_TUNING = Object.freeze({
  response: 10,
  returnResponse: 7,
  touchTravel: 180,
  cameraX: .32, cameraY: .18,
  cameraYaw: -.024, cameraPitch: .014,
  shuttleYaw: .34, shuttlePitch: -.18, shuttleRoll: -.055,
  nearGain: 1.5, farGain: .38,
  flowX: 1.65, flowY: .9,
  lightX: 2.6, lightY: 1.7,
});

export function createInteraction() {
  const position = new Vector2();
  const rotation = new Euler(0, 0, 0, 'YXZ');
  let disposed = false;
  const reset = () => position.set(0, 0);

  return {
    sample({ dt, raw, active, reducedMotion }, out) {
      resetOffset(out);
      if (disposed || !active || reducedMotion) { reset(); return out; }

      const touch = raw.pointerType === 'touch';
      const engaged = raw.inside && (!touch || raw.dragging);
      const x = engaged ? (touch ? Math.max(-1, Math.min(1, raw.dx / INTERACTION_TUNING.touchTravel)) : raw.x) : 0;
      const y = engaged && !touch ? raw.y : 0;
      const response = engaged ? INTERACTION_TUNING.response : INTERACTION_TUNING.returnResponse;
      const alpha = 1 - Math.exp(-response * dt);
      position.x += (x - position.x) * alpha;
      position.y += (y - position.y) * alpha;
      // 尾段到精确目标，避免残余浮点偏移；没有计时器或自有动画循环。
      if (Math.abs(x - position.x) < .00001) position.x = x;
      if (Math.abs(y - position.y) < .00001) position.y = y;

      const px = position.x, py = position.y, t = INTERACTION_TUNING;
      out.cameraPosition.set(px * t.cameraX, py * t.cameraY, 0);
      out.cameraQuaternion.setFromEuler(rotation.set(py * t.cameraPitch, px * t.cameraYaw, 0));
      out.shuttleQuaternion.setFromEuler(rotation.set(py * t.shuttlePitch, px * t.shuttleYaw, px * t.shuttleRoll));
      out.nearParallax.set(px * t.nearGain, py * t.nearGain);
      out.farParallax.set(px * t.farGain, py * t.farGain);
      out.flow.set(px * t.flowX, py * t.flowY);
      out.light.set(px * t.lightX, py * t.lightY);
      return out;
    },
    reset,
    dispose() { disposed = true; reset(); },
  };
}
