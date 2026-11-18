import { WebGLRenderer, SRGBColorSpace, ACESFilmicToneMapping } from 'three';
import { setAssetFocus, inspectAssets } from './assets.js?v=entry-first-20261112';

export function stageInViewport(view) {
  const rect = (view.renderHost || view.host).getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

export function createRuntime({ canvas, readState }) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 0);
  const entries = [];
  const listeners = new AbortController();
  const coarse = matchMedia('(pointer: coarse)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const frames = [];
  let started = false, disposed = false, running = false, dirty = true;
  let width = 0, height = 0, dpr = 0, lastTick = null, tickCount = 0;
  let contextAvailable = true;
  let deferred = false, prepared = false, simplified = false, frameHook = null;
  let preparing = null, preparationController = null;

  function invalidate() {
    if (disposed || !started || !contextAvailable) return;
    dirty = true;
    if (deferred || simplified) return;
    if (!running) {
      running = true;
      lastTick = null;
      renderer.setAnimationLoop(tick);
    }
  }

  function init(entry, retry = false) {
    if (entry.status !== 'new' && !(retry && entry.status === 'failed')) return;
    const retrying = entry.status === 'failed';
    entry.status = 'loading';
    entry.error = null;
    delete entry.view.host.dataset.motionError;
    return Promise.resolve().then(() => retrying && entry.view.retry ? entry.view.retry() : entry.view.init()).then(() => {
      if (disposed) return;
      entry.status = 'ready';
      invalidate();
      return true;
    }).catch(error => {
      if (disposed) return;
      entry.status = 'failed';
      entry.error = String(error);
      entry.view.host.dataset.motionError = entry.error;
      entry.view.setRenderable?.(false);
      console.error(`[motion:${entry.name}]`, error);
      canvas.dispatchEvent(new CustomEvent('motion:error', { detail: { view: entry.name, error: entry.error } }));
      invalidate();
      return false;
    });
  }

  function tick(timestamp, primeFrame = false) {
    const priming = primeFrame === true;
    if (disposed || !contextAvailable || deferred && !priming || simplified) return;
    dirty = false;
    const state = priming ? { ...readState(), preparing: true, hidden: false } : readState();
    const viewport = {
      width: innerWidth, height: innerHeight,
      dpr: Math.min(devicePixelRatio || 1, coarse.matches || innerWidth < 768 ? 1.25 : 1.5),
    };
    if (width !== viewport.width || height !== viewport.height || dpr !== viewport.dpr) {
      ({ width, height, dpr } = viewport);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
    }
    // 一次读取所有布局，再更新场景；不把 scissor 裁切宽高当成相机尺寸。
    const layout = entries.map(entry => ({ entry,
      hostRect: entry.view.host.getBoundingClientRect(),
      rect: (entry.view.renderHost || entry.view.host).getBoundingClientRect(),
      progress: entry.view.measureProgress?.() ?? null }));
    const visible = item => item.hostRect.width > 0 && item.hostRect.height > 0 && item.hostRect.bottom > 0 && item.hostRect.top < height;
    const focused = layout.filter(visible).sort((a,b) => Math.abs(a.hostRect.top) - Math.abs(b.hostRect.top));
    const near = layout.filter(({ hostRect }) => hostRect.bottom > -height && hostRect.top < height * 2);
    if (!priming) setAssetFocus(state.hidden ? [] : [...new Set([...focused, ...near].map(item => item.entry.name))]);
    let animate = false;
    if (frameHook && !priming) animate = Boolean(frameHook({ now: timestamp / 1000,
      dt: lastTick === null ? 0 : Math.min(.05, Math.max(0, (timestamp - lastTick) / 1000)),
      state, viewport })) || animate;
    const activeViews = [];
    for (const { entry, rect, hostRect, progress } of layout) {
      const visible = hostRect.width > 0 && hostRect.height > 0 && hostRect.bottom > 0 && hostRect.top < height && hostRect.right > 0 && hostRect.left < width;
      // 预热只绘制入口要求的视图，不能顺带启动邻近章节。
      if (!priming && near.some(item => item.entry === entry)) init(entry, visible && !entry.visible);
      entry.visible = visible;
      const active = !priming && visible && entry.status === 'ready' && !state.hidden && !state.modalOpen;
      if (active !== entry.active) {
        entry.active = active;
        entry.last = null;
        entry.view.setActive(active);
      }
      if (entry.view.camera && rect.width > 0 && rect.height > 0 && (entry.width !== rect.width || entry.height !== rect.height || entry.dpr !== dpr)) {
        entry.width = rect.width; entry.height = rect.height; entry.dpr = dpr;
        entry.view.camera.aspect = rect.width / rect.height;
        entry.view.camera.updateProjectionMatrix();
        entry.view.resize({ width: rect.width, height: rect.height, dpr });
      }
      if (entry.status !== 'ready') continue;
      if (active || priming && visible) {
        const dt = priming || entry.last === null ? 0 : Math.min(.05, Math.max(0, (timestamp - entry.last) / 1000));
        entry.last = priming ? null : timestamp;
        entry.time += dt;
        entry.lastDt = dt;
        animate = Boolean(entry.view.update({ now: timestamp / 1000, dt, time: entry.time, state, viewport, progress })) || animate;
        activeViews.push(entry.name);
      }
    }
    renderer.setScissorTest(false);
    renderer.clear(true, true, true);
    const draws = {};
    for (const { entry, rect } of layout) {
      if (entry.status !== 'ready' || state.hidden || rect.bottom <= 0 || rect.top >= height || rect.width <= 0 || rect.height <= 0) continue;
      const left = Math.max(0, rect.left), right = Math.min(width, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(height, rect.bottom);
      if (right <= left || bottom <= top) continue;
      renderer.setViewport(rect.left, height - rect.bottom, rect.width, rect.height);
      renderer.setScissor(left, height - bottom, right - left, bottom - top);
      renderer.setScissorTest(true);
      renderer.clear(true, true, true);
      const beforeCalls = renderer.info.render.calls;
      renderer.render(entry.view.scene, entry.view.camera);
      const calls = renderer.info.render.calls - beforeCalls;
      const rendered = calls > 0 && !renderer.getContext().isContextLost();
      if (entry.rendered !== rendered) entry.view.setRenderable?.(rendered);
      entry.rendered = rendered;
      entry.contentReady = rendered && (entry.view.isContentReady?.() ?? true);
      const readiness = String(entry.contentReady);
      if (entry.view.host.dataset.motionReady !== readiness) entry.view.host.dataset.motionReady = readiness;
      if (entry.contentReady && entry.firstFrameAt == null) entry.firstFrameAt = timestamp;
      draws[entry.name] = { calls, contentReady: entry.contentReady };
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    const sample = { timestamp, rawDelta: lastTick === null ? null : timestamp - lastTick,
      activeViews, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      hidden: state.hidden, modalOpen: state.modalOpen, reducedMotion: state.reducedMotion, preparing: priming, draws };
    frames.push(sample);
    if (frames.length > 4000) frames.shift();
    lastTick = timestamp;
    tickCount++;
    renderer.info.reset();
    canvas.dispatchEvent(new CustomEvent('motion:frame', { detail: sample }));
    if (priming || (!animate && !dirty) || state.hidden) {
      renderer.setAnimationLoop(null);
      running = false;
      lastTick = null;
      for (const entry of entries) entry.last = null;
    }
    return sample;
  }

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    contextAvailable = false; renderer.setAnimationLoop(null); running = false; lastTick = null;
    preparationController?.abort(new Error('三维绘制上下文中断，请重试。'));
    canvas.dataset.context = 'lost'; canvas.style.visibility = 'hidden';
    for (const entry of entries) {
      entry.last = null; entry.active = false; entry.rendered = false; entry.contentReady = false;
      entry.view.host.dataset.motionReady = 'false';
      entry.view.setActive(false); entry.view.setRenderable?.(false);
    }
  }, { signal: listeners.signal });
  canvas.addEventListener('webglcontextrestored', () => {
    contextAvailable = true; canvas.dataset.context = 'available'; canvas.style.visibility = simplified ? 'hidden' : '';
    for (const entry of entries) entry.last = null;
    invalidate();
  }, { signal: listeners.signal });

  for (const event of ['scroll', 'resize', 'pageshow']) window.addEventListener(event, invalidate, { passive: true, signal: listeners.signal });
  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    for (const entry of entries) {
      entry.last = null;
      if (hidden && entry.active) {
        entry.active = false;
        entry.view.setActive(false);
      }
    }
    lastTick = null;
    // 隐藏页可能完全不调帧，在真实可见性事件中暂停，返回首帧不补算后台时间。
    if (hidden) {
      renderer.setAnimationLoop(null);
      running = false;
      setAssetFocus([]);
    } else invalidate();
  }, { signal: listeners.signal });
  reduced.addEventListener('change', invalidate, { signal: listeners.signal });
  coarse.addEventListener('change', invalidate, { signal: listeners.signal });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) dispose();
    else {
      renderer.setAnimationLoop(null); running = false;
      for (const entry of entries) { entry.last = null; entry.active = false; entry.view.setActive(false); }
    }
  }, { signal: listeners.signal });
  const observer = new ResizeObserver(invalidate);

  function start(views, { deferEntry = false, onFrame = null } = {}) {
    if (started) throw new Error('Runtime.start must be called once');
    if (disposed) throw new Error('Runtime is disposed');
    started = true;
    deferred = deferEntry; prepared = !deferEntry; frameHook = onFrame;
    for (const name of ['story', 'equipment', 'media']) {
      if (!views[name]) continue;
      const entry = { name, view: views[name], status: 'new', active: false, time: 0, last: null };
      entries.push(entry);
      observer.observe(entry.view.host);
      if (entry.view.renderHost) observer.observe(entry.view.renderHost);
      entry.view.setRenderable?.(false);
    }
    invalidate();
  }

  function cancelPreparation(reason = '已取消三维准备') {
    preparationController?.abort(reason instanceof Error ? reason : new Error(reason));
  }

  function prepareEntry(name, section, onProgress) {
    if (preparing) return preparing;
    if (disposed || !started) return Promise.reject(new Error('三维运行时尚未启动或已经释放'));
    deferred = true; prepared = false; simplified = false;
    renderer.setAnimationLoop(null); running = false; lastTick = null;
    const controller = new AbortController(); preparationController = controller;
    let timer;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error('连续20秒没有三维准备进展，请重试。')), 20000);
    };
    const guard = promise => new Promise((resolve, reject) => {
      if (controller.signal.aborted) { reject(controller.signal.reason); return; }
      const abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
    });
    preparing = (async () => {
      touch();
      const viewport = { width: innerWidth, height: innerHeight,
        dpr: Math.min(devicePixelRatio || 1, coarse.matches || innerWidth < 768 ? 1.25 : 1.5) };
      ({ width, height, dpr } = viewport);
      renderer.setPixelRatio(dpr); renderer.setSize(width, height, false);
      const requested = entries.find(entry => entry.name === name);
      setAssetFocus(requested ? [requested.name] : []);
      // 刷新时可能只看得到说明和选项；先同步这些控件，离屏舞台无需预热。
      if (requested?.view.prepareControls && !stageInViewport(requested.view)) {
        await guard(requested.view.prepareControls());
        touch();
      }
      const targets = requested && stageInViewport(requested.view) ? [requested] : [];
      for (const entry of targets) {
        entry.active = false; entry.last = null; entry.view.setActive(false);
        entry.status = 'loading'; entry.error = null;
        try {
          await guard(entry.view.prepareEntry ? entry.view.prepareEntry(section) : entry.view.init());
          entry.status = 'ready'; delete entry.view.host.dataset.motionError; touch();
        } catch (error) {
          entry.status = 'failed'; entry.error = String(error.message || error);
          entry.view.host.dataset.motionError = entry.error;
          throw error;
        }
      }
      const uploaded = new Set();
      const upload = texture => {
        if (texture?.isTexture && !uploaded.has(texture)) { renderer.initTexture(texture); uploaded.add(texture); }
      };
      for (const entry of targets) {
        if (!contextAvailable || renderer.getContext().isContextLost()) throw new Error('三维绘制上下文不可用');
        const rect = (entry.view.renderHost || entry.view.host).getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0)) throw new Error(`${entry.name}舞台没有可绘制尺寸`);
        entry.width = rect.width; entry.height = rect.height; entry.dpr = dpr;
        entry.view.camera.aspect = rect.width / rect.height; entry.view.camera.updateProjectionMatrix();
        entry.view.resize({ width: rect.width, height: rect.height, dpr });
        entry.view.update({ now: 0, dt: 0, time: 0,
          state: { ...readState(), preparing: true, hidden: false, modalOpen: false },
          viewport, progress: entry.view.measureProgress?.() ?? null });
        const visibility = [];
        entry.view.scene.traverse(object => {
          visibility.push([object, object.visible, object.frustumCulled]);
          object.visible = true; object.frustumCulled = false;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            if (!material) continue;
            for (const value of Object.values(material)) upload(value);
            for (const uniform of Object.values(material.uniforms || {})) upload(uniform?.value);
          }
        });
        upload(entry.view.scene.environment); upload(entry.view.scene.background);
        try {
          // 遮罩下以同renderer真实绘制所有对象；恢复可见性后仍从原时间开始。
          await guard(renderer.compileAsync(entry.view.scene, entry.view.camera));
          renderer.setScissorTest(false); renderer.setViewport(0, 0, rect.width, rect.height);
          renderer.clear(true, true, true); renderer.info.reset();
          renderer.render(entry.view.scene, entry.view.camera);
          renderer.getContext().finish();
          entry.warmupDrawCalls = renderer.info.render.calls;
          if (!(entry.warmupDrawCalls > 0) || !contextAvailable || renderer.getContext().isContextLost())
            throw new Error(`${entry.name}尚无有效三维绘制`);
        } finally {
          for (const [object, visible, frustumCulled] of visibility) { object.visible = visible; object.frustumCulled = frustumCulled; }
        }
        touch();
        onProgress?.({ phase: 'warmup', percent: 99,
          completed: 1, total: 1, view: entry.name, drawCalls: entry.warmupDrawCalls, errors: [] });
      }
      if (controller.signal.aborted) throw controller.signal.reason;
      // 撤罩前把预热画面替换为真实当前视口；时钟和DOM动图仍保持冻结。
      const visibleFrame = tick(performance.now(), true);
      if (requested && stageInViewport(requested.view) && !visibleFrame?.draws[requested.name]?.contentReady)
        throw new Error('当前视口尚无完整画面，请重试。');
      prepared = true;
      return { prepared: true, views: targets.map(entry => ({ name: entry.name, drawCalls: entry.warmupDrawCalls })) };
    })().finally(() => {
      clearTimeout(timer); renderer.info.reset(); renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height); preparing = null;
      if (preparationController === controller) preparationController = null;
    });
    return preparing;
  }

  function enter({ simplified: staticEntry = false } = {}) {
    if (disposed) throw new Error('三维运行时已经释放');
    if (!staticEntry && !prepared) throw new Error('当前画面准备完成前不能进入');
    deferred = false; simplified = staticEntry; lastTick = null;
    for (const entry of entries) { entry.last = null; entry.active = false; entry.view.setActive(false); }
    if (simplified) {
      cancelPreparation('选择了简化浏览'); renderer.setAnimationLoop(null); running = false;
      canvas.style.visibility = 'hidden';
      for (const entry of entries) {
        entry.view.setRenderable?.(false); entry.view.showFallback?.(); entry.view.setUnavailable?.();
      }
      return;
    }
    canvas.style.visibility = ''; invalidate();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelPreparation('页面已经卸载');
    renderer.setAnimationLoop(null); running = false;
    listeners.abort(); observer.disconnect();
    for (const entry of entries) {
      entry.view.setActive(false);
      entry.view.dispose();
      delete entry.view.host.dataset.motionReady;
    }
    renderer.dispose();
  }

  return { start, prepareEntry, enter, cancelPreparation, invalidate, dispose,
    retryView(name) { const entry = entries.find(e => e.name === name); if (entry) return init(entry, true); },
    inspect: () => ({ running, disposed, deferred, prepared, simplified, tickCount, rendererCount: 1, contextAvailable, assets: inspectAssets(), viewport: { width, height, dpr },
      views: entries.map(e => ({ name: e.name, status: e.status, active: e.active, time: e.time, dt: e.lastDt, error: e.error,
        rendered: e.rendered, contentReady: e.contentReady, firstFrameAt: e.firstFrameAt, warmupDrawCalls: e.warmupDrawCalls })) }),
    readFrames: () => frames.slice(), clearFrames: () => { frames.length = 0; },
  };
}
