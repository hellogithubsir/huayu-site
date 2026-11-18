import { Vector3, Vector4 } from 'three';

// 只计算本组物体相对DOM舞台的位移；不读写共享相机或其私有投影。
export function measureTeamLayout(stage, section, host, screen, cameraPose, stageCenter, out) {
  const top = Math.max(0, stage.top, host.top);
  const bottom = Math.min(screen.height, stage.bottom, host.bottom);
  const left = Math.max(0, stage.left, host.left);
  const right = Math.min(screen.width, stage.right, host.right);
  out.clip.set(left, top, right, bottom);
  out.visible = bottom > top && right > left;
  // sticky宿主到track末尾也会上移；扣掉它已承担的位移，防止双重滚动。
  out.scrollPixels = Math.max(0, host.top - section.top);
  out.forward.set(0, 0, -1).applyQuaternion(cameraPose.quaternion);
  out.distance.copy(stageCenter).sub(cameraPose.position);
  const depth = out.distance.dot(out.forward);
  out.unitsPerPixel = 2 * depth * Math.tan(cameraPose.fov * Math.PI / 360) / host.height;
  out.translation.set(0, 1, 0).applyQuaternion(cameraPose.quaternion)
    .multiplyScalar(out.scrollPixels * out.unitsPerPixel);
  return out;
}

export function createTeamLayout() {
  return { clip: new Vector4(), translation: new Vector3(), forward: new Vector3(), distance: new Vector3(),
    position: new Vector3(), logoPosition: new Vector3(), ray: new Vector3(), target: new Vector3(),
    scale: 1, logoScale: 1, scrollPixels: 0, unitsPerPixel: 0, visible: false };
}

// 人物纹理本身保留500/421.05取景；按原DOM人物容器尺寸放置整张平面，不能只裁巨大的脸。
export function fitTeamStage(stage, host, portrait, cameraPose, stageZ, out) {
  const tangent = Math.tan(cameraPose.fov * Math.PI / 360);
  const depth = cameraPose.position.z - stageZ;
  const units = 2 * depth * tangent / host.height;
  out.scale = portrait.height * units / 5.1;
  function atPixel(x, y, z, target) {
    out.ray.set((x - host.left - host.width / 2) * 2 * tangent / host.height,
      (host.top + host.height / 2 - y) * 2 * tangent / host.height, -1).applyQuaternion(cameraPose.quaternion);
    return target.copy(cameraPose.position).addScaledVector(out.ray, (z - cameraPose.position.z) / out.ray.z);
  }
  atPixel(stage.left + stage.width / 2, stage.top + portrait.top + portrait.height / 2, stageZ, out.position);
  out.position.y -= 2.35 * out.scale;
  const logoWidth = stage.width * .96, logoHeight = logoWidth * 270 / 1700;
  const logoZ = stageZ - 2.3 * out.scale;
  const logoUnits = 2 * (cameraPose.position.z - logoZ) * tangent / host.height;
  out.logoScale = logoWidth * logoUnits / (12 * out.scale);
  atPixel(stage.left + stage.width / 2, stage.top + logoHeight / 2, logoZ, out.target);
  out.logoPosition.copy(out.target).sub(out.position).multiplyScalar(1 / out.scale);
  return out;
}

// 共用画布不能按人物窗口scissor；仅裁本组材质，球场与T1主体不受影响。
export function clipTeamMaterial(material, uniforms) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.teamStageRect = uniforms.rect;
    shader.uniforms.teamScreenHeight = uniforms.height;
    shader.uniforms.teamPixelRatio = uniforms.dpr;
    shader.fragmentShader = `uniform vec4 teamStageRect;
uniform float teamScreenHeight;
uniform float teamPixelRatio;
${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
vec2 teamPixel = vec2(gl_FragCoord.x / teamPixelRatio, teamScreenHeight - gl_FragCoord.y / teamPixelRatio);
if (teamPixel.x < teamStageRect.x || teamPixel.y < teamStageRect.y || teamPixel.x > teamStageRect.z || teamPixel.y > teamStageRect.w) discard;`);
  };
  material.customProgramCacheKey = () => 'T3-team-stage-clip-1';
  material.needsUpdate = true;
}
