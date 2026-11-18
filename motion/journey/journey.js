import { Group, PointLight, DirectionalLight } from 'three';
import { loadModel } from '../shared/assets.js?v=entry-first-20261112';
import { disposeTree } from '../shared/dispose.js';
import { createTeam } from './team.js?v=entry-first-20261112';
import { SPACE, sampleJourneyPose } from './path.js';

export function createJourney({ root, teamSection, readState, invalidate }) {
  const owned = new Group(); owned.name = 'journey_environment'; root.add(owned);
  const team = createTeam({ root: owned, section: teamSection, readState, invalidate });
  const track = teamSection.closest('[data-story-track]');
  let disposed = false, ready = false, renderable = false, lastProgress = 0, portalOpacity = 1;
  const models = new Map(), pending = new Map(), failed = new Map();
  const portalMaterials = new Map();
  const assets = [
    { name: 'narrative-racket', position: [0, SPACE.portalY - .192 * SPACE.portalScale, SPACE.portalZ], scale: SPACE.portalScale },
    { name: 'court', position: [0, 0, SPACE.courtZ], scale: 1 },
    { name: 'lightfield', position: [0, 0, SPACE.courtZ], scale: 1 },
    { name: 'team-stage', position: [0, 0, SPACE.teamZ], scale: 1 },
  ];
  const sectionModels = { portal: ['narrative-racket'], court: ['court', 'lightfield'], team: ['team-stage'] };
  const sceneAt = ({ p }) => p < .05 ? null : p < .375 ? 'portal' : p < .88 || !team.inViewport() ? 'court' : 'team';
  const fill = new DirectionalLight(0xb4a3d5, .9); fill.position.set(-4, 7, -12); owned.add(fill);
  const violet = new PointLight(0x8841ec, 90, 24, 2); violet.position.set(-4, 3, SPACE.courtZ); owned.add(violet);
  const red = new PointLight(0xe52c49, 85, 22, 2); red.position.set(4, 2.8, SPACE.courtZ - 1); owned.add(red);

  function syncStatus() {
    if (!track || disposed) return;
    track.dataset.journeyReady = String(renderable && models.has('court'));
    if (pending.size) track.dataset.journeyLoading = 'true';
    else delete track.dataset.journeyLoading;
    if (failed.size) track.dataset.journeyFailed = 'true';
    else delete track.dataset.journeyFailed;
  }

  function load({ name, position, scale }) {
    if (disposed || models.has(name) || pending.has(name)) return pending.get(name);
    const url = new URL(`./assets/${name}.meshopt.glb`, import.meta.url);
    const primary = lastProgress < .375 ? 'narrative-racket' : lastProgress < .88 ? 'court' : null;
    failed.delete(name);
    const request = loadModel(url.href, { group: 'story', priority: name === primary ? 0 : 1 }).then(gltf => {
      if (disposed) { disposeTree(gltf.scene); return; }
      gltf.scene.position.set(...position); gltf.scene.scale.setScalar(scale);
      if (name === 'narrative-racket') gltf.scene.traverse(node => {
        if (!node.isMesh) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (portalMaterials.has(material)) continue;
          portalMaterials.set(material, material.opacity);
          // 在准备期固定透明管线，交接只改权重，不在首次滚动时另编译着色器。
          material.transparent = true; material.forceSinglePass = true;
          material.alphaTest = Math.max(material.alphaTest, .001);
          material.opacity *= portalOpacity;
        }
      });
      models.set(name, gltf.scene);
      if (name === 'team-stage') team.attachStage(gltf.scene);
      else owned.add(gltf.scene);
    }).catch(error => {
      if (!disposed) { failed.set(name, String(error)); console.error(`[motion:journey:${name}]`, error); }
    }).finally(() => {
      pending.delete(name);
      if (!disposed) { syncStatus(); invalidate(); }
    });
    pending.set(name, request); syncStatus();
    return request;
  }

  return {
    async init(progress = lastProgress) {
      if (disposed || ready) return;
      lastProgress = typeof progress === 'number' ? progress : progress.p;
      ready = true;
      invalidate();
    },
    sceneAt,
    entryAssets(section) {
      return [...(sectionModels[section] || []).map(name => `model-${name}`), ...(section === 'team' ? team.entryAssets() : [])];
    },
    async prepareSection(section, { entry = false } = {}) {
      if (disposed) throw new Error('穿场场景已经释放');
      const names = sectionModels[section];
      await Promise.all([
        ...assets.filter(asset => names.includes(asset.name)).map(load),
        section === 'team' && team.prepare(entry),
      ]);
      if (names.some(name => !models.has(name))) throw new Error('当前穿场画面尚未准备完成');
    },
    retry() {
      if (disposed) return Promise.resolve();
      return Promise.all([...assets.filter(asset => failed.has(asset.name)).map(load), team.retry()]);
    },
    setRenderable(value) { renderable = Boolean(value) && !disposed; team.setRenderable(renderable); syncStatus(); },
    setPresentationVisible(value) { owned.visible = Boolean(value) && !disposed; },
    setPortalOpacity(value) {
      portalOpacity = Math.max(0, Math.min(1, value));
      for (const [material, original] of portalMaterials) material.opacity = original * portalOpacity;
    },
    isContentReady(progress) {
      if (disposed) return false;
      const section = sceneAt(progress);
      if (!section) return true;
      return sectionModels[section].every(name => models.has(name)) && (section !== 'team' || team.isContentReady());
    },
    sample(p, outPose) { lastProgress = p; return sampleJourneyPose(p, outPose, readState().reducedMotion); },
    update(frame, offset) {
      if (disposed) return false;
      lastProgress = frame.progress.p;
      violet.position.x = -4 + offset.light.x * .25;
      red.position.y = 2.8 + offset.light.y * .2;
      return team.update(frame, offset);
    },
    selectMember: team.selectMember,
    inspect: () => ({ ready, disposed, renderable, presentationVisible: owned.visible, modelNames: [...models.keys()], loadingModels: [...pending.keys()],
      failedModels: [...failed].map(([name, error]) => ({ name, error })),
      portal: { center: [0, SPACE.portalY, SPACE.portalZ], displayScale: SPACE.portalScale, halfGap: (.0095 / 2 - .00032) * SPACE.portalScale, opacity: portalOpacity }, team: team.inspect() }),
    dispose() {
      if (disposed) return;
      disposed = true; renderable = false; team.dispose(); disposeTree(owned); models.clear(); pending.clear(); failed.clear(); portalMaterials.clear();
      if (track) { delete track.dataset.journeyReady; delete track.dataset.journeyLoading; delete track.dataset.journeyFailed; }
    },
  };
}
