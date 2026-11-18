// 动图使用同一活动时钟；切换可见区域只暂停，不补算后台时间。
export function createMediaCoordinator({ dialogController, readState, invalidate }) {
  const events = new AbortController(), coarse = matchMedia('(pointer: coarse)');
  const candidates = new Map(), wanted = new Set();
  let disposed = false;
  const on = (target, event) => target?.addEventListener(event, sync, { signal: events.signal });
  const limit = () => coarse.matches || innerWidth < 1024 ? 1 : 2;

  function sync(requestFrame = true) {
    if (disposed) return;
    const state = readState();
    wanted.clear();
    const paused = state.hidden || state.preparing || state.simplified || state.menuOpen || state.reducedMotion;
    if (!paused) {
      if (dialogController?.element.open) {
        if (dialogController.player?.ready) wanted.add(dialogController.player);
      } else if (!state.modalOpen) {
        const eligible = [...candidates.values()].filter(candidate => candidate.visible && candidate.player?.ready);
        eligible.sort((a, b) => Number(b.selected) - Number(a.selected) || a.distance - b.distance);
        for (const candidate of eligible.slice(0, limit())) wanted.add(candidate.player);
      }
    }
    for (const candidate of candidates.values()) candidate.player?.setActive(wanted.has(candidate.player));
    for (const player of dialogController?.players || []) player.setActive(wanted.has(player));
    if (requestFrame) invalidate();
  }

  on(dialogController?.element, 'close'); on(document, 'visibilitychange');
  on(window, 'scroll'); on(window, 'resize'); on(coarse, 'change');
  on(matchMedia('(prefers-reduced-motion: reduce)'), 'change');

  return {
    setDialog(controller) { dialogController = controller; on(controller.element, 'close'); },
    tick(now) {
      sync(false);
      let active = false;
      for (const player of wanted) active = player.tick(now) || active;
      return active;
    },
    setPreviews(list) {
      const next = new Set(list.map(item => item.player));
      for (const candidate of candidates.values()) if (!next.has(candidate.player)) candidate.player?.setActive(false);
      candidates.clear();
      for (const item of list) candidates.set(item.id, item);
      sync();
    },
    openFilm(item, trigger) {
      if (disposed || readState().menuOpen || readState().preparing) return;
      if (!['tufu', 'zidian', 'teamwear'].includes(item.id)) {
        window.open(item.sourceUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      dialogController?.open(item, trigger); sync();
    },
    sync,
    inspect: () => ({ previewLimit: limit(), playing: [...wanted].map(player => player.id), dialog: dialogController?.inspect() }),
    dispose() {
      if (disposed) return;
      disposed = true; events.abort();
      for (const candidate of candidates.values()) candidate.player?.setActive(false);
      dialogController?.dispose(); candidates.clear(); wanted.clear();
    },
  };
}
