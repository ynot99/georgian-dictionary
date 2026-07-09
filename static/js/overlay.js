"use strict";

// ---------- повноекранні вікна: блокування скролу фону на мобільних ----------

// На iOS/Android фокус на полі всередині position:fixed вікна змушує браузер
// прокручувати ДОКУМЕНТ (а не саме вікно), щоб показати поле над клавіатурою —
// це і зсуває вікно, і робить так, що скрол потрапляє в список слів за ним.
// html { touch-action: pan-x pan-y } (нижче, проти pinch-zoom) сам собою
// дозволяє панорамування — тому саму лише position:fixed на body недостатньо,
// додатково глушимо overflow на html і body, поки відкрите хоч одне вікно.
let bodyScrollY = 0;
let openOverlayCount = 0;

function lockBodyScroll() {
  if (openOverlayCount++ > 0) return;
  bodyScrollY = window.scrollY;
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${bodyScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
}

function unlockBodyScroll() {
  if (openOverlayCount === 0 || --openOverlayCount > 0) return;
  document.documentElement.style.overflow = "";
  document.body.style.overflow = "";
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  window.scrollTo(0, bodyScrollY);
}

// CSS height:100dvh стискає вікно під клавіатуру, але не рятує від окремого
// iOS-механізму "прокрутити фокусоване поле над клавіатурою" — він зсуває
// видиму область так, що position:fixed (прив'язаний до layout viewport)
// вилазить за межі того, що реально видно. Підганяємо top/height під
// VisualViewport (реальну видиму область), поки відкрите вікно з полем вводу.
const keyboardAwareOverlays = [];

function registerKeyboardAwareOverlay(el) {
  keyboardAwareOverlays.push(el);
}

function syncOverlaysToViewport() {
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  for (const el of keyboardAwareOverlays) {
    if (el.hidden) continue;
    el.style.height = vv.height + "px";
    el.style.top = vv.offsetTop + "px";
  }
}

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncOverlaysToViewport);
  window.visualViewport.addEventListener("scroll", syncOverlaysToViewport);
}

// Автофокус одразу після появи вікна (в тому ж такті JS, до першого
// перемальовування) змушує iOS відкривати клавіатуру ще за геометрією
// СТАРОГО екрана (вікно технічно ще не намальоване) — звідси "видно фон
// крізь клавіатуру" лише при автофокусі, а не при ручному тапі пізніше.
// requestAnimationFrame це "лікує", але ламає інше: iOS Safari відкриває
// клавіатуру, лише коли .focus() викликаний СИНХРОННО в тому ж такті, що й
// дотик користувача ("довірений" жест) — відкладений виклик фокус ставить,
// але клавіатуру вже не показує. Замість відкладення читаємо layout-залежну
// властивість (forceReflow) — це змушує браузер порахувати layout негайно,
// і водночас лишається в тому самому синхронному такті кліку/тапу.
function forceReflow(el) {
  void el.offsetHeight;
}
