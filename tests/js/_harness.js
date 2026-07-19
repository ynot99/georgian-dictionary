"use strict";
const fs = require("fs");
const path = require("path");

// Порядок має відповідати <script src> в templates/index.html — деякі файли
// звертаються на верхньому рівні до функцій з попередніх (напр. srs.js/chat.js/
// notes.js викликають registerKeyboardAwareOverlay з overlay.js одразу при завантаженні).
const APP_FILES = [
  "overlay.js", "store.js", "srs.js", "notify.js", "csv.js", "stats.js",
  "render.js", "chat.js", "notes.js", "main.js",
];
const APP_SCRIPT = APP_FILES.map((name) =>
  fs.readFileSync(path.join(__dirname, "..", "..", "static", "js", name), "utf8")
).join("\n");

function fakeEl() {
  return {
    addEventListener() {}, value: "", textContent: "", hidden: false,
    disabled: false, files: [], classList: { toggle() {} }, className: "",
    replaceChildren() {}, append() {}, click() {}, focus() {}, remove() {},
    scrollIntoView() {}, scrollLeft: 0, querySelector() { return null; },
    style: {}, lang: "", placeholder: "", title: "", scrollHeight: 0,
  };
}

// Виконує клієнтський скрипт зі static/app.js разом із переданим
// тестовим кодом в одній strict-mode eval-області, тож тестовий код має
// прямий доступ до функцій і змінних застосунку (SRS, теги, CSV, тощо).
function runInAppContext(testCode) {
  global.window = {
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    matchMedia: () => ({ matches: true }),
    scrollY: 0,
    scrollTo() {},
  };
  // синхронно — тестам не потрібно чекати справжній кадр анімації
  global.requestAnimationFrame = (cb) => { cb(); return 0; };
  global.document = {
    getElementById: () => fakeEl(),
    createElement: () => fakeEl(),
    body: { append() {}, style: {} },
    documentElement: { style: {} },
  };
  global.getComputedStyle = () => ({ borderTopWidth: "0px", borderBottomWidth: "0px" });
  // Node 24+ уже має вбудований global.navigator лише з getter'ом — пряме
  // присвоєння впало б у строгому режимі, тож перевизначаємо дескриптор.
  Object.defineProperty(global, "navigator", {
    value: {}, configurable: true, writable: true,
  });
  const storage = {};
  global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
    removeItem: (k) => { delete storage[k]; },
    setItem: (k, v) => { storage[k] = v; },
  };
  // Node 20+ вже має вбудовані crypto/fetch/Blob як глобальні lazy-getter'и —
  // define­Property надійніше за пряме "=" (яке падає в строгому режимі).
  const define = (name, value) =>
    Object.defineProperty(global, name, { value, configurable: true, writable: true });
  define("crypto", { randomUUID: () => "test-" + Math.random().toString(16).slice(2) });
  define("fetch", () => Promise.reject(new Error("offline in test")));
  define("Blob", function () {});
  define("confirm", () => true);
  define("AbortController", function () { this.signal = {}; this.abort = () => {}; });
  global.URL.createObjectURL = () => "blob:test";
  global.URL.revokeObjectURL = () => {};

  eval(APP_SCRIPT + testCode);
}

module.exports = { runInAppContext };
