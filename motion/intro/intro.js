import { Group, Mesh, BufferGeometry, Float32BufferAttribute, LineSegments, LineBasicMaterial,
  AmbientLight, DirectionalLight, PointLight, Vector3, Matrix4, Box3,
  ShaderMaterial, DoubleSide, AdditiveBlending } from 'three';
import { loadModel } from '../shared/assets.js?v=entry-first-20261112';
import { disposeTree } from '../shared/dispose.js';
import { SMASH, createSmashTrajectory, openingPresentation, journeyPresentation, smoothRange } from './smash.js';

const MODEL = new URL('./assets/huayu-shuttle.meshopt.glb', import.meta.url);
const brandProperties = ['--brand-alpha', '--brand-cut', '--brand-sheen', '--brand-sweep-x'];

function ribbon(material, segments = 16) {
  const geometry = new BufferGeometry(), positions = new Float32Array((segments + 1) * 6), uv = [], indices = [];
  for (let i = 0; i <= segments; i++) {
    uv.push(i / segments, 0, i / segments, 1);
    if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2)); geometry.setIndex(indices);
  const mesh = new Mesh(geometry, material); mesh.frustumCulled = false; return mesh;
}
function effectMaterial(color) {
  return new ShaderMaterial({
    uniforms: { opacity: { value: 0 }, flow: { value: 0 }, light: { value: 0 }, tint: { value: color } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: [
      'varying vec2 vUv; uniform float opacity; uniform float flow; uniform float light; uniform vec3 tint;',
      'void main(){ float edge=pow(sin(vUv.y*3.14159),2.); float ends=smoothstep(0.,.08,vUv.x)*(1.-smoothstep(.88,1.,vUv.x));',
      'float line=1.-vUv.x*.65;',
      'vec3 color=tint*(1.+.25*light);gl_FragColor=vec4(color,opacity*edge*ends*line);}',
    ].join('\n'),
    transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, blending: AdditiveBlending,
  });
}

export function createIntro({ root, invalidate, brandElement = null }) {
  const owned = new Group(); owned.name = 'intro_environment'; root.add(owned);
  const shuttle = new Group(); shuttle.name = 'shuttle_root'; root.add(shuttle);
  const near = new Group(), far = new Group(); near.matrixAutoUpdate = false; far.matrixAutoUpdate = false; owned.add(near, far);
  const trajectory = createSmashTrajectory();
  const meshes = [], feathers = [], materials = new Set(), trails = [], farLines = [];
  const backdrop = new Group(); backdrop.name = 'brand_racket_backdrop'; near.add(backdrop);
  const backdropMaterials = new Set(), backdropSize = new Vector3();
  const backdropFade = { value: new Vector3() }, backdropDpr = { value: 1 };
  const backdropLayout = { ready: false, visible: false, weight: 0, opacity: 0, width: 0, height: 0, top: 0, fadeStart: 0, fadeEnd: 0, meshNames: [] };
  let brandLayout = null;
  const view = new Matrix4(), projection = new Matrix4(), inverseView = new Matrix4(), inverseProjection = new Matrix4();
  const meshView = new Matrix4(), scratchBox = new Box3(), fullBounds = new Box3(), headBounds = new Box3();
  const capturedViewRoot = new Matrix4(), inverseRoot = new Matrix4(), translation = new Matrix4();
  const point = new Vector3(), right = new Vector3(), up = new Vector3(), corner = new Vector3(), ndc = new Vector3();
  const alpha = { opening: { value: 1 }, journey: { value: 0 }, exitEnabled: { value: 0 }, frontier: { value: .02 },
    exitTransform: { value: new Matrix4() }, pixelHeight: { value: 900 } };
  const originalBrandStyles = new Map(brandProperties.map(name => [name, brandElement?.style.getPropertyValue(name) || '']));
  let loaded = false, disposed = false, width = 1440, height = 900;
  let loading = null, backdropLoading = null;
  let lastBehind = false, capturedFarDepth = .02, capturedHeadZ = 0, lastBrand = '', currentPresentation = null;
  const flash = new PointLight(0xcab2ff, 0, 12, 2); owned.add(flash);
  const key = new DirectionalLight(0xfff0df, 3.4); key.position.set(-4, 7, 5);
  const rim = new DirectionalLight(0x8646ef, 3.5); rim.position.set(6, 3, -4);
  owned.add(key, rim, new AmbientLight(0xb5bad4, 1.0));
  const violet = new Vector3(.46, .16, .95), white = new Vector3(.88, .80, 1);

  function writeBrand(presentation) {
    if (!brandElement) return;
    const values = [presentation.brand.toFixed(5), (100 * (1 - presentation.reveal)).toFixed(4) + '%',
      presentation.sheen.toFixed(5), (150 - 300 * presentation.reveal).toFixed(3) + '%'];
    const signature = values.join('|');
    if (signature === lastBrand) return;
    lastBrand = signature; brandProperties.forEach((name, index) => brandElement.style.setProperty(name, values[index]));
  }
  writeBrand(openingPresentation(0));

  function buildEffects() {
    for (let i = 0; i < 4; i++) { const mesh = ribbon(effectMaterial(i === 1 ? white : violet)); owned.add(mesh); trails.push(mesh); }
    for (const side of [-1, 1]) {
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(8 * 6), 3));
      const material = new LineBasicMaterial({ color: side < 0 ? 0x77509e : 0x76415d, transparent: true, opacity: .15 });
      const lines = new LineSegments(geometry, material); lines.frustumCulled = false; lines.userData.side = side; far.add(lines); farLines.push(lines);
    }
  }

  function buildBackdrop(model) {
    const content = new Group(), variants = new Map();
    model.scene.updateWorldMatrix(true, true);
    const rootInverse = model.scene.matrixWorld.clone().invert();
    for (const name of ['frame', 'strings']) {
      const original = model.scene.getObjectByName(name);
      if (!original) throw new Error(`紫电首屏背景缺少${name}节点`);
      const copy = original.clone(true);
      copy.matrix.copy(rootInverse).multiply(original.matrixWorld);
      copy.matrix.decompose(copy.position, copy.quaternion, copy.scale);
      copy.traverse(node => {
        if (!node.isMesh) return;
        backdropLayout.meshNames.push(node.name);
        const cloneMaterial = source => {
          const key = source.uuid + ':' + name;
          if (variants.has(key)) return variants.get(key);
          const material = source.clone();
          material.transparent = true; material.depthWrite = false; material.forceSinglePass = true; material.fog = false;
          material.userData.brandOpacity = name === 'strings' ? .07 : .26;
          material.opacity = 0;
          material.onBeforeCompile = shader => {
            shader.uniforms.huayuBackdropFade = backdropFade; shader.uniforms.huayuBackdropDpr = backdropDpr;
            shader.fragmentShader = 'uniform vec3 huayuBackdropFade; uniform float huayuBackdropDpr;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', [
              'float huayuScreenY = huayuBackdropFade.z - gl_FragCoord.y / huayuBackdropDpr;',
              'diffuseColor.a *= 1. - smoothstep(huayuBackdropFade.x, huayuBackdropFade.y, huayuScreenY);',
              'if (diffuseColor.a < .001) discard;',
              '#include <alphatest_fragment>',
            ].join('\n'));
          };
          material.customProgramCacheKey = () => 'huayu-brand-backdrop-1';
          variants.set(key, material); backdropMaterials.add(material); return material;
        };
        node.material = Array.isArray(node.material) ? node.material.map(cloneMaterial) : cloneMaterial(node.material);
        node.renderOrder = -10;
      });
      content.add(copy);
    }
    const box = new Box3().setFromObject(content), center = box.getCenter(new Vector3());
    box.getSize(backdropSize);
    content.position.copy(center).negate(); backdrop.add(content);
    backdropLayout.ready = true;
  }

  function measureBrand() {
    const rect = brandElement?.getBoundingClientRect();
    const documentY = globalThis.scrollY || 0;
    const host = brandElement?.closest?.('[data-story-track]')?.querySelector?.('.story-host')?.getBoundingClientRect();
    const heading = brandElement?.closest?.('section')?.querySelector?.('h1')?.getBoundingClientRect();
    const brandWidth = rect?.width || Math.min(width * .84, 700);
    const brandHeight = rect?.height || brandWidth * 210 / 850;
    const top = rect?.top ?? height * .29 - brandHeight / 2;
    brandLayout = { centerX: rect ? rect.left - (host?.left || 0) + brandWidth / 2 : width / 2,
      top: top + documentY, bottom: top + brandHeight + documentY, width: brandWidth, height: brandHeight,
      heading: (heading?.top ?? height * (width < 768 ? .53 : .48)) + documentY };
  }

  function updateBackdrop(frame, visible) {
    if (!backdropLayout.ready) return;
    if (!brandLayout) measureBrand();
    const documentY = globalThis.scrollY || 0;
    const targetWidth = Math.min(width * .96, brandLayout.width * 1.18);
    const targetHeight = targetWidth * backdropSize.y / backdropSize.x;
    const top = brandLayout.top - documentY - targetWidth * .28;
    const centerY = top + targetHeight / 2, depth = 8;
    const unitsPerPixel = 2 * depth / (height * Math.abs(projection.elements[5]));
    backdrop.position.copy(cameraPoint(brandLayout.centerX / width * 2 - 1, 1 - centerY / height * 2, depth));
    backdrop.scale.setScalar(targetWidth * unitsPerPixel / backdropSize.x);
    const fadeEnd = brandLayout.heading - documentY - 16;
    const fadeStart = Math.min(brandLayout.bottom - documentY - brandLayout.height * .1, fadeEnd - 64);
    backdropFade.value.set(fadeStart, fadeEnd, frame.viewport.height); backdropDpr.value = frame.viewport.dpr;
    backdrop.visible = visible > .001;
    for (const material of backdropMaterials) material.opacity = visible * material.userData.brandOpacity;
    Object.assign(backdropLayout, { visible: backdrop.visible, weight: visible, opacity: .26 * visible,
      width: targetWidth, height: targetHeight, top, fadeStart, fadeEnd });
  }

  function prepareMaterial(material, barb) {
    const mat = material.clone(); mat.transparent = true; mat.forceSinglePass = true;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { openingAlpha: alpha.opening, journeyAlpha: alpha.journey, exitEnabled: alpha.exitEnabled,
        exitFrontier: alpha.frontier, exitTransform: alpha.exitTransform, detailPixelHeight: alpha.pixelHeight });
      shader.vertexShader = 'uniform mat4 exitTransform; uniform float detailPixelHeight; varying float originalDepth; varying float detailCoverage;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', [
        '#include <project_vertex>',
        'originalDepth = -(exitTransform * modelMatrix * vec4(transformed,1.)).z;',
        'detailCoverage = projectionMatrix[1][1] * detailPixelHeight * .5 * length(modelMatrix[0].xyz) * .000066 / max(.001,abs(gl_Position.w));',
      ].join('\n'));
      shader.fragmentShader = 'uniform float openingAlpha; uniform float journeyAlpha; uniform float exitEnabled; uniform float exitFrontier; varying float originalDepth; varying float detailCoverage;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', [
        'float oldPart = exitEnabled > .5 ? smoothstep(exitFrontier-.008,exitFrontier+.008,originalDepth) : 1.;',
        'diffuseColor.a *= openingAlpha * oldPart + journeyAlpha;',
        barb ? 'diffuseColor.a *= smoothstep(.45,1.35,detailCoverage);' : '',
        'if(diffuseColor.a < .001) discard;',
        '#include <alphatest_fragment>',
      ].join('\n'));
    };
    mat.customProgramCacheKey = () => barb ? 'huayu-smash-barb-1' : 'huayu-smash-body-1';
    materials.add(mat); return mat;
  }

  function measureGeometry(nearPlane) {
    fullBounds.makeEmpty(); headBounds.makeEmpty();
    for (const mesh of meshes) {
      meshView.multiplyMatrices(view, mesh.matrixWorld);
      scratchBox.copy(mesh.geometry.boundingBox).applyMatrix4(meshView); fullBounds.union(scratchBox);
      if (mesh.name.startsWith('Cork')) headBounds.union(scratchBox);
    }
    point.set(0, 0, 0).applyMatrix4(shuttle.matrixWorld).applyMatrix4(view);
    return { headCameraZ: point.z, headBehind: point.z >= 0, fullyNearClipped: fullBounds.min.z >= -nearPlane,
      fullyBehindEye: fullBounds.min.z >= 0, fullyInFront: fullBounds.max.z < -nearPlane };
  }
  function projectedFraction(box) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      ndc.copy(corner).applyMatrix4(projection);
      minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x); minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y);
    }
    return Math.max(maxX - minX, maxY - minY) * .5;
  }

  function cameraPoint(x, y, depth, out = point) {
    return out.set(x, y, -1).applyMatrix4(inverseProjection).multiplyScalar(depth / -out.z);
  }
  function updateEnvironment(offset, visible) {
    const pixel = depth => 2 * depth / (height * Math.abs(projection.elements[5]));
    near.matrix.copy(inverseView).multiply(translation.makeTranslation(6.6 * Math.tanh(offset.nearParallax.x) * pixel(8), 6.6 * Math.tanh(offset.nearParallax.y) * pixel(8), 0));
    far.matrix.copy(inverseView).multiply(translation.makeTranslation(5.5 * Math.tanh(offset.farParallax.x) * pixel(28), 5.5 * Math.tanh(offset.farParallax.y) * pixel(28), 0));
    near.matrixWorldNeedsUpdate = true; far.matrixWorldNeedsUpdate = true;
    near.visible = visible > .001; far.visible = visible > .001;
    for (const line of farLines) {
      const side = line.userData.side, position = line.geometry.attributes.position; let index = 0;
      const put = (x, y, d) => { cameraPoint(x, y, d); position.setXYZ(index++, point.x, point.y, point.z); };
      for (const x of [.3, .55, .8, 1.1]) { put(side * x, -.98, 11); put(side * x * .06, .14, 42); }
      for (const y of [-.75, -.45, -.12]) { put(0, y, 22); put(side, y, 22); }
      put(side * .96, -.48, 30); put(side * .96, .94, 30);
      position.needsUpdate = true;
      line.material.opacity = visible * .15 * (1 + .35 * Math.tanh(offset.light.x * side));
    }
  }
  function updateTrails(time, opacity, impact) {
    right.setFromMatrixColumn(inverseView, 0).normalize(); up.setFromMatrixColumn(inverseView, 1).normalize();
    for (let lane = 0; lane < trails.length; lane++) {
      const trail = trails[lane], position = trail.geometry.attributes.position, delay = .015 + lane * .01;
      trail.visible = opacity > .001; trail.material.uniforms.opacity.value = opacity * (.42 + impact * .5);
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        trajectory.point(Math.max(0, time - delay * u), point).addScaledVector(right, (lane - 1.5) * .065).addScaledVector(up, (lane % 2 - .5) * .05);
        const w = (.007 + lane * .003) * Math.sin(Math.PI * u);
        position.setXYZ(i * 2, point.x - right.x * w, point.y - right.y * w, point.z - right.z * w);
        position.setXYZ(i * 2 + 1, point.x + right.x * w, point.y + right.y * w, point.z + right.z * w);
      }
      position.needsUpdate = true;
    }
  }
  function dispose() {
    if (disposed) return; disposed = true;
    // 背景副本只拥有对象与材质，几何/贴图仍由原紫电模型持有。
    backdrop.removeFromParent(); backdrop.clear();
    for (const material of backdropMaterials) material.dispose();
    backdropMaterials.clear(); backdropLayout.ready = false; backdropLayout.visible = false;
    disposeTree(shuttle); disposeTree(owned); meshes.length = 0; feathers.length = 0; materials.clear();
    if (brandElement) {
      delete brandElement.dataset.introBrandActive;
      for (const [name, value] of originalBrandStyles) { if (value) brandElement.style.setProperty(name, value); else brandElement.style.removeProperty(name); }
    }
  }

  function loadShuttle() {
    if (disposed || loaded) return;
    if (loading) return loading;
    loading = (async () => {
      const gltf = await loadModel(MODEL, { group: 'story', priority: 0 });
      if (disposed) { disposeTree(gltf.scene); return; }
      buildEffects();
      const variants = new Map();
      gltf.scene.traverse(node => {
        if (/^Feather_\d+$/u.test(node.name)) feathers.push({ node, rest: node.quaternion.clone() });
        if (!node.isMesh) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const barb = node.name.startsWith('Barb_relief_'), key = node.material.uuid + ':' + barb;
        if (!variants.has(key)) variants.set(key, prepareMaterial(node.material, barb));
        node.material = variants.get(key); meshes.push(node);
      });
      shuttle.add(gltf.scene);
      loaded = true;
      if (brandElement) brandElement.dataset.introBrandActive = 'true';
      invalidate();
    })().finally(() => { loading = null; });
    return loading;
  }

  function loadBackdrop() {
    if (disposed || backdropLayout.ready) return;
    backdropLoading ||= loadModel('model-zidian-hero', { group: 'story' }).then(racket => {
      if (!disposed) { buildBackdrop(racket); invalidate(); }
    }).finally(() => { backdropLoading = null; });
    return backdropLoading;
  }

  return {
    resize(snapshot) {
      width = snapshot.width; height = snapshot.height; trajectory.resize(snapshot);
      measureBrand();
    },
    async init({ backdrop: includeBackdrop = true } = {}) {
      await Promise.all([loadShuttle(), includeBackdrop && loadBackdrop()]);
    },
    sample: trajectory.sample,
    update(frame, offset) {
      if (!loaded || disposed) return false;
      const opening = frame.opening, mix = frame.state.reducedMotion ? 0 : opening.mix;
      const start = openingPresentation(opening.time), target = journeyPresentation(frame.progress);
      view.fromArray(opening.viewMatrix); projection.fromArray(opening.projectionMatrix);
      inverseView.copy(view).invert(); inverseProjection.copy(projection).invert();
      alpha.pixelHeight.value = frame.viewport.height * frame.viewport.dpr;
      for (let i = 0; i < feathers.length; i++) {
        const bend = start.bend * mix + target.bend * (1 - mix), flutter = start.flutter * mix;
        feathers[i].node.quaternion.copy(feathers[i].rest);
        feathers[i].node.rotateX(bend * (.95 + .05 * Math.cos(i * .7)) + flutter * Math.sin(i * .63));
      }
      shuttle.updateWorldMatrix(true, true);
      const geometry = measureGeometry(opening.near);
      if (mix === 1) {
        lastBehind = geometry.headBehind || geometry.fullyNearClipped;
        capturedViewRoot.multiplyMatrices(view, shuttle.matrixWorld);
        capturedFarDepth = Math.max(opening.near, -fullBounds.min.z);
        capturedHeadZ = geometry.headCameraZ;
        alpha.frontier.value = opening.near;
      }
      const guarded = mix > 0 && mix < 1 && lastBehind;
      let safe = 1;
      if (guarded) {
        inverseRoot.copy(shuttle.matrixWorld).invert(); alpha.exitTransform.value.multiplyMatrices(capturedViewRoot, inverseRoot);
        // 同次接管只推进旧尾羽裁切；反向滚动改变目标时，也不能让已退出部分再次显露。
        alpha.frontier.value = Math.max(alpha.frontier.value, opening.near + Math.max((capturedFarDepth - opening.near + .02) * (1 - mix), capturedHeadZ - geometry.headCameraZ));
        safe = geometry.fullyInFront
          ? smoothRange(.08, .4, -fullBounds.max.z - opening.near) * (1 - smoothRange(.25, .35, projectedFraction(headBounds))) * (1 - smoothRange(1.4, 1.8, projectedFraction(fullBounds))) : 0;
      }
      alpha.exitEnabled.value = guarded ? 1 : 0;
      alpha.opening.value = start.ball * mix;
      alpha.journey.value = target.ball * (1 - mix) * safe;
      shuttle.visible = alpha.opening.value + alpha.journey.value > .001;
      for (const material of materials) material.depthWrite = !guarded && alpha.opening.value + alpha.journey.value > .999;
      const visual = {};
      for (const name of ['brand', 'reveal', 'sheen', 'trail', 'impact', 'bend', 'flutter']) visual[name] = start[name] * mix + target[name] * (1 - mix);
      writeBrand(visual);
      updateTrails(opening.time, visual.trail, visual.impact);
      flash.intensity = 160 * visual.impact;
      trajectory.point(Math.min(opening.time, SMASH.exit), flash.position).addScaledVector(right, .35).addScaledVector(up, .25);
      const brandEnvironment = Math.max(visual.brand, mix);
      updateEnvironment(offset, brandEnvironment);
      updateBackdrop(frame, visual.brand);
      currentPresentation = { time: opening.time, mix, ...visual, openingBall: alpha.opening.value, journeyBall: alpha.journey.value, safe,
        guarded, exitFrontier: alpha.frontier.value, shuttleVisible: shuttle.visible, ...geometry, fullDepth: [-fullBounds.max.z, -fullBounds.min.z],
        headDepth: [-headBounds.max.z, -headBounds.min.z], nearFeedback: [6.6 * Math.tanh(offset.nearParallax.x), 6.6 * Math.tanh(offset.nearParallax.y)],
        farFeedback: [5.5 * Math.tanh(offset.farParallax.x), 5.5 * Math.tanh(offset.farParallax.y)], flow: offset.flow.toArray(), light: offset.light.toArray() };
      return !frame.state.reducedMotion;
    },
    isContentReady: (includeBackdrop = false) => loaded && !disposed && (!includeBackdrop || backdropLayout.ready),
    getBackdropVisibility: () => backdropLayout.weight,
    inspect: () => ({ loaded, disposed, ...currentPresentation, backdrop: { ...backdropLayout, meshNames: backdropLayout.meshNames.slice() } }),
    dispose,
  };
}
