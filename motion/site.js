import { Group } from 'three';
import { createRuntime, stageInViewport } from './shared/runtime.js?v=entry-first-20261112';
import { createStory } from './shared/story.js?v=entry-first-20261112';
import { createMediaCoordinator } from './shared/media.js?v=entry-first-20261112';
import { createIntro } from './intro/intro.js?v=entry-first-20261112';
import { createInteraction } from './interaction/interaction.js';
import { createJourney } from './journey/journey.js?v=entry-first-20261112';
import { bindBrandFilm } from './brand-film.js';
import { prepareAssets, loadImage, resolveAssetURL, cancelPreparation } from './shared/assets.js?v=entry-first-20261112';
import { scrollProgress } from './media-space/navigation.js?v=mobile-fix-20261110';

const canvas = document.querySelector('#motion-canvas'), dialog = document.querySelector('#product-dialog');
const menu = document.querySelector('#mobile-nav'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
const mediaHost = document.querySelector('#films'), equipmentSection = document.querySelector('#equipment');
const boot = window.huayuBoot, lifetime = new AbortController();
const readState = () => ({
  lang: document.documentElement.lang.startsWith('zh') ? 'zh' : 'en',
  reducedMotion: reduced.matches, hidden: document.hidden, modalOpen: dialog.open, menuOpen: !menu.hidden,
  preparing: !['ready', 'simplified'].includes(boot.state), simplified: boot.state === 'simplified',
});
let runtime, mediaView, equipment, mediaFallbackListening = false;
const invalidate = () => runtime?.invalidate();
const media = createMediaCoordinator({ readState, invalidate });
const refreshBrandFilm = bindBrandFilm(document.querySelector('#brand-film'), readState);
const root = new Group();
const intro = createIntro({ root, invalidate, brandElement: document.querySelector('#intro-brand') });
const journey = createJourney({ root, teamSection: document.querySelector('#team'), readState, invalidate });
const interaction = createInteraction();
const story = createStory({ host: document.querySelector('#story-host'), root, intro, journey, interaction, readState, invalidate });

function lazyScene(host, renderHost, create) {
  let view, pending;
  async function get() {
    if (view) return view;
    pending ||= create().then(result => {
      if (lifetime.signal.aborted) { result.dispose(); throw new Error('页面已离开'); }
      view = result;
      return view;
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    host, renderHost, get,
    get scene() { return view?.scene; },
    get camera() { return view?.camera; },
    async init() { await (await get()).init(); },
    async prepareEntry() { await (await get()).prepareEntry(); },
    async prepareControls() { (await get()).syncScrollSelection?.(); },
    async retry() { const instance = await get(); await instance.init(); await instance.retry(); },
    resize(size) { view?.resize(size); },
    update(frame) { return view?.update(frame); },
    measureProgress() { return view?.measureProgress?.() ?? null; },
    setActive(active) { view?.setActive(active); },
    setRenderable(active) { view?.setRenderable(active); },
    isContentReady() { return view?.isContentReady() ?? false; },
    dispose() { view?.dispose(); },
  };
}

// 浏览器会在当前文档记住模块加载失败；重试只给失败的模块换一次请求地址。
function retryableImport(path) {
  let attempt = 0;
  return async () => {
    const url = new URL(path, import.meta.url);
    if (attempt) url.searchParams.set('retry', attempt);
    try { return await import(url.href); }
    catch (error) { attempt++; throw error; }
  };
}
const importEquipment = retryableImport('./equipment/equipment.js?v=entry-first-20261112');
const importFilmDialog = retryableImport('./film-dialog.js?v=entry-first-20261112');
const importMedia = retryableImport('./media-space/media-space.js?v=entry-first-20261112');
const importMediaData = retryableImport('./media-space/media-data.js?v=entry-first-20261112');

function showMediaFallback(retryable = false) {
  const status = mediaHost.querySelector('[data-media-status]');
  status.innerHTML = '<span data-zh>影像预览暂不可用，可选择编号观看原片。</span><span data-en>Preview unavailable. Choose a number to watch the original.</span>' +
    (retryable ? '<button class="text-link" type="button" data-media-scene-retry><span data-zh>重新加载</span><span data-en>Reload</span></button>' : '');
  mediaHost.dataset.mediaState = 'failed';
  if (mediaView) { mediaView.setUnavailable(); return; }
  if (mediaFallbackListening) return;
  mediaFallbackListening = true;
  mediaHost.querySelector('[data-media-category]').hidden = true;
  mediaHost.querySelector('.media-static-list').dataset.initialized = 'true';
  const cards = [...mediaHost.querySelectorAll('.media-static-card')];
  function select(index) {
    const card = cards[index];
    const id = card.querySelector('a[data-static-film]').dataset.staticFilm;
    const source = card.querySelector('.media-static-actions a:not([data-static-film])').href;
    for (const other of cards) other.hidden = other !== card;
    for (const button of mediaHost.querySelectorAll('[data-media-select]')) button.setAttribute('aria-pressed', String(button.dataset.mediaSelect === id));
    for (const [target, origin] of [['[data-media-title]', 'h3'], ['[data-media-credit]', 'p']]) {
      mediaHost.querySelector(target).replaceChildren(...[...card.querySelector(origin).childNodes].map(node => node.cloneNode(true)));
    }
    mediaHost.querySelector('[data-media-count]').textContent = `${String(index + 1).padStart(2, '0')} / ${String(cards.length).padStart(2, '0')}`;
    mediaHost.querySelector('[data-media-watch]').href = source;
    mediaHost.querySelector('[data-media-source]').href = source;
  }
  let index = 0;
  select(index);
  mediaHost.addEventListener('click', event => {
    if (mediaView || readState().menuOpen) return;
    const retry = event.target.closest('[data-media-scene-retry]');
    if (retry) { retry.disabled = true; runtime.retryView('media'); return; }
    const trigger = event.target.closest('[data-media-select],[data-media-previous],[data-media-next]');
    if (!trigger) return;
    if (trigger.dataset.mediaSelect) index = cards.findIndex(card => card.querySelector('a[data-static-film]').dataset.staticFilm === trigger.dataset.mediaSelect);
    else index = Math.max(0, Math.min(cards.length - 1, index + (trigger.hasAttribute('data-media-next') ? 1 : -1)));
    select(index);
  }, { signal: lifetime.signal });
}

const equipmentView = lazyScene(document.querySelector('#equipment-host'), null, async () => {
  const [{ createEquipment }, { createFilmDialog }] = await Promise.all([
    importEquipment(), importFilmDialog(),
  ]);
  if (lifetime.signal.aborted) throw new Error('页面已离开');
  media.setDialog(createFilmDialog(dialog, readState, () => { media.sync(); refreshBrandFilm(); }));
  equipment = createEquipment({ host: document.querySelector('#equipment-host'), section: equipmentSection, media, readState, invalidate });
  return equipment;
});
const mediaScene = lazyScene(mediaHost, mediaHost.querySelector('[data-media-stage]'), async () => {
  const [{ createMediaSpace }, { loadMediaItems }] = await Promise.all([
    importMedia(), importMediaData(),
  ]);
  const items = await loadMediaItems();
  if (lifetime.signal.aborted) throw new Error('页面已离开');
  mediaView = createMediaSpace({ host: mediaHost, items, media, readState, invalidate });
  mediaView.setRenderable(false);
  return mediaView;
});

const hero = document.querySelector('#departure');
const sections = [...document.querySelectorAll('[data-story-anchor], main > section, #films')];
const imageSources = section => [...section.querySelectorAll('img[data-asset]')].map(image => image.dataset.asset);
const brand = document.querySelector('#intro-brand');
function setImage(image, src) {
  // 资源层已经解码，不再等待连接到DOM的图片decode。
  if (!image.hasAttribute('src')) image.src = src;
  if (image.parentElement === brand) brand.style.setProperty('--brand-mask', `url("${src}")`);
}
function bindReadyImages(section) {
  for (const image of section.querySelectorAll('img[data-asset]')) {
    try { setImage(image, resolveAssetURL(image.dataset.asset)); }
    catch { /* 未准备的图片留给该章节的加载任务。 */ }
  }
}
async function prepareImages(section, group) {
  await Promise.all([...section.querySelectorAll('img[data-asset]:not([src])')].map(async image => {
    const resource = await loadImage(image.dataset.asset, { group });
    setImage(image, resource.src);
  }));
}

async function entryPlan() {
  const hash = location.hash.slice(1);
  const navigationType = performance.getEntriesByType('navigation')[0]?.type;
  if (navigationType === 'reload' || navigationType === 'back_forward') {
    // 刷新或返回时让浏览器先恢复原来的滚动位置，再选择入口画面。
    if (document.readyState !== 'complete') await new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
  const restored = scrollY > 4 ? sections.findLast(section => {
    const rect = section.getBoundingClientRect();
    return rect.top <= 48 && rect.bottom > 48;
  }) : null;
  const anchor = hash === 'events' ? mediaHost : sections.find(section => section.id === hash);
  const restore = (navigationType === 'reload' || navigationType === 'back_forward') && scrollY > 4;
  const target = restore ? restored : anchor || (!hash && restored) || hero;
  if (!restore && anchor === target && target !== hero)
    (target === mediaHost ? target.closest('[data-media-track]') : target).scrollIntoView({ block: 'start', behavior: 'instant' });
  const assets = target && target.id !== 'team' && target !== equipmentSection ? imageSources(target) : [], animations = [];
  let view = null;
  if (target?.dataset.storyAnchor) {
    view = 'story';
    assets.push(...story.entryAssets());
  } else if (target === equipmentSection) {
    view = 'equipment';
    if (stageInViewport(equipmentView)) assets.push(...imageSources(target), 'model-tufu');
  } else if (target === mediaHost) {
    view = 'media';
    assets.push('media-catalogue');
    if (stageInViewport(mediaScene)) {
      assets.push('model-zidian-hero', 'image-fallback-zidian');
      const track = target.closest('[data-media-track]');
      const choices = [...target.querySelectorAll('[data-media-select]')];
      const progress = scrollProgress(scrollY, track.getBoundingClientRect().top + scrollY, track.offsetHeight, target.offsetHeight);
      animations.push(choices[Math.round(progress * (choices.length - 1))].dataset.mediaSelect);
    }
  }
  return { target, view, assets, animations };
}
let initial;

const demands = new Map(), sectionStates = new Map();
function sectionStatus(section) {
  if (sectionStates.has(section)) return sectionStates.get(section);
  const panel = document.createElement('div');
  panel.className = 'section-resource'; panel.hidden = true;
  panel.innerHTML = '<p role="status"><span data-zh>正在准备画面…</span><span data-en>Preparing the scene…</span></p><button type="button" class="text-link" hidden><span data-zh>重新加载画面</span><span data-en>Reload scene</span></button>';
  const [label, retry] = panel.children;
  (section.querySelector('.scene-copy,.section-heading,.equipment-heading,.media-space-heading') || section).append(panel);
  retry.addEventListener('click', () => demand(section, true), { signal: lifetime.signal });
  const set = state => {
    panel.hidden = state === 'ready';
    retry.hidden = state !== 'failed';
    label.querySelector('[data-zh]').textContent = state === 'failed' ? '部分画面暂不可用。' : '正在准备画面…';
    label.querySelector('[data-en]').textContent = state === 'failed' ? 'Part of this scene is unavailable.' : 'Preparing the scene…';
  };
  sectionStates.set(section, set);
  return set;
}

function demand(section, retry = false) {
  if (readState().preparing || lifetime.signal.aborted || demands.has(section) && !retry) return;
  const simplified = readState().simplified;
  const group = section === equipmentSection ? 'equipment' : section === mediaHost ? 'media' : 'story';
  const journeySection = ['portal', 'court', 'team'].includes(section.id);
  const status = journeySection ? sectionStatus(section) : sectionStates.get(section);
  if (journeySection || retry) status?.('loading');
  const work = [prepareImages(section, group)];
  if (!simplified && journeySection) work.push(journey.prepareSection(section.id));
  if (section === equipmentSection && simplified) work.push(equipmentView.get().then(view => view.showFallback()));
  if (section === equipmentSection && retry && !simplified) {
    const retryView = runtime?.retryView('equipment');
    if (retryView) work.push(retryView.then(ok => { if (!ok) throw new Error('装备画面尚未准备完成'); }));
  }
  if (section === mediaHost) {
    const still = mediaHost.querySelector('[data-racket-fallback]');
    work.push(loadImage(still.dataset.poster, { group }).then(image => setImage(still, image.src)));
    if (simplified) showMediaFallback();
  }
  const task = Promise.all(work).then(() => {
    if (section === equipmentSection && equipmentView.host.dataset.motionError) sectionStatus(section)('failed');
    else status?.('ready');
  }).catch(() => sectionStatus(section)('failed')).finally(invalidate);
  demands.set(section, task);
}

let proximity;
function watchSections() {
  proximity?.disconnect();
  proximity = new IntersectionObserver(items => {
    for (const item of items) if (item.isIntersecting) demand(item.target);
  }, { rootMargin: `${innerHeight}px 0px` });
  for (const section of sections) if (section.dataset.storyAnchor || section === mediaHost || section.querySelector('img[data-asset]')) proximity.observe(section);
}
function afterEntry() {
  watchSections();
  window.addEventListener('resize', watchSections, { passive: true, signal: lifetime.signal });
  // 开场就绪后只提前准备下一段穿场，不把远处装备和图集排进队列。
  if (initial?.target === hero && !readState().simplified) demand(document.querySelector('#portal'));
}

let preparation = null, attempt = 0;
function prepareEntry() {
  if (preparation || ['simplified', 'revealing', 'ready'].includes(boot.state)) return preparation;
  const current = ++attempt;
  boot.start();
  preparation = (async () => {
    const { target, view, assets, animations } = initial ||= await entryPlan();
    await prepareAssets({ assets, animations }, detail => { if (current === attempt) boot.update(detail); });
    if (current !== attempt) return;
    if (target) bindReadyImages(target);
    if (!runtime) {
      runtime = createRuntime({ canvas, readState });
      runtime.start({ story, equipment: equipmentView, media: mediaScene }, { deferEntry: true, onFrame: frame => media.tick(frame.now) });
    }
    await runtime.prepareEntry(view, target?.id, detail => { if (current === attempt) boot.update(detail); });
    if (current !== attempt) return;
    await boot.reveal();
    runtime.enter();
    requestAnimationFrame(afterEntry);
  })().catch(error => {
    if (current === attempt) boot.fail(error);
  }).finally(() => { preparation = null; });
  return preparation;
}

async function simplify() {
  attempt++;
  cancelPreparation('Simplified browsing selected');
  runtime?.cancelPreparation();
  await preparation;
  bindReadyImages(hero);
  if (initial?.target && initial.target !== hero) bindReadyImages(initial.target);
  await boot.reveal(true);
  runtime?.enter({ simplified: true });
  afterEntry();
}

boot.configure({
  async retry() { await preparation; return prepareEntry(); },
  simplify,
});
if (boot.state === 'loading') void prepareEntry();

const stateObserver = new MutationObserver(() => { media.sync(); refreshBrandFilm(); invalidate(); });
stateObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
stateObserver.observe(menu, { attributes: true, attributeFilter: ['hidden'] });
canvas.addEventListener('motion:error', event => {
  if (event.detail.view === 'media') showMediaFallback(true);
  if (event.detail.view === 'equipment') {
    equipmentSection.querySelector('[data-equipment-status]').innerHTML =
      '<span data-zh>展厅暂不可用，可查看下方装备详情。</span><span data-en>The gallery is unavailable. Product details are below.</span>';
    sectionStatus(equipmentSection)('failed');
  }
}, { signal: lifetime.signal });
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  lifetime.abort(); proximity?.disconnect(); stateObserver.disconnect(); cancelPreparation('页面已离开');
  media.dispose();
  if (!runtime) { story.dispose(); equipmentView.dispose(); mediaScene.dispose(); }
});

export { runtime, story, intro, journey, interaction, equipment, mediaView, media, readState };
