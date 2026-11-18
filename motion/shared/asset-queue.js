// 同一页面只保留两个大资源下载；已发起的任务继续完成，可见章节优先。
export function createAssetQueue(limit = 2) {
  const pending = new Map(), waiting = [];
  let groups = ['entry', 'interaction', 'story'], running = 0;
  const rank = group => groups.includes(group) ? groups.indexOf(group) : groups.length;

  function drain() {
    while (running < limit) {
      const next = waiting.sort((a, b) =>
        rank(a.group) - rank(b.group) || a.priority - b.priority || a.order - b.order)[0];
      if (!next) return;
      waiting.splice(waiting.indexOf(next), 1);
      running++;
      const settle = (ok, value) => {
        running--; pending.delete(next.key); drain();
        (ok ? next.resolve : next.reject)(value);
      };
      Promise.resolve().then(next.load).then(value => settle(true, value), error => settle(false, error));
    }
  }
  let order = 0;
  return {
    request(key, load, { group = 'story', priority = 0 } = {}) {
      const existing = pending.get(key);
      if (existing) {
        existing.priority = Math.min(existing.priority, priority);
        if (rank(group) < rank(existing.group)) existing.group = group;
        return existing.promise;
      }
      const item = { key, load, group, priority, order: order++ };
      item.promise = new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject; });
      pending.set(key, item); waiting.push(item); drain();
      return item.promise;
    },
    focus(names) { groups = [...names]; drain(); },
    promote(key, priority = -1) {
      const item = pending.get(key);
      if (item) { item.priority = Math.min(item.priority, priority); drain(); }
    },
    inspect: () => ({ running, limit, groups: [...groups], waiting: waiting.map(({ key, group, priority }) => ({ key, group, priority })) }),
  };
}
