const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
export const wrap = (value, count) => ((value % count) + count) % count;

export function scrollProgress(scrollY, trackTop, trackHeight, viewHeight) {
  const distance = trackHeight - viewHeight;
  return distance > 0 ? clamp((scrollY - trackTop) / distance, 0, 1) : 0;
}

// 原生滚动是唯一时间轴；按钮和键盘通过改变页面滚动位置选片。
export function createFilmNavigation(count) {
  let phase = 0, target = 0;
  return {
    setProgress(progress) { target = clamp(progress, 0, 1) * (count - 1); },
    update(dt, reducedMotion) {
      phase = reducedMotion ? target : phase + (target - phase) * (1 - Math.exp(-dt * 12));
      if (Math.abs(target - phase) < .0002) phase = target;
      return phase !== target;
    },
    read: () => ({ phase, target, selected: clamp(Math.round(phase), 0, count - 1) }),
  };
}

// 螺旋在背面淡出后回接，同一滚动位置始终得到相同空间关系。
export function filmPose(index, phase, count) {
  const signedDistance = wrap(index - phase + count / 2, count) - count / 2;
  const distance = Math.abs(signedDistance);
  const angle = Math.PI / 6 + signedDistance * Math.PI * 2 / count;
  const seam = clamp((count / 2 - distance) / .38, 0, 1);
  return {
    x: Math.sin(angle), y: -signedDistance, z: Math.cos(angle),
    rotationY: -.12 - signedDistance * .28,
    rotationZ: -signedDistance * .035,
    scale: Math.max(.42, 1 - distance * .42),
    opacity: seam * Math.max(.2, 1 - distance * .38),
    distance,
  };
}

// 同一世界构图随舞台宽高连续取景，不以设备断点替换场景。
export function mediaFraming(width, height, racketAspect) {
  const spanY = 32 * Math.tan(22 * Math.PI / 180), spanX = spanY * width / height;
  const scale = Math.min(spanY * 1.8, spanX * .89 / (racketAspect + .42 * Math.sin(Math.PI / 60)));
  const sweptRadius = scale * Math.hypot(racketAspect / 2, .024);
  const radiusX = Math.max(spanX * .31, sweptRadius + spanX * .13 + .55);
  const radiusZ = (sweptRadius + .7) / Math.cos(Math.PI / 6);
  return {
    spanY, spanX, scale, sweptRadius, radiusX, radiusZ, tilt: 0,
    frontSpanY: 2 * (16 - radiusZ * Math.cos(Math.PI / 6)) * Math.tan(22 * Math.PI / 180),
  };
}
