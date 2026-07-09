"use strict";
const fs = require("fs");
const path = require("path");

const APP_SCRIPT = fs.readFileSync(
  path.join(__dirname, "..", "..", "templates", "index.html"), "utf8"
).match(/<script>([\s\S]*?)<\/script>/)[1];

function fakeEl() {
  return {
    addEventListener() {}, value: "", textContent: "", hidden: false,
    disabled: false, files: [], classList: { toggle() {} }, className: "",
    replaceChildren() {}, append() {}, click() {}, focus() {}, remove() {},
    style: {}, lang: "", placeholder: "", title: "",
  };
}

// Виконує клієнтський <script> з templates/index.html разом із переданим
// тестовим кодом в одній strict-mode eval-області, тож тестовий код має
// прямий доступ до функцій і змінних застосунку (SRS, теги, CSV, тощо).
function runInAppContext(testCode) {
  global.window = {
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    matchMedia: () => ({ matches: true }),
  };
  global.document = {
    getElementById: () => fakeEl(),
    createElement: () => fakeEl(),
    body: { append() {} },
  };
  // Node 24+ уже має вбудований global.navigator лише з getter'ом — пряме
  // присвоєння впало б у строгому режимі, тож перевизначаємо дескриптор.
  Object.defineProperty(global, "navigator", {
    value: {}, configurable: true, writable: true,
  });
  const storage = {};
  global.localStorage = {
    getItem: (k) => (k in storage ? storage[k] : null),
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
