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

console.log("ВСЕ OK: блокування скролу фону для вкладених вікон коректне");
`);
