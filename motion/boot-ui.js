(() => {
  const root = document.documentElement;
  const screen = document.querySelector('[data-boot]');
  const shell = document.querySelector('#page-shell');
  const progress = screen.querySelector('[role="progressbar"]');
  const number = screen.querySelector('[data-boot-percent]');
  const label = screen.querySelector('[data-boot-label]');
  const actions = screen.querySelector('[data-boot-actions]');
  const cards = [...screen.querySelectorAll('[data-boot-card]')];
  const dots = [...screen.querySelectorAll('[data-boot-dot]')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const english = new URLSearchParams(location.search).get('lang') === 'en';
  const choose = (zh, en) => english ? en : zh;
  let state = 'loading', percent = 0, phase = 'download';
  let lastProgress = performance.now(), latestValue = 0, handlers = {};
  let cardIndex = 0, cardTimer = null, pageActive = true;
  const events = [{ at: lastProgress, state, phase, percent }];
  if (english) root.lang = 'en';
  const memberCount = document.querySelectorAll('.orbit-person[data-member]').length;
  for (const counter of screen.querySelectorAll('[data-boot-member-count]')) counter.textContent = String(memberCount);
  shell.inert = true;
  root.dataset.bootState = state;
  const names = {
    download: choose('加载当前画面', 'Loading this scene'),
    decode: choose('准备画面', 'Preparing the scenes'),
    parse: choose('准备画面', 'Preparing the scenes'),
    warmup: choose('准备三维画面', 'Preparing the 3D scenes'),
    ready: choose('准备就绪', 'Ready'),
  };

  function showCard(index) {
    cardIndex = index;
    for (const [position, card] of cards.entries()) {
      const active = position === index;
      card.dataset.active = String(active);
      card.setAttribute('aria-hidden', String(!active));
      dots[position].dataset.active = String(active);
    }
    screen.dataset.activeCard = cards[index].dataset.bootCard;
  }

  function syncCards() {
    const active = state === 'loading' && pageActive && !document.hidden && !reduced.matches;
    screen.dataset.cardsPaused = String(!active);
    if (!active && cardTimer !== null) { clearInterval(cardTimer); cardTimer = null; }
    if (active && cardTimer === null) cardTimer = setInterval(() => showCard((cardIndex + 1) % cards.length), 4500);
  }

  function record() {
    const last = events.at(-1);
    if (last.state !== state || last.phase !== phase || last.percent !== percent) {
      events.push({ at: performance.now(), state, phase, percent });
    }
    root.dataset.bootState = state;
  }

  function update(detail) {
    if (state !== 'loading') return;
    if (detail.phase === 'failed') { fail(detail.failure || detail.errors?.[0]); return; }
    const next = Math.max(latestValue, Math.min(99, Number(detail.percent) || 0));
    if (next !== latestValue || detail.phase !== phase) lastProgress = performance.now();
    latestValue = next;
    percent = Math.floor(next);
    phase = detail.phase || phase;
    number.textContent = String(percent).padStart(2, '0');
    progress.setAttribute('aria-valuenow', String(percent));
    progress.style.setProperty('--progress', percent / 100);
    label.textContent = names[phase] || names.decode;
    record();
  }

  function fail(error) {
    if (state !== 'loading') return;
    if (location.protocol === 'file:') {
      for (const image of screen.ownerDocument.querySelectorAll('img[data-asset], img[data-poster]')) {
        const source = image.dataset.asset || image.dataset.poster;
        if (source && !image.hasAttribute('src')) image.src = source;
      }
      label.textContent = choose('本地文件已切换静态浏览。', 'Static browsing is enabled for this local file.');
      delete screen.dataset.error;
      void reveal(true);
      return;
    }
    state = 'failed';
    label.textContent = choose('部分资源尚未准备好，请重试。', 'Some resources could not be prepared. Please retry.');
    actions.hidden = false;
    screen.dataset.error = String(error?.message || error || 'Resources unavailable');
    syncCards();
    record();
  }

  async function reveal(simplified = false) {
    if (state === 'ready' || state === 'simplified') return;
    const destination = simplified ? 'simplified' : 'ready';
    state = 'revealing';
    phase = destination;
    syncCards();
    if (!simplified) {
      percent = 100;
      number.textContent = '100';
      progress.setAttribute('aria-valuenow', '100');
      progress.style.setProperty('--progress', 1);
      label.textContent = names.ready;
    }
    clearInterval(watchdog);
    actions.hidden = true;
    root.classList.add('is-revealing');
    root.classList.toggle('is-simplified', simplified);
    record();
    const duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180;
    await screen.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' }).finished;
    screen.hidden = true;
    root.classList.remove('is-preparing', 'is-revealing');
    shell.inert = false;
    state = destination;
    record();
    dispatchEvent(new CustomEvent('huayu:entered', { detail: { simplified } }));
  }

  const watchdog = setInterval(() => {
    if (state === 'loading' && performance.now() - lastProgress > 20000) {
      handlers.stall?.();
      fail(new Error('Preparation made no progress for 20 seconds'));
    }
  }, 1000);
  screen.querySelector('[data-boot-retry]').addEventListener('click', () => handlers.retry ? handlers.retry() : location.reload());
  screen.querySelector('[data-boot-simple]').addEventListener('click', () => handlers.simplify ? handlers.simplify() : reveal(true));
  window.addEventListener('error', event => {
    if (event.target?.matches?.('script[data-motion-entry]')) fail(new Error('Entry module unavailable'));
  }, true);
  document.addEventListener('visibilitychange', syncCards);
  reduced.addEventListener('change', syncCards);
  window.addEventListener('pagehide', () => { pageActive = false; syncCards(); });
  window.addEventListener('pageshow', () => { pageActive = true; syncCards(); });
  window.huayuBoot = {
    get state() { return state; },
    get percent() { return percent; },
    get phase() { return phase; },
    inspectCards: () => ({ index: cardIndex, id: cards[cardIndex].dataset.bootCard,
      timerActive: cardTimer !== null, paused: screen.dataset.cardsPaused === 'true' }),
    events, update, fail, reveal,
    configure(value) {
      handlers = value;
      // 入口模块到达后，下载/解析与三维准备各自按真实活动计时。
      // 数字为重试保留高水位，不能再用数字是否增长判断网络停滞。
      clearInterval(watchdog);
    },
    start() {
      state = 'loading'; phase = 'download'; lastProgress = performance.now();
      actions.hidden = true; delete screen.dataset.error;
      label.textContent = choose('继续准备当前画面', 'Preparing this scene');
      syncCards();
      record();
    },
  };
  showCard(0);
  syncCards();
  update({ phase: 'download', percent: 0 });
})();
