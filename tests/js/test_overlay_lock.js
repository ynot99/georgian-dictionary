"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// одне вікно: lock -> unlock повністю знімає блокування
lockBodyScroll();
assert.strictEqual(document.body.style.position, "fixed", "тіло має бути заблоковане");
unlockBodyScroll();
assert.strictEqual(document.body.style.position, "", "тіло має розблокуватись");

// вкладені вікна (напр. нотатки поверх чату): лічильник не дає розблокувати
// фон, поки закрите не останнє вікно
lockBodyScroll();   // чат відкрився
lockBodyScroll();   // нотатки відкрились поверх чату
assert.strictEqual(document.body.style.position, "fixed");
unlockBodyScroll(); // закрили нотатки
assert.strictEqual(document.body.style.position, "fixed", "чат ще відкритий — фон має лишатись заблокованим");
unlockBodyScroll(); // закрили чат
assert.strictEqual(document.body.style.position, "", "останнє вікно закрито — фон розблокований");

// зайвий unlockBodyScroll() без відповідного lock не має ламати лічильник
unlockBodyScroll();
lockBodyScroll();
assert.strictEqual(document.body.style.position, "fixed");
unlockBodyScroll();
assert.strictEqual(document.body.style.position, "", "лічильник не пішов у мінус");

// На десктопі (немає екранної клавіатури) position:fixed на body НЕ ставимо:
// він потрібен лише проти iOS-механізму "прокрутити фокусоване поле над
// клавіатурою", а тут лише ламає координати абсолютних елементів, які
// розширення браузера вкидають у body (попап перекладача при виділенні слова).
window.matchMedia = () => ({ matches: false });   // (pointer: coarse) не збігся
lockBodyScroll();
assert.strictEqual(document.body.style.position, "", "на десктопі body не має ставати fixed");
assert.strictEqual(document.body.style.top, "", "і не має зсуватись на -scrollY");
assert.strictEqual(document.body.style.overflow, "hidden", "але скрол однаково заблокований");
assert.strictEqual(document.documentElement.style.overflow, "hidden");
unlockBodyScroll();
assert.strictEqual(document.body.style.overflow, "", "розблокування знімає overflow");

// сенсорний пристрій — хак лишається, бо там він і потрібен
window.matchMedia = () => ({ matches: true });    // (pointer: coarse) збігся
lockBodyScroll();
assert.strictEqual(document.body.style.position, "fixed", "на телефоні body лишається fixed");
unlockBodyScroll();
assert.strictEqual(document.body.style.position, "");

console.log("ВСЕ OK: блокування скролу фону для вкладених вікон коректне");
`);
