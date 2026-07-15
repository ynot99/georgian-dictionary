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

// ---------- фільтр "лише важливі" (⭐) ----------

const notes = [
  { id: 1, title: "А", starred: 1 },
  { id: 2, title: "Б", starred: 0 },
  { id: 3, title: "В", starred: 1 },
];

// фільтр вимкнено -> усі нотатки як є
assert.deepStrictEqual(visibleNotes(notes, false), notes);

// фільтр увімкнено -> лише starred
assert.deepStrictEqual(visibleNotes(notes, true), [notes[0], notes[2]]);

// жодної важливої -> порожній список, а не всі
assert.deepStrictEqual(visibleNotes([{ id: 1, title: "А", starred: 0 }], true), []);

console.log("ВСЕ OK: visibleNotes() фільтрує лише за starred, не чіпає порядок/дані");
`);
