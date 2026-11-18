import { createAtlasPlayer } from './shared/atlas.js?v=entry-first-20261112';

// 只在打开装备弹窗时准备当前动图。
export function createFilmDialog(element, readState, onChange = () => {}) {
  const canvas = element.querySelector('#product-player');
  const title = element.querySelector('h2'), source = element.querySelector('[data-product-source]');
  const error = element.querySelector('[data-product-error]'), closeButton = element.querySelector('[data-product-close]');
  const events = new AbortController();
  const loading = element.querySelector('[data-product-loading]');
  const retry = element.querySelector('[data-product-retry]');
  const players = new Map(['tufu', 'zidian', 'teamwear'].map(id => [id, createAtlasPlayer(id, { canvas })]));
  let item, trigger, player = null, disposed = false;
  let credit = element.querySelector('[data-film-credit]');
  if (!credit) {
    credit = document.createElement('p'); credit.dataset.filmCredit = '';
    canvas.insertAdjacentElement('afterend', credit);
  }

  function describe() {
    if (!item) return;
    const language = readState().lang === 'en' ? 'en' : 'zh';
    title.textContent = item.title[language];
    canvas.setAttribute('aria-label', item.title[language] + (language === 'en' ? ' animated preview' : '动态展示'));
    credit.textContent = item.credit?.[language] || '';
    credit.hidden = !credit.textContent;
  }

  function unload() {
    player?.setActive(false); player = null; item = undefined;
    error.hidden = true;
    if (loading) loading.hidden = true;
    if (retry) retry.hidden = true;
    document.body.classList.remove('has-open-dialog'); onChange();
  }

  async function prepareCurrent() {
    const pending = player;
    if (!pending) return;
    canvas.hidden = true; error.hidden = true;
    if (retry) retry.hidden = true;
    if (loading) loading.hidden = false;
    try {
      await pending.prepare({ group: 'interaction' });
      if (player !== pending || !element.open) return;
      pending.reset(); canvas.hidden = false;
    } catch {
      if (player !== pending || !element.open) return;
      error.hidden = false;
      if (retry) retry.hidden = false;
    } finally {
      if (player === pending && element.open) {
        if (loading) loading.hidden = true;
        onChange();
      }
    }
  }

  function close() { if (element.open) element.close(); }

  closeButton.addEventListener('click', close, { signal: events.signal });
  retry?.addEventListener('click', prepareCurrent, { signal: events.signal });
  element.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === closeButton) { event.preventDefault(); source.focus(); }
    else if (!event.shiftKey && document.activeElement === source) { event.preventDefault(); closeButton.focus(); }
  }, { signal: events.signal });
  element.addEventListener('close', () => {
    unload();
    if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    trigger = undefined;
  }, { signal: events.signal });
  const languageObserver = new MutationObserver(describe);
  languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  return {
    element, canvas,
    get player() { return player; },
    get players() { return [...players.values()]; },
    open(nextItem, nextTrigger) {
      if (disposed) return;
      player?.setActive(false);
      item = nextItem; trigger = nextTrigger; player = players.get(item.id) || null;
      source.href = item.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer';
      canvas.dataset.animation = item.id;
      describe();
      if (!element.open) element.showModal();
      document.body.classList.add('has-open-dialog'); closeButton.focus();
      onChange();
      void prepareCurrent();
    },
    close,
    inspect: () => ({ open: element.open, selectedId: item?.id || null, animation: player?.inspect() || null }),
    dispose() {
      if (disposed) return;
      disposed = true; close(); unload(); events.abort(); languageObserver.disconnect();
      for (const item of players.values()) item.dispose();
      trigger = undefined;
    },
  };
}
