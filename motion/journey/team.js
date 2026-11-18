import { Group, Mesh, PlaneGeometry, MeshBasicMaterial, SRGBColorSpace, DoubleSide, Vector3, Box3 } from 'three';
import { loadTexture, promoteAsset } from '../shared/assets.js?v=entry-first-20261112';
import { bindSurface } from '../shared/surface-input.js';
import { disposeTree } from '../shared/dispose.js';
import { createPose, composeStoryPose } from '../shared/story-space.js';
import { SPACE, sampleJourneyPose } from './path.js';
import { createTeamLayout, measureTeamLayout, fitTeamStage, clipTeamMaterial } from './team-layout.js';

export function createTeam({ root, section, readState, invalidate }) {
  const people = [...section.querySelectorAll('.orbit-person[data-member]')];
  const selectors = [...section.querySelectorAll('[data-orbit-select]')];
  const spatialIds = people.map(person => person.dataset.member);
  const rosterIds = selectors.map(button => button.dataset.orbitSelect);
  const byId = new Map(people.map(person => [person.dataset.member, person]));
  const viewport = section.querySelector('.orbit-viewport');
  const storyHost = section.closest('[data-story-track]').querySelector('[data-motion-surface]');
  const name = section.querySelector('[data-orbit-name]');
  const credentials = section.querySelector('[data-orbit-credentials]');
  const positionLabel = section.querySelector('[data-orbit-position]');
  const wordmarkImage = section.querySelector('.orbit-brandmark');
  const previous = section.querySelector('[data-orbit-prev]'), next = section.querySelector('[data-orbit-next]');
  const owned = new Group(); owned.name = 'journey_team'; owned.position.z = SPACE.teamZ; root.add(owned);
  const layout = createTeamLayout();
  const clipUniforms = { rect: { value: layout.clip }, height: { value: 1 }, dpr: { value: 1 } };
  const restingPose = sampleJourneyPose(1, createPose()), composedPose = createPose();
  const stageCenter = new Vector3(0, 2.35, SPACE.teamZ);
  const portraits = new Map(), pending = new Map(), failed = new Set();
  const events = new AbortController();
  let selected = selectors.find(button => button.getAttribute('aria-current') === 'true')?.dataset.orbitSelect || rosterIds[0];
  let position = spatialIds.indexOf(selected), target = position, dragStart = position;
  let disposed = false, loading = false, shown = false, renderable = false, lastLanguage = '', wordmark = null;
  let stageOpacity = 0, wordmarkRequest = null, wordmarkFailed = false;
  let layoutWidth = 0, layoutHeight = 0, portraitBox = null;
  let stageModel = null, stageModelWidth = 1;
  const wrap = value => (value % people.length + people.length) % people.length;
  const distanceTo = (index, center) => wrap(index - center + people.length / 2) - people.length / 2;
  viewport.dataset.motionSurface = '';
  section.dataset.journeyTeam = '';
  section.querySelector('.orbit-controls').hidden = false;
  section.querySelector('.orbit-members').hidden = false;
  const retryButton = document.createElement('button');
  retryButton.type = 'button'; retryButton.className = 'journey-retry'; retryButton.dataset.motionNative = '';
  retryButton.hidden = true; viewport.append(retryButton);

  function syncPresentation() {
    shown = !disposed && renderable && portraits.has(selected) && stageOpacity > 0 && layout.visible;
    section.dataset.teamReady = String(shown);
    section.dataset.teamWordmarkReady = String(shown && Boolean(wordmark));
    section.dataset.teamStageReady = String(shown && Boolean(stageModel));
  }

  function syncResourceStatus() {
    if (failed.size) section.dataset.portraitError = [...failed].join(',');
    else delete section.dataset.portraitError;
    retryButton.hidden = disposed || !failed.has(selected);
    retryButton.textContent = readState().lang === 'en' ? 'Reload portrait' : '重新加载人物';
  }

  function describe() {
    const person = byId.get(selected), english = readState().lang === 'en';
    lastLanguage = readState().lang;
    section.dataset.selected = selected;
    name.textContent = person.dataset[english ? 'nameEn' : 'nameZh'];
    credentials.replaceChildren(person.querySelector('template[data-member-credentials]').content.cloneNode(true));
    positionLabel.textContent = `${rosterIds.indexOf(selected) + 1} / ${rosterIds.length}`;
    for (const button of selectors) {
      if (button.dataset.orbitSelect === selected) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    for (const figure of people) {
      figure.dataset.teamSelected = String(figure.dataset.member === selected);
      figure.setAttribute('aria-hidden', String(figure.dataset.member !== selected));
      figure.querySelector('img').alt = `${figure.dataset[english ? 'nameEn' : 'nameZh']}${english ? ', original Huayu film frame' : '，华羽宣传片原帧'}`;
    }
    previous.setAttribute('aria-label', english ? 'Previous person' : '上一位');
    next.setAttribute('aria-label', english ? 'Next person' : '下一位');
    viewport.setAttribute('aria-label', english ? 'Team stage. Left and right arrows change person; Home selects the first name.' : '团队舞台，左右方向键切换，Home回到名单第一位');
    section.querySelector('.orbit-members').setAttribute('aria-label', english ? 'Choose a team member' : '选择团队人物');
    syncResourceStatus(); syncPresentation();
    invalidate();
  }

  function textureURL(id) {
    const custom = byId.get(id).dataset.motionPortrait;
    return custom ? new URL(custom, document.baseURI).href : new URL(`./assets/portraits/member-${encodeURIComponent(id).padStart(2, '0')}.png`, import.meta.url).href;
  }

  function loadPortrait(id, { retry = false, priority = 1 } = {}) {
    if (disposed || portraits.has(id) || failed.has(id) && !retry) return pending.get(id);
    if (pending.has(id)) {
      // 改选排队邻位时只提升优先级，结果仍由原处理器接收。
      if (priority < 1) promoteAsset(textureURL(id), { group: 'story', kind: 'texture', priority });
      return pending.get(id);
    }
    failed.delete(id); syncResourceStatus();
    const request = loadTexture(textureURL(id), { group: 'story', priority }).then(texture => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = SRGBColorSpace;
      const material = new MeshBasicMaterial({ map: texture, transparent: true, opacity: 1, depthWrite: false, alphaTest: .015, side: DoubleSide, toneMapped: false });
      clipTeamMaterial(material, clipUniforms);
      const plane = new Mesh(new PlaneGeometry(SPACE.portraitAspect * 5.1, 5.1), material);
      plane.name = `member_${id}`; plane.userData.memberId = id;
      owned.add(plane); portraits.set(id, plane); invalidate();
    }).catch(error => {
      if (!disposed) { failed.add(id); console.error(`[motion:journey:portrait:${id}]`, error); }
    }).finally(() => {
      pending.delete(id);
      if (!disposed) { syncResourceStatus(); invalidate(); }
    });
    pending.set(id, request);
    return request;
  }

  function visibleIds() {
    const index = spatialIds.indexOf(selected);
    return [0, -1, 1, -2, 2].map(delta => spatialIds[wrap(index + delta)]);
  }

  function loadNeighbors(retrySelected = false) {
    const primary = loadPortrait(selected, { retry: retrySelected, priority: -1 });
    for (const id of visibleIds().slice(1)) loadPortrait(id);
    return primary;
  }

  function loadWordmark(retry = false) {
    const image = wordmarkImage;
    if (disposed || wordmark || wordmarkRequest || !image || wordmarkFailed && !retry) return wordmarkRequest;
    wordmarkFailed = false;
    wordmarkRequest = loadTexture(image.dataset.asset || image.getAttribute('src') || image.src, { group: 'story', priority: 1 }).then(texture => {
      if (disposed) { texture.dispose(); return; }
      texture.colorSpace = SRGBColorSpace;
      wordmark = new Mesh(new PlaneGeometry(12, 12 * 270 / 1700), new MeshBasicMaterial({ map: texture, transparent: true, opacity: .66, depthWrite: false, toneMapped: false }));
      clipTeamMaterial(wordmark.material, clipUniforms);
      wordmark.name = 'original_huayu_wordmark'; wordmark.position.set(0, 4.25, -2.3); owned.add(wordmark);
    }).catch(error => {
      if (!disposed) { wordmarkFailed = true; console.error('[motion:journey:wordmark]', error); }
    }).finally(() => { wordmarkRequest = null; if (!disposed) invalidate(); });
    return wordmarkRequest;
  }

  function retry() {
    if (disposed || !loading) return Promise.resolve();
    // 仅在明确的重新进入/重选/按钮动作中重试，渲染帧不重复发起失败请求。
    const requests = [loadNeighbors(true)];
    for (const id of failed) requests.push(loadPortrait(id, { retry: true, priority: id === selected ? -1 : 1 }));
    if (wordmarkFailed) requests.push(loadWordmark(true));
    return Promise.all(requests);
  }

  function selectMember(id) {
    if (events.signal.aborted || !byId.has(String(id))) return;
    selected = String(id);
    target = position + distanceTo(spatialIds.indexOf(selected), position);
    if (disposed || !shown || readState().reducedMotion) position = target;
    describe();
    if (loading && !disposed) loadNeighbors(true);
  }

  function adjacent(step) { selectMember(spatialIds[wrap(spatialIds.indexOf(selected) + step)]); }
  const surface = bindSurface(viewport, {
    isBlocked: () => events.signal.aborted || readState().hidden || readState().modalOpen || readState().menuOpen,
    invalidate,
    onDragStart() { dragStart = position; },
    onDrag({ dx }) {
      target = dragStart - dx / Math.max(130, viewport.clientWidth * .24);
      if (disposed || !shown || readState().reducedMotion) position = target;
    },
    onDragEnd({ cancelled }) {
      if (cancelled) { target = position + distanceTo(spatialIds.indexOf(selected), position); return; }
      selectMember(spatialIds[wrap(Math.round(target))]);
    },
    onKey(event) {
      if (event.key === 'ArrowLeft') adjacent(-1);
      else if (event.key === 'ArrowRight') adjacent(1);
      else if (event.key === 'Home') selectMember(rosterIds[0]);
      else return false;
      return true;
    },
  });
  previous.addEventListener('click', () => adjacent(-1), { signal: events.signal });
  next.addEventListener('click', () => adjacent(1), { signal: events.signal });
  retryButton.addEventListener('click', retry, { signal: events.signal });
  for (const button of selectors) button.addEventListener('click', () => selectMember(button.dataset.orbitSelect), { signal: events.signal });
  const languageObserver = new MutationObserver(describe);
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  // 选人属于DOM业务；只在文档真正卸载时解除，不能随WebGL释放一起失效。
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { surface.dispose(); events.abort(); languageObserver.disconnect(); }
  }, { signal: events.signal });
  describe();

  return {
    selectMember, retry,
    setRenderable(value) { renderable = Boolean(value) && !disposed; syncPresentation(); },
    isContentReady: () => !disposed && portraits.has(selected) && stageOpacity > 0 && layout.visible,
    attachStage(model) {
      // 台面与人物同属一个文档舞台，不能留在正文后面单独漂浮。
      model.position.set(0, 0, 0);
      stageModel = model;
      stageModelWidth = new Box3().setFromObject(model).getSize(new Vector3()).x;
      const materials = new Set();
      model.traverse(node => {
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material) materials.add(material);
        }
      });
      for (const material of materials) clipTeamMaterial(material, clipUniforms);
      owned.add(model);
    },
    async init() {
      if (disposed) return;
      if (loading) return pending.get(selected);
      loading = true;
      const primary = loadNeighbors(); loadWordmark();
      await primary;
    },
    entryAssets: () => [...visibleIds().map(textureURL), wordmarkImage.dataset.asset],
    inViewport() {
      const stage = viewport.getBoundingClientRect(), host = storyHost.getBoundingClientRect();
      return Math.min(innerHeight, stage.bottom, host.bottom) > Math.max(0, stage.top, host.top);
    },
    async prepare(visibleOnly = false) {
      if (disposed) throw new Error('团队舞台已经释放');
      loading = true;
      const ids = visibleOnly ? visibleIds() : spatialIds;
      await Promise.all([...ids.map(id => loadPortrait(id, { retry: true, priority: id === selected ? -1 : 1 })), loadWordmark(true)]);
      if (ids.some(id => !portraits.has(id)) || !wordmark) throw new Error('团队展示素材尚未准备完成');
    },
    isPrepared: () => !disposed && portraits.size === spatialIds.length && Boolean(wordmark) && failed.size === 0,
    update(frame, offset) {
      if (disposed) return false;
      const progress = frame.progress.p;
      // p在team后钳为1，但文档仍滚动；读取真实DOM位置，不能继续钉在屏幕中央。
      const stageRect = viewport.getBoundingClientRect(), hostRect = storyHost.getBoundingClientRect();
      if (layoutWidth !== stageRect.width || layoutHeight !== stageRect.height || !portraitBox) {
        const style = getComputedStyle(people[0]);
        portraitBox = { height: parseFloat(style.height), top: parseFloat(style.top) };
        layoutWidth = stageRect.width; layoutHeight = stageRect.height;
      }
      composeStoryPose(restingPose, offset, composedPose);
      measureTeamLayout(stageRect, section.getBoundingClientRect(), hostRect,
        frame.viewport, composedPose.camera, stageCenter, layout);
      fitTeamStage(stageRect, hostRect, portraitBox, restingPose.camera, SPACE.teamZ, layout);
      owned.position.copy(layout.position); owned.scale.setScalar(layout.scale);
      if (stageModel) stageModel.scale.setScalar(Math.min(1, stageRect.width * layout.unitsPerPixel * .94 / (stageModelWidth * layout.scale)));
      clipUniforms.height.value = frame.viewport.height;
      clipUniforms.dpr.value = frame.viewport.dpr;
      if (lastLanguage !== frame.state.lang) describe();
      const difference = target - position;
      position = frame.state.reducedMotion ? target : position + difference * (1 - Math.exp(-frame.dt * 11));
      if (Math.abs(target - position) < .001) position = target;
      const opacity = stageOpacity = Math.max(0, Math.min(1, (progress - .68) / .2));
      owned.visible = opacity > 0 && layout.visible;
      for (const [id, plane] of portraits) {
        const distance = distanceTo(spatialIds.indexOf(id), position), absolute = Math.abs(distance);
        plane.visible = absolute < 2.6;
        if (!plane.visible) continue;
        const angle = distance * .48;
        const scale = Math.max(.58, 1 - absolute * .15);
        plane.scale.setScalar(scale);
        plane.position.set(Math.sin(angle) * 5.5, 2.35 + absolute * .04, -(1 - Math.cos(angle)) * 4);
        plane.rotation.y = -angle * .18;
        plane.material.opacity = opacity * Math.max(0, 1 - absolute * .35);
        plane.renderOrder = Math.round(100 - absolute * 10);
      }
      if (wordmark) {
        wordmark.position.copy(layout.logoPosition); wordmark.position.x += offset.farParallax.x * .06;
        wordmark.scale.setScalar(layout.logoScale); wordmark.material.opacity = opacity * .66;
      }
      syncPresentation();
      return Math.abs(target - position) > .001;
    },
    inspect: () => ({ selected, rosterIds: [...rosterIds], spatialIds: [...spatialIds], position, target, ready: shown, renderable,
      contentReady: !disposed && portraits.has(selected) && stageOpacity > 0 && layout.visible, wordmarkFailed,
      stageLayout: { visible: layout.visible, scrollPixels: layout.scrollPixels, clip: layout.clip.toArray(), translation: layout.translation.toArray(),
        position: layout.position.toArray(), scale: layout.scale, portraitBox },
      loadedIds: [...portraits.keys()], loadingIds: [...pending.keys()], failedIds: [...failed],
      visiblePlanes: [...portraits.values()].filter(plane => plane.visible).map(plane => ({ id: plane.userData.memberId, position: plane.position.toArray(), opacity: plane.material.opacity,
        textureURL: plane.material.map.image?.currentSrc || plane.material.map.image?.src })) }),
    dispose() {
      if (disposed) return;
      disposed = true; surface.reset(); disposeTree(owned); portraits.clear(); pending.clear();
      renderable = false; syncPresentation(); syncResourceStatus();
      // 保留原帧/完整资料/选人控制器；后续操作只更新DOM，不重新加载或启动三维。
      position = target = spatialIds.indexOf(selected);
      shown = false;
    },
  };
}
