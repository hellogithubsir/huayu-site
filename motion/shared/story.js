import { Scene, PerspectiveCamera, FogExp2 } from 'three';
import { bindSurface } from './surface-input.js';
import { createPose, copyPose, createOffset, resetOffset, composeStoryPose, makeResidual, applyResidual, INTRO_REST_POSE } from './story-space.js';
import { journeyPresentation } from '../intro/smash.js';

export function createStory({ host, root, intro, journey, interaction, readState, invalidate }) {
  const scene = new Scene();
  scene.fog = new FogExp2(0x0b0713, .026);
  scene.add(root);
  const camera = new PerspectiveCamera(42, 1, .02, 120);
  const base = copyPose(INTRO_REST_POSE, createPose()), target = createPose(), composed = createPose();
  const offset = createOffset(), appliedOffset = createOffset();
  const viewSnapshot = new Array(16), projectionSnapshot = new Array(16);
  const events = new AbortController();
  const track = host.closest('[data-story-track]') || host;
  let anchors = [], disposed = false, active = false, ready = false, journeyStatus = 'new';
  let seconds = 0, source = scrollY > 4 || location.hash ? 'journey' : 'intro';
  let pending = null, residual = null, residualAge = 0, scrollPosition = scrollY;
  let lastProgress = { p: 0, section: 'departure', segment: 0, index: 0 };
  let projectionWidth = 0, projectionHeight = 0, projectionDirty = true;
  let inputGain = source === 'intro' ? .25 : 1, gainFrom = inputGain, openingMix = 1;
  let renderable = false, introError = null, seenActive = false, introLoading = null, requestedBackdrop = true;
  journey?.setPresentationVisible?.(source === 'journey' && measureProgress().p > .005);
  const retryButton = document.createElement('button');
  retryButton.type = 'button'; retryButton.className = 'motion-retry'; retryButton.hidden = true;
  retryButton.innerHTML = '<span data-zh>重新加载三维</span><span data-en>Reload 3D</span>';
  host.append(retryButton);
  retryButton.addEventListener('click', () => { void retry(); }, { signal: events.signal });

  const surface = bindSurface(host, {
    isBlocked: () => !active || readState().modalOpen || readState().menuOpen,
    invalidate,
  });

  function measureProgress() {
    anchors = [...track.querySelectorAll('[data-story-anchor]')].map(element => ({ name: element.dataset.storyAnchor, y: element.getBoundingClientRect().top + scrollY }));
    if (anchors.length < 2) return { p: 0, section: 'departure', segment: 0, index: 0 };
    let index = 0;
    while (index < anchors.length - 2 && scrollY >= anchors[index + 1].y) index++;
    const segment = Math.max(0, Math.min(1, (scrollY - anchors[index].y) / Math.max(1, anchors[index + 1].y - anchors[index].y)));
    return { p: (index + segment) / (anchors.length - 1), section: anchors[index].name, segment, index };
  }

  function requestTakeover(kind) {
    if (source === 'intro' && (kind === 'jump' || pending !== 'jump')) pending = kind;
    else if (kind === 'jump') residual = null;
    invalidate();
  }
  window.addEventListener('scroll', () => {
    if (Math.abs(scrollY - scrollPosition) > .5) requestTakeover('scroll');
    scrollPosition = scrollY;
  }, { passive: true, signal: events.signal });
  window.addEventListener('hashchange', () => requestTakeover('jump'), { signal: events.signal });
  document.addEventListener('click', event => {
    if (event.target.closest('a[href^="#"]')) requestTakeover('jump');
  }, { signal: events.signal });
  document.addEventListener('keydown', event => {
    if (event.target.closest('input,textarea,select,button,video,[contenteditable]')) return;
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) requestTakeover('scroll');
  }, { signal: events.signal });

  function journeySample(p, out) {
    if (journey) journey.sample(p, out);
    else copyPose(INTRO_REST_POSE, out);
  }

  function applyProjection() {
    if (!projectionDirty || !projectionWidth || !projectionHeight) return;
    const aspect = projectionWidth / projectionHeight;
    camera.aspect = aspect;
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    projectionDirty = false;
  }

  function initJourney() {
    if (!journey || journeyStatus !== 'new') return;
    journeyStatus = 'loading';
    return Promise.resolve().then(() => { if (!disposed) return journey.init(measureProgress()); }).then(() => {
      if (disposed) return;
      journeyStatus = 'ready'; invalidate();
    }).catch(error => {
      if (disposed) return;
      journeyStatus = 'failed'; host.dataset.journeyError = String(error);
      console.error('[motion:journey]', error); invalidate();
    });
  }

  async function loadIntro(backdrop = true) {
    if (introLoading) return introLoading;
    requestedBackdrop = backdrop;
    introLoading = (async () => {
    try { await intro.init({ backdrop }); introError = null; }
    catch (error) { introError = String(error); }
    retryButton.hidden = !introError;
    invalidate();
    })().finally(() => { introLoading = null; });
    return introLoading;
  }
  async function retry() {
    if (disposed || retryButton.disabled) return;
    retryButton.disabled = true;
    try {
      await Promise.all([introError ? loadIntro(requestedBackdrop) : Promise.resolve(), journey?.retry?.()]);
      if (journeyStatus === 'failed') { journeyStatus = 'new'; initJourney(); }
    } finally { retryButton.disabled = false; invalidate(); }
  }
  const needsBackdrop = progress => source === 'intro' || journeyPresentation(progress).brand > .001;

  function isContentReady() {
    const progress = measureProgress();
    return intro.isContentReady(needsBackdrop(progress)) && (source === 'intro' || journey.isContentReady(progress));
  }

  function planEntry() {
    const progress = measureProgress();
    const opening = source === 'intro' && scrollY <= 4;
    return { opening, backdrop: opening || journeyPresentation(progress).brand > .001,
      scene: opening ? null : journey.sceneAt(progress) };
  }

  return {
    host, scene, camera, measureProgress,
    entryAssets() {
      const plan = planEntry();
      return ['model-huayu-shuttle', ...(plan.backdrop ? ['model-zidian-hero'] : []), ...journey.entryAssets(plan.scene)];
    },
    async init() {
      if (disposed) return;
      ready = true;
      const progress = measureProgress();
      if (progress.section === 'departure') void loadIntro(needsBackdrop(progress));
      if (source === 'journey' && progress.p > .005) initJourney();
    },
    async prepareEntry() {
      if (disposed) throw new Error('开场场景已经释放');
      ready = true;
      const plan = planEntry();
      if (!plan.opening) source = 'journey';
      await Promise.all([loadIntro(plan.backdrop), plan.scene && journey.prepareSection(plan.scene, { entry: true })]);
      if (introError || !intro.isContentReady(plan.backdrop)) throw new Error(introError || '开场模型尚未准备完成');
      if (!plan.opening) await initJourney();
    },
    retry, isContentReady,
    setRenderable(value) {
      renderable = value;
      track.dataset.renderable = String(value);
      journey?.setRenderable?.(value);
    },
    resize({ width, height }) {
      if (projectionWidth !== width || projectionHeight !== height) {
        projectionWidth = width; projectionHeight = height; projectionDirty = true;
      }
      applyProjection();
      if (width > 0 && height > 0) intro.resize?.({ width, height, projectionMatrix: camera.projectionMatrix.toArray() });
    },
    setActive(value) {
      if (value && !active && seenActive) void retry();
      active = value;
      if (value) seenActive = true;
      if (!active) { interaction?.reset(); resetOffset(offset); resetOffset(appliedOffset); surface.reset(); }
    },
    update(frame) {
      if (!ready || disposed) return false;
      const progress = frame.progress || measureProgress();
      lastProgress = progress;
      const backdrop = needsBackdrop(progress);
      if (!frame.state.preparing && !intro.isContentReady(backdrop) && !introError) void loadIntro(backdrop);
      const reduced = frame.state.reducedMotion;
      const preparing = Boolean(frame.state.preparing);
      if (!preparing && reduced && source === 'intro') pending = 'jump';
      let justTransferred = false;
      if (!preparing && pending && source === 'intro') {
        journeySample(progress.p, target);
        gainFrom = inputGain;
        residual = pending === 'jump' || reduced ? null : makeResidual(base, target);
        residualAge = 0; source = 'journey'; pending = null; justTransferred = true;
      }
      let transitionWeight = 0;
      if (source === 'intro') {
        if (!preparing && intro.isContentReady()) seconds = Math.min(3, seconds + frame.dt);
        intro.sample(seconds, base);
      } else {
        journeySample(progress.p, target);
        if (residual && !reduced) {
          if (!preparing && !justTransferred) residualAge += frame.dt;
          const t = Math.min(1, residualAge / .22);
          const weight = 1 - t * t * (3 - 2 * t);
          transitionWeight = weight;
          applyResidual(target, residual, weight, base);
          if (t === 1) residual = null;
        } else { residual = null; copyPose(target, base); }
      }
      const raw = surface.read();
      if (!preparing && interaction && !frame.state.menuOpen) interaction.sample({ dt: frame.dt, raw, active, reducedMotion: reduced }, offset);
      else resetOffset(offset);
      if (reduced) resetOffset(offset);
      const gainProgress = Math.max(0, Math.min(1, (seconds - .78) / .32));
      const targetGain = source === 'intro' ? .25 + .75 * gainProgress * gainProgress * (3 - 2 * gainProgress) : 1;
      inputGain = targetGain + (gainFrom - targetGain) * transitionWeight;
      appliedOffset.cameraPosition.copy(offset.cameraPosition).multiplyScalar(inputGain);
      appliedOffset.cameraQuaternion.identity().slerp(offset.cameraQuaternion, inputGain);
      appliedOffset.shuttleQuaternion.identity().slerp(offset.shuttleQuaternion, inputGain);
      for (const key of ['nearParallax', 'farParallax', 'flow', 'light']) appliedOffset[key].copy(offset[key]).multiplyScalar(inputGain);
      composeStoryPose(base, appliedOffset, composed);
      camera.position.copy(composed.camera.position);
      camera.quaternion.copy(composed.camera.quaternion);
      if (camera.fov !== composed.camera.fov) { camera.fov = composed.camera.fov; projectionDirty = true; }
      applyProjection();
      const shuttle = root.getObjectByName('shuttle_root');
      if (shuttle) {
        shuttle.position.copy(composed.shuttle.position);
        shuttle.quaternion.copy(composed.shuttle.quaternion);
        shuttle.scale.setScalar(composed.shuttle.scale);
      }
      camera.updateMatrixWorld(true);
      camera.matrixWorldInverse.toArray(viewSnapshot); camera.projectionMatrix.toArray(projectionSnapshot);
      openingMix = source === 'intro' ? 1 : transitionWeight;
      // 数值缓冲仅借用到下一帧；消费者不得写回，留证须自行复制。
      const opening = { time: seconds, mix: openingMix, viewMatrix: viewSnapshot, projectionMatrix: projectionSnapshot, near: camera.near };
      const visualFrame = { ...frame, progress, introTime: source === 'intro' ? seconds : 3, opening };
      const introMotion = intro.update(visualFrame, appliedOffset);
      // 穿场环境仍须等真实叙事接管后才展示。
      const journeyVisible = source === 'journey' && progress.p > .005;
      journey?.setPresentationVisible?.(journeyVisible);
      journey?.setPortalOpacity?.(1 - (intro.getBackdropVisibility?.() || 0));
      if (journeyVisible && !preparing) initJourney();
      const journeyMotion = journeyVisible ? journey.update(visualFrame, appliedOffset) : false;
      return !reduced && (introMotion || journeyMotion || intro.isContentReady() && seconds < 3 && source === 'intro' || Boolean(residual));
    },
    inspect: () => ({ source, introSeconds: seconds, residualAge, residual: Boolean(residual), active, ready, journeyStatus, renderable, introError, contentReady: isContentReady(),
      progress: lastProgress, cameraPosition: base.camera.position.toArray(), shuttlePosition: base.shuttle.position.toArray(),
      composedCamera: composed.camera.position.toArray(), raw: { ...surface.read() }, opening: { time: seconds, mix: openingMix, inputGain } }),
    dispose() {
      if (disposed) return;
      disposed = true; events.abort(); retryButton.remove(); surface.dispose(); interaction?.dispose(); journey?.dispose(); intro.dispose(); root.removeFromParent();
    },
  };
}
