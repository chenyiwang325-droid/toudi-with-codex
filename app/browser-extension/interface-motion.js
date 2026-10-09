// Native disclosures keep their semantic state; only their local geometry eases.
(() => {
  'use strict';
  const active = new WeakMap();
  const selectors = 'details.record,details.disclosure,details.settings-disclosure,details.review-details,details.scan-module,details.copy-reference,details.reference-material,details.industry-group,details.industry-subgroup,details.qb-fold,details.qb-group-fold,details.qb-co-fold,details.rv-qcard,details.rv-panel,details.rv-toc-inline,details.prep-toc-box';
  const reduced = () => document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  function restore(node, state) {
    if (active.get(node) !== state) return;
    node.open = state.open;
    state.animation.cancel();
    node.style.height = state.height;
    node.style.overflow = state.overflow;
    active.delete(node);
  }
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button > 0 || event.target.closest('button,a,input,select,textarea')) return;
    const summary = event.target.closest('summary'), node = summary?.parentElement;
    if (!node?.matches(selectors) || node.firstElementChild !== summary) return;
    const previous = active.get(node);
    if (reduced() || !node.animate) { if (previous) restore(node, previous); return; }
    event.preventDefault();
    const from = node.getBoundingClientRect().height, open = !(previous ? previous.open : node.open);
    const height = previous ? previous.height : node.style.height;
    const overflow = previous ? previous.overflow : node.style.overflow;
    previous?.animation.cancel();
    node.style.height = height;
    node.style.overflow = overflow;
    node.open = open;
    const to = node.getBoundingClientRect().height;
    // Keep content present until a close finishes. No opacity wash on text.
    node.open = true;
    node.style.overflow = 'hidden';
    const style = getComputedStyle(document.documentElement);
    const duration = parseFloat(style.getPropertyValue('--ui-motion-enter')) || 200;
    const easing = style.getPropertyValue('--ui-ease').trim() || 'ease-out';
    const animation = node.animate([{height: from+'px'}, {height: to+'px'}], {duration, easing, fill: 'forwards'});
    const state = {animation, open, height, overflow};
    active.set(node, state);
    animation.finished.then(() => restore(node, state), () => {});
  });
})();
