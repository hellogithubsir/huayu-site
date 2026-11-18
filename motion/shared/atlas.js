import { LinearFilter, SRGBColorSpace } from 'three';
import { getAnimation, getPreparedImage, loadAnimation, loadTexture } from './assets.js?v=entry-first-20261112';

// 元数据中的坐标采用图片左上原点；帧边缘像素不进入展示区域。
export function frameRectangle(animation, index) {
  const page = animation.pages.findIndex(item => index >= item.firstFrame && index < item.firstFrame + item.frameCount);
  if (page < 0) throw new RangeError(`Atlas frame ${index} is outside the animation`);
  const local = index - animation.pages[page].firstFrame;
  const padding = animation.padding || 0;
  return { page, x: local % animation.pages[page].columns * (animation.width + padding * 2) + padding,
    y: Math.floor(local / animation.pages[page].columns) * (animation.height + padding * 2) + padding,
    width: animation.width, height: animation.height };
}

export function createAtlasPlayer(id, { canvas = null, texture = false, onFrame = null } = {}) {
  let animation, images = [], textures = [], preparing = null;
  let prepared = false, stillPrepared = false, disposed = false, active = false, elapsed = 0, lastTime = null, frame = 0;
  let currentTexture = null;

  function draw(target, index = frame) {
    if ((!prepared && !stillPrepared) || !target) return false;
    if (target.width !== animation.width) target.width = animation.width;
    if (target.height !== animation.height) target.height = animation.height;
    target.style.aspectRatio = `${animation.width} / ${animation.height}`;
    const context = target.getContext('2d');
    if (!context) throw new Error(`Canvas unavailable for animation ${id}`);
    const rect = frameRectangle(animation, index);
    context.clearRect(0, 0, animation.width, animation.height);
    context.drawImage(images[rect.page], rect.x, rect.y, rect.width, rect.height, 0, 0, animation.width, animation.height);
    target.dataset.animationFrame = String(index);
    return true;
  }

  function setFrame(index, force = false) {
    if (!prepared || disposed || !force && index === frame) return false;
    frame = index;
    const rect = frameRectangle(animation, index);
    if (texture) {
      currentTexture = textures[rect.page];
      const image = images[rect.page];
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      currentTexture.repeat.set(rect.width / width, rect.height / height);
      currentTexture.offset.set(rect.x / width, 1 - (rect.y + rect.height) / height);
      currentTexture.updateMatrix();
    }
    if (canvas) draw(canvas, index);
    onFrame?.(currentTexture, index);
    return true;
  }

  function prepare(options) {
    if (prepared) return Promise.resolve();
    if (preparing) return preparing;
    preparing = (async () => {
      animation = await loadAnimation(id, options);
      images = animation.pages.map(page => getPreparedImage(page.assetId));
      if (texture) {
        textures = await Promise.all(animation.pages.map(page => loadTexture(page.assetId, { group: 'media' })));
        for (const item of textures) {
          item.generateMipmaps = false;
          item.minFilter = LinearFilter; item.magFilter = LinearFilter;
          item.colorSpace = SRGBColorSpace;
        }
      }
      if (disposed) return;
      prepared = true; stillPrepared = true;
      setFrame(0, true);
    })().finally(() => { preparing = null; });
    return preparing;
  }

  function prepareStill() {
    animation = getAnimation(id);
    const rect = frameRectangle(animation, 0);
    // 简化入口只依赖首帧所在的已缓存图片，不创建纹理或等待其他页。
    images[rect.page] = getPreparedImage(animation.pages[rect.page].assetId);
    stillPrepared = true; active = false; elapsed = 0; lastTime = null; frame = 0;
    if (canvas) draw(canvas, 0);
  }

  return {
    id, prepare, prepareStill, draw,
    get ready() { return prepared && !disposed; },
    get stillReady() { return stillPrepared && !disposed; },
    get texture() { return currentTexture; },
    setActive(value) {
      active = Boolean(value) && prepared && !disposed;
      if (!active) lastTime = null;
    },
    tick(now) {
      if (!active || !prepared || disposed || !Number.isFinite(now)) { lastTime = null; return false; }
      if (lastTime !== null) elapsed += Math.max(0, now - lastTime);
      lastTime = now;
      setFrame(Math.floor(elapsed * animation.fps) % animation.frameCount);
      return true;
    },
    reset() { elapsed = 0; lastTime = null; frame = 0; if (prepared) setFrame(0, true); else if (stillPrepared && canvas) draw(canvas, 0); },
    inspect: () => ({ id, ready: prepared && !disposed, stillReady: stillPrepared && !disposed, active, frame, elapsed,
      frameCount: animation?.frameCount ?? 0, fps: animation?.fps ?? 0, page: animation ? frameRectangle(animation, frame).page : null }),
    // 图片和纹理由整页预载缓存持有，播放器退出不提前释放共享对象。
    dispose() { disposed = true; active = false; lastTime = null; images = []; textures = []; currentTexture = null; },
  };
}
