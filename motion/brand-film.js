// B站播放器只在品牌片进入视野后创建；静音自动播放由浏览器决定。
export function bindBrandFilm(host, readState) {
  const poster = host.querySelector('[data-film-poster]');
  const play = host.querySelector('[data-film-play]');
  const cover = host.nextElementSibling.querySelector('[data-film-cover]');
  const events = new AbortController();
  let frame = null, visible = false, inView = false, pageActive = true, coverOnly = false;
  function unload() {
    frame?.remove();
    frame = null;
    play.hidden = !navigator.onLine;
    cover.hidden = true;
  }
  function mount() {
    if (frame) return;
    const iframe = document.createElement('iframe');
    iframe.title = readState().lang === 'en' ? 'Huayu brand film on Bilibili' : '华羽品牌宣传片（B站）';
    iframe.allow = 'autoplay; fullscreen';
    iframe.allowFullscreen = true;
    iframe.src = 'https://player.bilibili.com/player.html?bvid=BV1uVJF6AEbf&p=1&autoplay=1&muted=1&danmaku=0';
    play.hidden = true;
    cover.hidden = false;
    frame = iframe;
    host.append(iframe);
  }
  function sync(manual = false) {
    const state = readState();
    if (frame) frame.title = state.lang === 'en' ? 'Huayu brand film on Bilibili' : '华羽品牌宣传片（B站）';
    if (!pageActive || state.preparing || state.hidden || state.menuOpen || state.modalOpen || !visible) {
      unload();
      return;
    }
    if (!navigator.onLine) { unload(); return; }
    if (!poster.hasAttribute('src')) poster.src = 'motion/optimized/images/brand-film-cover.webp';
    if (!frame) play.hidden = false;
    if (manual) coverOnly = false;
    if (!coverOnly && (manual || inView && !state.reducedMotion && !state.simplified)) mount();
  }
  const observer = new IntersectionObserver(([item]) => {
    visible = item.isIntersecting && item.intersectionRatio > 0;
    inView = item.intersectionRatio >= .25;
    if (!visible) coverOnly = false;
    sync();
  }, { threshold: [0, .25] });
  observer.observe(host);
  const on = (target, event, fn) => target.addEventListener(event, fn, { signal: events.signal });
  const refresh = () => sync();
  on(play, 'click', () => sync(true));
  on(poster, 'error', () => poster.removeAttribute('src'));
  on(cover, 'click', () => { coverOnly = true; unload(); sync(); play.focus({ preventScroll: true }); });
  on(window, 'huayu:entered', refresh);
  on(window, 'online', refresh);
  on(window, 'offline', refresh);
  on(document, 'visibilitychange', refresh);
  on(window, 'pageshow', () => { pageActive = true; sync(); });
  on(window, 'pagehide', event => {
    pageActive = false; unload();
    if (!event.persisted) { events.abort(); observer.disconnect(); }
  });
  on(matchMedia('(prefers-reduced-motion: reduce)'), 'change', () => {
    if (readState().reducedMotion) unload(); else sync();
  });
  return refresh;
}
