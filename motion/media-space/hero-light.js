import { DataTexture, RGBAFormat, FloatType, EquirectangularReflectionMapping, LinearSRGBColorSpace } from 'three';

// 离线式软箱图只生成一次，由现有renderer预滤；不新增WebGL上下文。
export function createHeroEnvironment() {
  const width = 512, height = 256, data = new Float32Array(width * height * 4);
  const boxes = [
    { u: .19, v: .45, w: .025, h: .20, color: [4.8, 4.6, 4.5] },
    { u: .68, v: .42, w: .045, h: .23, color: [2.7, 3.1, 4.6] },
    { u: .96, v: .48, w: .025, h: .19, color: [2.9, 1.7, 4.2] },
    { u: .45, v: .20, w: .17, h: .035, color: [2.0, 1.8, 1.4] },
  ];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, i = (y * width + x) * 4;
    data[i] = .025; data[i + 1] = .022; data[i + 2] = .04; data[i + 3] = 1;
    for (const box of boxes) {
      const dx = Math.min(Math.abs(u - box.u), 1 - Math.abs(u - box.u)) / box.w;
      const dy = (v - box.v) / box.h;
      const strength = Math.exp(-Math.pow(dx, 4) - Math.pow(dy, 4));
      for (let c = 0; c < 3; c++) data[i + c] += box.color[c] * strength;
    }
  }
  const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
