// 只管理商品环绕与吸附；时钟由共享runtime提供。
export const TURN_SECONDS = 40;
export const TURN_RATE = Math.PI * 2 / TURN_SECONDS;
const STEP = Math.PI * 2 / 3;

export function createOrbitState() {
  let angle = 0, target = null, selected = 0, dragStart = 0, dragging = false;
  const nearest = value => angle + Math.atan2(Math.sin(value - angle), Math.cos(value - angle));
  return {
    select(index, immediate = false) {
      selected = index;
      target = nearest(-index * STEP);
      if (immediate) { angle = target; target = null; }
    },
    beginDrag() { dragStart = angle; dragging = true; target = null; },
    drag(dx, width) { if (dragging) angle = dragStart + dx / width * Math.PI * 2; },
    endDrag(cancelled = false) {
      dragging = false;
      if (!cancelled) {
        selected = ((Math.round(-angle / STEP) % 3) + 3) % 3;
        target = nearest(-selected * STEP);
      }
      return selected;
    },
    // 弹簧使用dt，自转可单独接收未被帧率截断的活动时间。
    update(dt, state, automaticDt = dt) {
      if (!state.active || state.hidden || state.modalOpen || state.menuOpen || dragging) return false;
      if (state.reducedMotion) {
        if (target !== null) { angle = target; target = null; }
        return false;
      }
      if (target !== null) {
        angle += (target-angle) * (1-Math.exp(-10*dt));
        if (Math.abs(target-angle)<.0001) { angle=target;target=null; }
        return target !== null || !state.hovered;
      }
      if (state.hovered) return false;
      angle += TURN_RATE * automaticDt;
      return true;
    },
    inspect: () => ({ angle, target, selected, dragging, settling: target !== null }),
  };
}
