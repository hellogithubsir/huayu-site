const NATIVE = 'a,button,input,textarea,select,video,[contenteditable],p,h1,h2,h3,label,[data-motion-native]';

export function bindSurface(host, { isBlocked, invalidate, onDragStart, onDrag, onDragEnd, onTap, onKey } = {}) {
  const events = new AbortController();
  const raw = { inside: false, pointerType: 'mouse', x: 0, y: 0, dragging: false, dx: 0, dy: 0 };
  const pointers = new Set();
  let gesture = null, suppressedUntil = 0;
  const owns = event => event.target.closest('[data-motion-surface]') === host;
  const native = event => Boolean(event.target.closest(NATIVE));
  const blocked = () => Boolean(isBlocked?.());
  const notify = () => invalidate?.();

  function position(event) {
    const rect = host.getBoundingClientRect();
    raw.x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    raw.y = Math.max(-1, Math.min(1, 1 - (event.clientY - rect.top) / rect.height * 2));
    raw.inside = true; raw.pointerType = event.pointerType;
  }

  function end(cancelled) {
    if (gesture && raw.dragging) {
      suppressedUntil = performance.now() + 450;
      onDragEnd?.({ dx: raw.dx, dy: raw.dy, cancelled });
    }
    const pointer = gesture?.id;
    gesture = null;
    raw.dragging = false; raw.dx = 0; raw.dy = 0;
    if (pointer !== undefined && host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer);
    notify();
  }

  function clear() {
    end(true); pointers.clear();
    raw.inside = false; raw.x = 0; raw.y = 0;
  }

  function down(event) {
    if (!owns(event) || blocked()) return;
    pointers.add(event.pointerId);
    if (pointers.size > 1) { end(true); return; }
    if (!event.isPrimary || native(event) || event.button !== 0) return;
    position(event);
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, vertical: false };
    notify();
  }

  function move(event) {
    if (!owns(event) || blocked() || pointers.size > 1) return;
    if (native(event) && !gesture) { raw.inside = false; raw.x = 0; raw.y = 0; notify(); return; }
    position(event);
    if (gesture && gesture.id === event.pointerId && !gesture.vertical) {
      raw.dx = event.clientX - gesture.x; raw.dy = event.clientY - gesture.y;
      if (!raw.dragging && Math.hypot(raw.dx, raw.dy) > 8) {
        if (Math.abs(raw.dx) > Math.abs(raw.dy) * 1.2) {
          raw.dragging = true;
          host.setPointerCapture(event.pointerId);
          onDragStart?.({ x: raw.x, y: raw.y });
        } else gesture.vertical = true;
      }
      if (raw.dragging) onDrag?.({ dx: raw.dx, dy: raw.dy, x: raw.x, y: raw.y });
    }
    notify();
  }

  function up(event) {
    pointers.delete(event.pointerId);
    if (!gesture || gesture.id !== event.pointerId) return;
    if (!raw.dragging && !gesture.vertical && !blocked() && !native(event)) onTap?.({ x: raw.x, y: raw.y, trigger: host });
    end(false);
  }

  const on = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: events.signal });
  on(host, 'pointerdown', down);
  on(host, 'pointermove', move, { passive: true });
  on(host, 'pointerup', up);
  on(host, 'pointercancel', clear);
  on(host, 'lostpointercapture', () => { if (gesture) end(true); });
  on(host, 'pointerleave', () => { if (!gesture) clear(); });
  on(window, 'pointerup', event => { pointers.delete(event.pointerId); if (gesture?.id === event.pointerId) end(true); });
  on(window, 'blur', clear);
  on(document, 'visibilitychange', () => { if (document.hidden) clear(); });
  on(host, 'click', event => {
    if (performance.now() < suppressedUntil) { suppressedUntil = 0; event.preventDefault(); event.stopImmediatePropagation(); }
  }, { capture: true });
  on(host, 'keydown', event => {
    if (document.activeElement === host && !blocked() && onKey?.(event) === true) event.preventDefault();
  });
  return { read: () => raw, reset: clear, dispose() { clear(); events.abort(); } };
}
