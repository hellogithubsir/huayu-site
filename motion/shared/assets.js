import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshoptimizer-1.3.0/meshopt_decoder.mjs';
import { createAssetQueue } from './asset-queue.js?v=entry-first-20261112';

const queue = createAssetQueue(2), models = new GLTFLoader();
models.setMeshoptDecoder(MeshoptDecoder);
const records = new Map(), aliases = new Map();
// 同一页固定版本；横竖屏切换不会重取另一套动图。
const mobile = matchMedia('(max-width: 1023px), (pointer: coarse)').matches;
let entry = null, lastPercent = 0;
let state = { phase: 'idle', percent: 0, completed: 0, total: 0, errors: [] };

function canonical(value) {
  const url = new URL(value, document.baseURI);
  url.search = ''; url.hash = '';
  return url.href;
}

function register(asset) {
  const record = { ...asset, expectedBytes: asset.bytes, href: new URL(asset.url, document.baseURI).href,
    loaded: 0, value: null, texture: null, error: null };
  records.set(asset.id, record);
  for (const alias of [asset.url, asset.source].filter(Boolean)) aliases.set(canonical(alias), asset.id);
  return record;
}

const definition = register({ id: 'entry-assets', kind: 'json', url: 'motion/optimized/entry-assets.json?v=entry-first-20261112', bytes: 0 });
const catalogue = register({ id: 'media-catalogue', kind: 'json', url: 'motion/media-space/media.json?v=full-preload-20261110', bytes: 0 });

function findRecord(value) {
  const record = records.get(value) || records.get(aliases.get(canonical(value)));
  if (!record) throw new Error(`资源不在展示清单中：${value}`);
  return record;
}

function notify(record, phase, failure) {
  const run = entry;
  if (!run?.records || record && !run.records.includes(record)) return;
  const totalBytes = run.records.reduce((sum, item) => sum + item.bytes, 0);
  const downloaded = run.records.reduce((sum, item) => sum + Math.min(item.bytes, item.loaded), 0);
  const completed = run.records.filter(item => item.value !== null).length;
  const calculated = !definition.value ? 0 : downloaded >= totalBytes
    ? 90 + 7 * completed / Math.max(1, run.records.length)
    : 90 * downloaded / Math.max(1, totalBytes);
  lastPercent = Math.min(97, Math.max(lastPercent, calculated));
  state = { phase: phase || (downloaded >= totalBytes && definition.value ? 'decode' : 'download'), percent: lastPercent,
    completed, total: run.records.length, failure: failure || null,
    errors: run.records.filter(item => item.error).map(item => ({ id: item.id, message: item.error })) };
  run.progress?.(state);
}

function waitFor(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).then(() => signal.removeEventListener('abort', abort));
  });
}

async function readResponse(record, signal, touch) {
  const response = await fetch(record.href, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${record.url}`);
  const chunks = [], reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); record.loaded += value.byteLength; touch(); notify(record);
  }
  if (record.expectedBytes && record.expectedBytes !== record.loaded) throw new Error(`资源长度与发布清单不一致：${record.url}`);
  record.bytes = record.loaded;
  const bytes = new Uint8Array(record.loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function request(record, options = {}) {
  if (record.value !== null) return Promise.resolve(record.value);
  return queue.request(record.id, async () => {
    const controller = new AbortController(), { signal } = controller;
    const parent = options.signal;
    if (parent?.aborted) throw parent.reason;
    const abort = () => controller.abort(parent.reason);
    parent?.addEventListener('abort', abort, { once: true });
    let timer, objectURL;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error(`连续20秒没有加载进展：${record.id}`)), 20000);
    };
    record.error = null; record.loaded = 0; touch();
    try {
      const bytes = await readResponse(record, signal, touch);
      let value;
      if (record.kind === 'json') {
        value = JSON.parse(new TextDecoder().decode(bytes));
        if (record === definition) {
          if (!Array.isArray(value.assets) || !value.assets.length || !value.animations) throw new Error('展示资源清单格式不正确');
          for (const asset of value.assets) register(asset);
        }
      } else if (record.kind === 'model') {
        value = await waitFor(models.parseAsync(bytes.buffer, new URL('.', record.href).href), signal);
      } else {
        const type = record.url.endsWith('.svg') ? 'image/svg+xml' : 'image/webp';
        objectURL = URL.createObjectURL(new Blob([bytes], { type }));
        value = new Image(); value.decoding = 'async'; value.src = objectURL;
        await waitFor(value.decode(), signal);
      }
      if (signal.aborted) throw signal.reason;
      record.value = value;
      notify(record);
      return value;
    } catch (error) {
      if (objectURL) URL.revokeObjectURL(objectURL);
      record.loaded = 0; record.error = String(error.message || error);
      throw error;
    } finally {
      clearTimeout(timer); parent?.removeEventListener('abort', abort);
    }
  }, options);
}

export function prepareAssets({ assets = [], animations = [] }, progress) {
  if (entry) return entry.promise;
  const controller = new AbortController(), options = { group: 'entry', signal: controller.signal };
  const run = { controller, records: null, progress };
  entry = run;
  run.promise = (async () => {
    let jobs = [];
    try {
      await request(definition, options);
      const pageIds = animations.flatMap(id => getAnimation(id).pages.map(page => page.assetId));
      run.records = [...new Set([definition, ...[...assets, ...pageIds].map(findRecord)])];
      notify(null, 'download');
      jobs = run.records.map(record => request(record, options));
      await Promise.all(jobs);
      notify(null, 'prepared');
      return inspectAssets();
    } catch (error) {
      controller.abort(error);
      await Promise.allSettled(jobs);
      run.records ||= [definition];
      notify(null, 'failed', error);
      throw error;
    } finally { entry = null; }
  })();
  return run.promise;
}

export function cancelPreparation(reason = '已取消资源准备') {
  entry?.controller.abort(reason instanceof Error ? reason : new Error(reason));
}

async function ensure(value, options) {
  if (!definition.value && value !== catalogue.id) await request(definition, options);
  return request(findRecord(value), options);
}

export function getAnimation(id) {
  const manifest = definition.value;
  const animation = (mobile && manifest?.mobileAnimations?.[id]) || manifest?.animations[id];
  if (!animation) throw new Error(`未知动图：${id}`);
  return animation;
}

export async function loadAnimation(id, options) {
  await request(definition, options);
  const animation = getAnimation(id);
  await Promise.all(animation.pages.map(page => ensure(page.assetId, options)));
  return animation;
}

export function getPreparedImage(idOrURL) {
  const record = findRecord(idOrURL);
  if (record.kind !== 'image' || !record.value) throw new Error(`图片尚未准备完成：${record.id}`);
  return record.value;
}

export function resolveAssetURL(idOrURL) {
  return getPreparedImage(idOrURL).src;
}

export const loadImage = ensure;
export const loadModel = ensure;
export const loadCatalogue = options => ensure(catalogue.id, options);

export async function loadTexture(url, options) {
  const image = await ensure(url, options), record = findRecord(url);
  if (!record.texture) { record.texture = new Texture(image); record.texture.needsUpdate = true; }
  return record.texture;
}

export const setAssetFocus = groups => queue.focus(['entry', 'interaction', ...groups]);
export function promoteAsset(url, { priority = -1 } = {}) {
  queue.promote(findRecord(url).id, priority);
}
export function inspectAssets() {
  return { ...queue.inspect(), ...state, prepared: state.phase === 'prepared', mobile, entries: [...records.values()].map(record => ({
    id: record.id, url: record.url, kind: record.kind, bytes: record.bytes, loaded: record.loaded,
    ready: record.value !== null, error: record.error,
  })) };
}
