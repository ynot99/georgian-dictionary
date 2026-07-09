"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// звичайний текст без посилань
assert.deepStrictEqual(parseNoteRefs("просто текст"), [{ type: "text", value: "просто текст" }]);

// одне посилання в середині тексту
let parts = parseNoteRefs("Це працює через [[note:12|Родовий відмінок]], бачиш?");
assert.deepStrictEqual(parts, [
  { type: "text", value: "Це працює через " },
  { type: "note", id: 12, title: "Родовий відмінок" },
  { type: "text", value: ", бачиш?" },
]);

// кілька посилань підряд, без тексту між ними
parts = parseNoteRefs("[[note:1|А]][[note:2|Б]]");
assert.deepStrictEqual(parts, [
  { type: "note", id: 1, title: "А" },
  { type: "note", id: 2, title: "Б" },
]);

// посилання на самому початку/в кінці
parts = parseNoteRefs("[[note:5|Тест]] далі текст");
assert.strictEqual(parts[0].type, "note");
assert.strictEqual(parts[0].id, 5);
assert.strictEqual(parts[1].value, " далі текст");

// текст без жодного посилання, з квадратними дужками іншого формату — не плутається
parts = parseNoteRefs("звичайні [дужки] тут не посилання");
assert.deepStrictEqual(parts, [{ type: "text", value: "звичайні [дужки] тут не посилання" }]);

// порожній текст
assert.deepStrictEqual(parseNoteRefs(""), []);

console.log("ВСЕ OK: парсер посилань на нотатки [[note:ID|Назва]] коректний");
`);
