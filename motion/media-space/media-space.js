import {
  Scene, PerspectiveCamera, Group, Mesh, Shape, ShapeGeometry, ExtrudeGeometry,
  MeshBasicMaterial, MeshStandardMaterial,
  HemisphereLight, DirectionalLight, PointLight, BufferGeometry, Float32BufferAttribute,
  Points, PointsMaterial, Line, LineBasicMaterial, EdgesGeometry, LineSegments,
  Vector2, Vector3, Box3, Raycaster, FogExp2,
} from 'three';
import { loadModel, promoteAsset, resolveAssetURL } from '../shared/assets.js?v=entry-first-20261112';
import { createAtlasPlayer } from '../shared/atlas.js?v=entry-first-20261112';
import { bindSurface } from '../shared/surface-input.js';
import { disposeTree } from '../shared/dispose.js';
import { createFilmNavigation, filmPose, mediaFraming, scrollProgress } from './navigation.js?v=mobile-fix-20261110';
import { createHeroEnvironment } from './hero-light.js?v=zidian-hero-20261108-r3';

const RACKET_URL = new URL('./assets/zidian-hero.meshopt.glb?v=zidian-hero-20261108-r3', import.meta.url);
const SPIN_SPEED = Math.PI * 2 / 40;
const words = {
  zh: {
    daily: '日常', training: '训练互动', behind: '幕后', watch: '查看原片',
    previous: '上一部', next: '下一部', source: '原发布页', navigation: '选择日常影像',
    surface: '紫电青霜影像空间，滚动浏览；左右方向键选择，回车观看',
    help: '向下滚动，环绕紫电青霜。点击影像，走近这一刻。',
    note: '华羽日常社 · 球场里的我们',
    unavailable: '预览暂不可用，仍可观看完整影片。',
    loading: '三维影像加载中，仍可选择和观看影片。', retry: '重新加载',
  },
  en: {
    daily: 'Daily life', training: 'On court', behind: 'Behind the scenes', watch: 'View original',
    previous: 'Previous film', next: 'Next film', source: 'Original upload', navigation: 'Choose a daily film',
    surface: 'Zidian Qingshuang film space. Scroll to explore; arrow keys select, Enter opens the film.',
    help: 'Scroll around Zidian Qingshuang. Select a film to step closer.',
    note: 'Huayu Daily · Life around the court',
    unavailable: 'Preview unavailable. The full film is still accessible.',
    loading: 'Loading the scene. Film links remain available.', retry: 'Reload',
  },
};

function roundedShape(width, height, radius) {
  const x = -width / 2, y = -height / 2, shape = new Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

function screenGeometry(aspect) {
  const geometry = new ShapeGeometry(roundedShape(aspect, 1, .026), 8);
  const position = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / aspect + .5, position.getY(i) + .5);
  return geometry;
}

export function createMediaSpace({ host, items, media, readState, invalidate }) {
  const track = host.closest('[data-media-track]');
  const stage = host.querySelector('[data-media-stage]');
  const scene = new Scene();
  scene.fog = new FogExp2(0x080710, .018);
  const camera = new PerspectiveCamera(44, 1, .1, 100);
  const root = new Group(), field = new Group(), axis = new Group();
  const projectionProbe = new Group();
  scene.add(root); root.add(axis); axis.add(field);
  const events = new AbortController(), navigation = createFilmNavigation(items.length);
  const raycaster = new Raycaster(), point = new Vector2(), corner = new Vector3();
  const title = host.querySelector('[data-media-title]'), category = host.querySelector('[data-media-category]');
  const credit = host.querySelector('[data-media-credit]'), watch = host.querySelector('[data-media-watch]');
  const source = host.querySelector('[data-media-source]'), counter = host.querySelector('[data-media-count]');
  const status = host.querySelector('[data-media-status]');
  const fallbackRacket = host.querySelector('[data-racket-fallback]');
  const fallbackCards = [...host.querySelectorAll('.media-static-card')];
  host.querySelector('.media-static-list').dataset.initialized = 'true';
  const retryButton = document.createElement('button');
  retryButton.type = 'button'; retryButton.dataset.mediaRetry = ''; retryButton.hidden = true;
  stage.append(retryButton);
  const choices = [...host.querySelectorAll('[data-media-select]')];
  const on = (target, type, fn, options = {}) => target.addEventListener(type, fn, { ...options, signal: events.signal });
  const records = items.map((item, index) => {
    const record = { item, index, aspect: item.sourceSize[0] / item.sourceSize[1], player: null, poster: null, texture: null,
      panel: null, screen: null, border: null, body: null, failed: false, posterError: null, posterPending: null, distance: index,
      visible: false, bounds: null, height: 1, opacity: 0 };
    record.player = createAtlasPlayer(item.animationId || item.id, { texture: true, onFrame(texture) {
      record.texture = texture;
      if (record.screen) {
        const firstMap = !record.screen.material.map;
        record.screen.material.map = texture;
        if (firstMap) record.screen.material.needsUpdate = true;
      }
      invalidate();
    } });
    const card = fallbackCards[index];
    if (card) {
      const oldImage = card.querySelector('img');
      if (oldImage) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', oldImage.alt);
        canvas.dataset.atlasStill = item.id; oldImage.replaceWith(canvas);
      }
      const canvas = card.querySelector('canvas');
      if (canvas) {
        canvas.dataset.ariaZh = item.title.zh + '动态片段';
        canvas.dataset.ariaEn = item.title.en + ' preview';
      }
    }
    return record;
  });
  let ready = false, disposed = false, unavailable = false, active = false, renderable = false, entered = false, signature = '';
  let racketPending = null, racketError = null;
  let width = 1, height = 1, axisX = 0, radiusX = 6, radiusZ = 3, racket = null, spin = null;
  let spinAngle = 0, spinActive = false, spinLastTime = null, sweptRadius = 0, racketBounds = null, frontHeight = 0;
  let racketAspect = .32, environment = null, compact = false;
  let tilt = 0, spanY = 1, spanX = 1, projectionOffsetX = 0;
  const modelCorners = [], modelPoint = new Vector3();
  let language = '', selectedBefore = -1, staticView = true, lastProgress = 0;
  let cameraMoving = false, scrollFrame = null;
  let scrollIdle = .18, layoutProgress = null;
  track.style.setProperty('--film-steps', String(items.length - 1));

  function describe() {
    const lang = readState().lang === 'en' ? 'en' : 'zh';
    const { selected } = navigation.read();
    const record = records[selected], item = record.item, text = words[lang];
    language = lang; selectedBefore = selected;
    stage.tabIndex = 0; stage.setAttribute('role', 'group'); stage.setAttribute('aria-label', text.surface);
    stage.setAttribute('aria-describedby', 'media-help');
    title.textContent = item.title[lang]; category.textContent = text[item.category];
    credit.textContent = item.credit[lang];
    watch.href = item.sourceUrl; watch.target = '_blank'; watch.rel = 'noopener noreferrer'; watch.dataset.filmId = item.id;
    watch.querySelector('[data-media-watch-label]').textContent = text.watch;
    source.href = item.sourceUrl; source.textContent = text.source;
    counter.textContent = String(selected + 1).padStart(2, '0') + ' / ' + String(items.length).padStart(2, '0');
    host.querySelector('[data-media-help]').textContent = text.help;
    host.querySelector('[data-media-note]').textContent = text.note;
    host.querySelector('.media-space-navigation').setAttribute('aria-label', text.navigation);
    for (const choice of choices) {
      const index = items.findIndex(candidate => candidate.id === choice.dataset.mediaSelect);
      const choiceItem = items[index];
      choice.querySelector('.media-choice-title').textContent = choiceItem.title[lang];
      choice.setAttribute('aria-label', choiceItem.title[lang]);
      choice.setAttribute('aria-pressed', String(index === selected));
      const canvas = fallbackCards[index]?.querySelector('canvas');
      if (canvas) canvas.setAttribute('aria-label', lang === 'en' ? canvas.dataset.ariaEn : canvas.dataset.ariaZh);
    }
    host.querySelector('[data-media-previous]').setAttribute('aria-label', text.previous);
    host.querySelector('[data-media-next]').setAttribute('aria-label', text.next);
    host.dataset.selectedFilm = item.id;
    const failures = Boolean(racketError || record.posterError || record.failed);
    status.textContent = unavailable || failures ? text.unavailable : isContentReady() ? '' : text.loading;
    retryButton.textContent = text.retry;
    retryButton.hidden = !failures;
    syncFallbacks();
  }

  function syncPresentation() {
    const nextStatic = !ready || !renderable || unavailable || disposed;
    // 首次有效绘制之前也必须允许场景被renderer绘制，否则无法退出占位。
    root.visible = ready && !disposed;
    if (staticView === nextStatic && track.dataset.mediaMotion !== undefined) return false;
    staticView = nextStatic;
    // 布局与资源/GPU状态解耦；静帧和三维始终共用同一舞台与滚动轨道。
    track.dataset.mediaMotion = 'true';
    host.dataset.mediaMotion = 'true';
    host.dataset.mediaRenderable = String(!staticView);
    describe();
    invalidate();
    return true;
  }

  function syncFallbacks() {
    fallbackRacket.hidden = !staticView && Boolean(racket);
    if (racketBounds && Number.isFinite(racketBounds.left)) {
      fallbackRacket.style.left = `${racketBounds.left}px`; fallbackRacket.style.top = `${racketBounds.top}px`;
      fallbackRacket.style.width = `${racketBounds.right - racketBounds.left}px`;
      fallbackRacket.style.height = `${racketBounds.bottom - racketBounds.top}px`;
      fallbackRacket.style.transform = 'none';
    }
    const current = navigation.read().selected;
    for (let index = 0; index < fallbackCards.length; index++) {
      const card = fallbackCards[index], record = records[index], bounds = record.bounds;
      card.hidden = (!staticView && Boolean(record.poster)) || (bounds ? !record.visible : index !== current);
      const canvas = card.querySelector('canvas');
      if (canvas) canvas.hidden = Boolean(record.posterError);
      card.dataset.posterFailed = String(Boolean(record.posterError));
      if (bounds) {
        card.style.left = `${bounds.left}px`; card.style.top = `${bounds.top}px`;
        card.style.width = `${bounds.right - bounds.left}px`; card.style.height = `${bounds.bottom - bounds.top}px`;
        card.style.opacity = String(record.opacity);
        card.style.transform = 'none';
      }
    }
  }

  function measureProgress() {
    const top = track.getBoundingClientRect().top + scrollY;
    const distance = Math.max(0, track.offsetHeight - host.offsetHeight);
    if (layoutProgress && scrollY !== layoutProgress.y) layoutProgress = null;
    const p = layoutProgress?.p ?? scrollProgress(scrollY, top, track.offsetHeight, host.offsetHeight);
    scrollFrame = { width: innerWidth, height: innerHeight, p,
      inside: scrollY >= top - 1 && scrollY <= top + distance + 1 };
    return { p };
  }

  function restoreProgress(previous) {
    layoutProgress = null;
    // 窗口或语言变化会重排上方页面；统一按原进度恢复章节内的位置。
    if (previous?.inside) {
      const top = track.getBoundingClientRect().top + scrollY;
      const distance = Math.max(0, track.offsetHeight - host.offsetHeight);
      window.scrollTo({ top: top + distance * previous.p, behavior: 'instant' });
      // 浏览器会把新坐标取整；保留逻辑进度，直到页面真正再次滚动。
      layoutProgress = { y: scrollY, p: previous.p };
    }
    measureProgress();
  }

  on(window, 'resize', () => {
    const previous = scrollFrame;
    if (!previous || (previous.width === innerWidth && previous.height === innerHeight)) return;
    restoreProgress(previous);
    invalidate();
  }, { passive: true });

  function select(index) {
    if (disposed || readState().menuOpen) return;
    layoutProgress = null;
    index = Math.max(0, Math.min(items.length - 1, index));
    if (records[index].failed) {
      records[index].failed = false; signature = '';
      if (index === navigation.read().selected) describe();
    }
    const top = track.getBoundingClientRect().top + scrollY;
    const distance = Math.max(0, track.offsetHeight - host.offsetHeight);
    const progress = index / (items.length - 1);
    if (staticView || !active) {
      navigation.setProgress(progress); navigation.update(0, true);
      if (ready) update({ dt: 0, state: readState(), progress: { p: progress } });
      describe();
    }
    void loadSelected(index, true);
    window.scrollTo({ top: top + distance * progress, behavior: staticView || readState().reducedMotion ? 'instant' : 'smooth' });
    invalidate();
  }

  function open(index, trigger) {
    if (disposed || readState().menuOpen) return;
    media.openFilm(records[index].item, trigger);
  }

  function submitPreviews() {
    if (disposed) return;
    const state = readState();
    const enabled = ready && isContentReady() && active && !staticView && !state.reducedMotion && !state.hidden && !state.modalOpen && !state.menuOpen;
    const selected = navigation.read().selected;
    const limit = compact || matchMedia('(pointer: coarse)').matches ? 1 : 2;
    const front = records[selected];
    const exposed = record => {
      if (record === front || !front.bounds || record.panel.position.z >= front.panel.position.z) return true;
      const a = record.bounds, b = front.bounds;
      return !(a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom);
    };
    const eligible = enabled ? records.filter(record => record.visible && !record.failed && exposed(record))
      .sort((a, b) => Number(b.index === selected) - Number(a.index === selected) || a.distance - b.distance)
      .slice(0, limit) : [];
    const list = records.map(record => ({ id: record.item.id, player: record.player,
      visible: eligible.includes(record) && record.player.ready,
      selected: record.index === selected, distance: record.distance }));
    const nextSignature = list.map(record => record.id + ':' + record.visible + ':' + record.selected).join('|');
    if (signature !== nextSignature) { signature = nextSignature; media.setPreviews(list); }
  }

  const surface = bindSurface(stage, {
    isBlocked: () => disposed || readState().modalOpen || readState().menuOpen,
    invalidate,
    onTap({ x, y, trigger }) {
      if (!ready || staticView) return;
      root.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      point.set(x, y); raycaster.setFromCamera(point, camera);
      const surfaces = records.filter(record => record.visible && record.opacity > .1).flatMap(record => [record.screen, record.body]);
      const hit = raycaster.intersectObjects(racket ? [...surfaces, racket] : surfaces, true)[0];
      if (!hit) return;
      const record = records.find(record => record.screen === hit.object || record.body === hit.object);
      if (!record) return;
      const index = record.index;
      if (index === navigation.read().selected) open(index, trigger);
      else select(index);
    },
    onKey(event) {
      const current = navigation.read().selected;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') select(current + 1);
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') select(current - 1);
      else if (event.key === 'Home') select(0);
      else if (event.key === 'End') select(items.length - 1);
      else if (event.key === 'Enter' || event.key === ' ') open(current, stage);
      else return false;
      return true;
    },
  });
  for (const button of choices) on(button, 'click', () => select(items.findIndex(item => item.id === button.dataset.mediaSelect)));
  on(host.querySelector('[data-media-previous]'), 'click', () => select(navigation.read().selected - 1));
  on(host.querySelector('[data-media-next]'), 'click', () => select(navigation.read().selected + 1));
  on(watch, 'click', event => { event.preventDefault(); open(navigation.read().selected, watch); });
  on(retryButton, 'click', () => { void retry(); });
  on(window, 'online', () => { if (active) void retry(); });
  on(window, 'scroll', () => {
    if (!staticView || readState().menuOpen) return;
    const progress = measureProgress();
    navigation.setProgress(progress.p); navigation.update(0, true);
    if (ready) update({ dt: 0, state: readState(), progress });
    else describe();
  }, { passive: true });
  on(host, 'click', event => {
    const link = event.target.closest('[data-static-film]');
    if (!link) return;
    const index = items.findIndex(item => item.id === link.dataset.staticFilm);
    if (index >= 0) { event.preventDefault(); open(index, link); }
  });
  const languageObserver = new MutationObserver(() => {
    const previous = scrollFrame;
    describe(); restoreProgress(previous); invalidate();
  });
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  function setUnavailable() {
    if (disposed) return;
    unavailable = true; renderable = false; spinActive = false; spinLastTime = null;
    media.setPreviews([]); surface.reset();
    delete host.dataset.motionReady; host.dataset.mediaState = 'failed';
    syncPresentation(); describe();
  }

  function setRenderable(value) {
    if (disposed) return;
    renderable = Boolean(value);
    if (value) unavailable = false;
    if (!value) { spinActive = false; spinLastTime = null; media.setPreviews([]); signature = ''; }
    syncPresentation();
  }

  function buildLightfield() {
    environment = createHeroEnvironment(); scene.environment = environment; scene.environmentIntensity = .7;
    scene.add(new HemisphereLight(0xd7d2ef, 0x292035, 2.0));
    const key = new DirectionalLight(0xfff2e8, 3.8); key.position.set(-7, 9, 12); scene.add(key);
    const rim = new DirectionalLight(0xac80ff, 5); rim.position.set(7, 4, -8); scene.add(rim);
    const back = new DirectionalLight(0xe3e1ff, 3.5); back.position.set(-5, -2, -12); scene.add(back);
    const violet = new PointLight(0x8744ff, 24, 36, 2); violet.position.set(-6, 2, 6); scene.add(violet);
    const red = new PointLight(0xf05075, 10, 30, 2); red.position.set(7, -4, 5); scene.add(red);
    const positions = [], colors = [];
    let seed = 29;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    for (let i = 0; i < 360; i++) {
      const y = random() * 2 - 1, angle = y * Math.PI * 5 + random() * .9;
      const radius = .7 + random() * .5;
      positions.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius - .3);
      colors.push(.44 + random() * .32, .24 + random() * .16, .72 + random() * .25);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    field.add(new Points(geometry, new PointsMaterial({ size: .045, vertexColors: true, transparent: true, opacity: .6, depthWrite: false })));
    for (let strand = 0; strand < 2; strand++) {
      const points = [];
      for (let i = 0; i <= 100; i++) {
        const y = i / 100 * 2 - 1, angle = y * Math.PI * 2.1 + strand * Math.PI;
        points.push(new Vector3(Math.cos(angle), y, Math.sin(angle) - .3));
      }
      field.add(new Line(new BufferGeometry().setFromPoints(points),
        new LineBasicMaterial({ color: strand ? 0xa64570 : 0x7953b3, transparent: true, opacity: .2, depthWrite: false })));
    }
  }

  function attachRacket(gltf) {
    const bounds = new Box3().setFromObject(gltf.scene), center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    racketAspect = size.x / size.y;
    gltf.scene.position.sub(center);
    const normalized = new Group(); normalized.add(gltf.scene); normalized.scale.setScalar(1 / size.y);
    spin = new Group(); spin.name = 'ZidianSelfRotation'; spin.add(normalized);
    racket = new Group(); racket.name = 'ZidianQingshuangAxis'; racket.add(spin); axis.add(racket);
    racket.rotation.z = -Math.PI / 60;
    normalized.updateMatrixWorld(true);
    gltf.scene.traverse(object => {
      if (!object.geometry) return;
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        modelCorners.push({ object, point: new Vector3(x,y,z) });
      }
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material?.map) material.map.anisotropy = 4;
      }
    });
  }

  function setupScene() {
    if (ready || disposed) return;
    buildLightfield();
    for (const record of records) {
      const panel = record.panel = new Group(); panel.name = 'DailyFilm-' + record.item.id;
      const bodyGeometry = new ExtrudeGeometry(roundedShape(record.aspect + .028, 1.028, .04),
        { depth: .018, bevelEnabled: true, bevelThickness: .006, bevelSize: .006, bevelSegments: 2, steps: 1, curveSegments: 8 });
      record.body = new Mesh(bodyGeometry, new MeshStandardMaterial({
        color: 0x21182d, metalness: .65, roughness: .23, emissive: 0x20112d, emissiveIntensity: .28, transparent: true, depthWrite: false,
      }));
      const screen = record.screen = new Mesh(screenGeometry(record.aspect),
        new MeshBasicMaterial({ map: record.poster, toneMapped: false, fog: false, transparent: true }));
      screen.position.z = .027; screen.userData.index = record.index;
      record.border = new LineSegments(new EdgesGeometry(bodyGeometry, 30),
        new LineBasicMaterial({ color: 0x8b659f, transparent: true, opacity: .55, depthWrite: false }));
      panel.add(record.body, screen, record.border); axis.add(panel);
    }
    ready = true; resize({ width, height }); syncPresentation(); invalidate();
  }

  function loadRacket(retryFailed = false) {
    if (disposed || racket || unavailable) return Promise.resolve();
    if (racketPending) { promoteAsset(RACKET_URL.href, { group: 'media', kind: 'model', priority: -1 }); return racketPending; }
    if (racketError && !retryFailed) return Promise.resolve();
    racketError = null;
    racketPending = loadModel(RACKET_URL.href, { group: 'media', priority: 0 }).then(gltf => {
      if (disposed) { disposeTree(gltf.scene); return; }
      attachRacket(gltf); resize({ width, height });
    }).catch(error => { if (!disposed) racketError = String(error); }).finally(() => {
      racketPending = null;
      if (!disposed) { describe(); invalidate(); }
    });
    return racketPending;
  }

  function loadPoster(record, retryFailed = false) {
    if (disposed || record.poster) return Promise.resolve();
    if (record.posterPending) return record.posterPending;
    if (record.posterError && !retryFailed) return Promise.resolve();
    record.posterError = null;
    record.posterPending = record.player.prepare({ group: 'media' }).then(() => {
      if (disposed) return;
      record.poster = record.player.texture;
      record.player.draw(fallbackCards[record.index]?.querySelector('canvas'), 0);
    }).catch(error => { if (!disposed) record.posterError = String(error); }).finally(() => {
      record.posterPending = null;
      if (!disposed) { describe(); invalidate(); }
    });
    return record.posterPending;
  }

  async function loadSelected(index = navigation.read().selected, retryFailed = false) {
    await Promise.all([loadRacket(retryFailed), loadPoster(records[index], retryFailed)]);
    if (disposed) return;
    host.dataset.mediaState = unavailable ? 'failed' : racketError || records[navigation.read().selected].posterError
      ? 'degraded' : isContentReady() ? 'ready' : 'loading';
    describe(); invalidate();
  }

  async function retry() {
    if (disposed) return;
    const selected = navigation.read().selected;
    records[selected].failed = false; signature = '';
    await loadSelected(selected, true);
  }

  function isContentReady() {
    return ready && !disposed && Boolean(racket && records[navigation.read().selected].poster);
  }

  function syncScrollSelection() {
    navigation.setProgress(measureProgress().p);
    navigation.update(0, true);
    describe();
  }

  async function init() {
    if (disposed) return;
    setupScene();
    host.dataset.mediaState = 'loading';
    syncScrollSelection();
    await loadSelected();
  }

  async function prepareEntry() {
    unavailable = false;
    await init();
    if (!isContentReady()) throw new Error(racketError || records[navigation.read().selected].posterError || '当前影像尚未准备完成');
  }

  async function prepareAvailable() {
    unavailable = true; renderable = false; active = false;
    const result = { ready: [], failed: [] };
    for (const record of records) {
      try {
        record.player.prepareStill();
        record.player.draw(fallbackCards[record.index]?.querySelector('canvas'), 0);
        record.posterError = null; result.ready.push(record.item.id);
      } catch (error) {
        record.posterError = String(error.message || error);
        result.failed.push({ id: record.item.id, message: record.posterError });
      }
    }
    const fallbackSource = fallbackRacket.dataset.asset || fallbackRacket.dataset.poster;
    if (fallbackSource && !fallbackRacket.hasAttribute('src')) {
      try { fallbackRacket.src = resolveAssetURL(fallbackSource); }
      catch { /* 简化模式缺少球拍静帧不阻挡其他已缓存片段。 */ }
    }
    describe(); invalidate(); return result;
  }

  function resize(viewport) {
    width = viewport.width; height = viewport.height;
    camera.aspect = width / height;
    camera.position.set(0, 0, 16); camera.lookAt(0, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    compact = innerWidth < 1024;
    const framing = mediaFraming(width, height, racketAspect);
    ({ spanY, spanX, tilt, sweptRadius, radiusX, radiusZ } = framing);
    axis.rotation.z = tilt;
    axisX = 0;
    const scale = framing.scale;
    frontHeight = scale / spanY;
    if (racket) {
      racket.rotation.z = -Math.PI / 60;
      racket.position.set(axisX, -spanY * .25, 0);
      racket.scale.setScalar(scale);
    }
    for (const record of records) {
      const fraction = Math.min(.42, width / height * .39 / record.aspect);
      record.height = framing.frontSpanY * fraction;
    }
    // 取景仅补偿主片的实际越界；所有影片共用同一补偿，选片时镜头不横跳。
    camera.clearViewOffset(); camera.updateProjectionMatrix();
    let rightmost = 0;
    for (const record of records) {
      const placement = placePanel(record, record.index);
      projectionProbe.position.set(placement.x, placement.y, placement.z);
      projectionProbe.rotation.set(0, placement.pose.rotationY, placement.pose.rotationZ);
      projectionProbe.scale.setScalar(record.height); projectionProbe.updateMatrixWorld(true);
      for (const x of [-record.aspect / 2, record.aspect / 2]) for (const y of [-.5, .5]) {
        corner.set(x, y, .027).applyMatrix4(projectionProbe.matrixWorld).project(camera);
        rightmost = Math.max(rightmost, (corner.x + 1) * width / 2);
      }
    }
    projectionOffsetX = Math.max(0, rightmost - width + Math.min(16, width * .04));
    if (projectionOffsetX > 0) camera.setViewOffset(width, height, projectionOffsetX, 0, width, height);
    camera.updateProjectionMatrix();
    field.position.set(axisX, 0, -1.2);
    field.scale.set(radiusX * 1.12, spanY * .55, radiusZ * 1.4);
    invalidate();
  }

  function placePanel(record, phase) {
    const pose = filmPose(record.index, phase, records.length);
    const x = axisX + pose.x * radiusX;
    const halfWidth = record.height * pose.scale * record.aspect / 2;
    const halfHeight = record.height * pose.scale / 2;
    const footprint = Math.abs(Math.cos(pose.rotationZ)) * halfWidth + Math.abs(Math.sin(pose.rotationZ)) * halfHeight;
    const thickness = record.height * pose.scale * .04;
    const halfX = Math.abs(Math.cos(pose.rotationY)) * footprint + thickness;
    const halfZ = Math.abs(Math.sin(pose.rotationY)) * footprint + thickness;
    const nearX = Math.max(0, Math.abs(x - axisX) - halfX);
    const clearRadius = sweptRadius + halfZ + .35;
    const clearZ = Math.sqrt(Math.max(0, clearRadius * clearRadius - nearX * nearX));
    const z = Math.sign(pose.z) * Math.max(Math.abs(pose.z * radiusZ), clearZ);
    return { pose, x, y: pose.y * 1.3 - .5, z,
      clearance: Math.hypot(nearX, Math.max(0, Math.abs(z) - halfZ)) - sweptRadius };
  }

  function update(frame) {
    syncPresentation();
    if (!ready || disposed) { spinActive = false; spinLastTime = null; submitPreviews(); return false; }
    if (language !== frame.state.lang) describe();
    const progress = frame.progress || measureProgress();
    if (!frame.state.menuOpen) {
      if (Math.abs(progress.p - lastProgress) > .0000001) scrollIdle = 0;
      else scrollIdle += frame.dt;
      navigation.setProgress(progress.p);
    }
    lastProgress = progress.p;
    const moving = frame.state.menuOpen ? false : navigation.update(frame.dt, frame.state.reducedMotion || staticView);
    spinActive = active && !staticView && Boolean(spin) && !frame.state.reducedMotion && !frame.state.hidden && !frame.state.modalOpen && !frame.state.menuOpen;
    // 自转周期按可见活动时间计时；导航的dt限幅不应让低帧率下的40秒周期变慢。
    if (spinActive) {
      if (spinLastTime !== null) spinAngle = (spinAngle + Math.max(0, frame.now - spinLastTime) * SPIN_SPEED) % (Math.PI * 2);
      spinLastTime = frame.now;
    } else spinLastTime = null;
    if (spin) spin.rotation.y = spinAngle;
    const current = navigation.read(), raw = surface.read();
    if (selectedBefore !== current.selected) describe();
    // 按钮会直接请求目标；滚动途经的片位等停稳再准备，避免跳选时下载中间图集。
    const destination = records[Math.round(current.target)];
    const waitingForScroll = !frame.state.preparing && !frame.state.menuOpen &&
      !destination.poster && !destination.posterPending && !destination.posterError;
    if (waitingForScroll && scrollIdle >= .18) void loadSelected(destination.index);
    const parallax = !compact && !frame.state.reducedMotion && !staticView && raw.inside && raw.pointerType === 'mouse' && !frame.state.menuOpen;
    const targetX = parallax ? raw.x * .16 : 0, targetY = parallax ? raw.y * .10 : 0;
    const damping = 1 - Math.exp(-frame.dt * 8);
    if (frame.state.reducedMotion) { camera.position.x = targetX; camera.position.y = targetY; }
    if (!frame.state.menuOpen) {
      camera.position.x += (targetX - camera.position.x) * damping;
      camera.position.y += (targetY - camera.position.y) * damping;
    }
    cameraMoving = !frame.state.menuOpen && Math.abs(targetX - camera.position.x) + Math.abs(targetY - camera.position.y) > .0005;
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    root.updateMatrixWorld(true);
    racketBounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const entry of modelCorners) {
      modelPoint.copy(entry.point).applyMatrix4(entry.object.matrixWorld).project(camera);
      const x = (modelPoint.x + 1) * width / 2, y = (1 - modelPoint.y) * height / 2;
      racketBounds.left = Math.min(racketBounds.left,x); racketBounds.right = Math.max(racketBounds.right,x);
      racketBounds.top = Math.min(racketBounds.top,y); racketBounds.bottom = Math.max(racketBounds.bottom,y);
    }
    const rect = stage.getBoundingClientRect();
    for (const record of records) {
      const placement = placePanel(record, current.phase), { pose } = placement;
      record.clearance = placement.clearance;
      record.panel.position.set(placement.x, placement.y, placement.z);
      record.panel.rotation.set(0, pose.rotationY, pose.rotationZ);
      record.panel.scale.setScalar(record.height * pose.scale);
      record.panel.visible = pose.opacity > .02;
      record.opacity = pose.opacity;
      record.body.material.opacity = pose.opacity * .72;
      record.screen.material.opacity = pose.opacity;
      record.screen.material.color.setScalar(record.poster ? 1 : .12);
      record.screen.material.depthWrite = pose.opacity > .95;
      record.border.material.opacity = pose.opacity * (record.index === current.selected ? .85 : .45);
      record.border.material.color.setHex(record.index === current.selected ? 0xd67897 : 0x83619d);
      const map = record.texture || record.poster;
      if (record.screen.material.map !== map) { record.screen.material.map = map; record.screen.material.needsUpdate = true; }
      record.panel.updateMatrixWorld(true);
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const x of [-record.aspect / 2, record.aspect / 2]) for (const y of [-.5, .5]) {
        corner.set(x, y, .027).applyMatrix4(record.panel.matrixWorld).project(camera);
        const px = (corner.x + 1) * width / 2, py = (1 - corner.y) * height / 2;
        left = Math.min(left, px); right = Math.max(right, px); top = Math.min(top, py); bottom = Math.max(bottom, py);
      }
      record.bounds = { left, right, top, bottom }; record.distance = pose.distance;
      record.visible = record.panel.visible && right > 0 && left < width && bottom > 0 && top < height && bottom + rect.top > 0 && top + rect.top < innerHeight;
    }
    syncFallbacks();
    submitPreviews();
    return spinActive || moving || cameraMoving || waitingForScroll && scrollIdle < .18 ||
      records.some(record => record.player.inspect().active);
  }

  function setActive(value) {
    const wasActive = active;
    active = value;
    if (!value) { surface.reset(); spinActive = false; spinLastTime = null; }
    else if (!wasActive) {
      if (entered) void retry();
      else entered = true;
    }
    submitPreviews();
  }

  function dispose() {
    if (disposed) return;
    setUnavailable(); disposed = true; active = false; spinLastTime = null;
    media.setPreviews([]); surface.dispose(); events.abort(); languageObserver.disconnect();
    for (const record of records) {
      record.player.dispose();
      if (record.screen) record.screen.material.map = null;
    }
    disposeTree(scene);
    environment?.dispose(); scene.environment = null;
    delete host.dataset.motionReady; host.dataset.mediaState = 'disposed';
  }

  syncPresentation();
  return {
    host, renderHost: stage, scene, camera, init, prepareEntry, prepareAvailable, syncScrollSelection, resize, update, measureProgress, setActive, dispose, setUnavailable, setRenderable, retry, isContentReady,
    selectFilm: id => select(items.findIndex(item => item.id === id)),
    inspect: () => ({
      ready, disposed, unavailable, active, staticView, renderable, contentReady: isContentReady(), progress: lastProgress, ...navigation.read(),
      failedResources: [racketError && 'racket', ...records.filter(record => record.posterError).map(record => record.item.id)].filter(Boolean),
      selectedId: records[navigation.read().selected].item.id, camera: camera.position.toArray(), viewport: { width, height },
      input: { ...surface.read() }, racketReady: Boolean(racket), racketPosition: racket?.position.toArray(),
      racketAngle: spinAngle, racketSpinActive: spinActive, racketBounds, frontHeight, sweptRadius, spinPeriod: 40,
      layout: { compact, tilt, resting: scrollIdle >= .18, stage: stage.getBoundingClientRect().toJSON(),
        heading: host.querySelector('.media-space-heading').getBoundingClientRect().toJSON(),
        information: host.querySelector('[data-media-footer]').getBoundingClientRect().toJSON(), radiusX, radiusZ, projectionOffsetX },
      panels: records.map(record => ({ id: record.item.id, aspect: record.aspect, position: record.panel?.position.toArray(),
        rotation: record.panel?.rotation.toArray(), bounds: record.bounds, visible: record.visible, opacity: record.opacity,
        animation: record.player.inspect(), loaded: record.player.ready, paused: !record.player.inspect().active, failed: record.failed,
        posterReady: Boolean(record.poster), posterError: record.posterError, posterPending: Boolean(record.posterPending), clearance: record.clearance })),
    }),
  };
}
