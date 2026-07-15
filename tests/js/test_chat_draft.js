"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// чернетка недописаного повідомлення переживає закриття вкладки (не лише
// перехід між екранами в межах тієї ж сесії) — тому localStorage, а не
// проста змінна в пам'яті
chatInput.value = "привіт, я хотів спитати";
saveChatDraft();
assert.strictEqual(localStorage.getItem("chatDraft"), "привіт, я хотів спитати",
  "текст у полі вводу має зберігатись як чернетка");

chatInput.value = "";
saveChatDraft();
assert.strictEqual(localStorage.getItem("chatDraft"), null,
  "порожнє поле -> чернетка прибирається, а не зберігається як порожній рядок");

console.log("ВСЕ OK: чернетка повідомлення чату зберігається/прибирається коректно");
`);
