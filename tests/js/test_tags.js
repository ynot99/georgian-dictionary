"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// нормалізація тегів
assert.strictEqual(normalizeTags(" Їжа, напої,їжа "), "їжа, напої");
assert.strictEqual(normalizeTags(""), "");
assert.strictEqual(normalizeTags(null), "");

// tagList
assert.deepStrictEqual(tagList({ tags: "їжа, напої" }), ["їжа", "напої"]);
assert.strictEqual(tagList({}).length, 0);

// фільтр за тегом обмежує список і повторення
words = [
  { uuid: "w1", georgian: "ღვინო", translation: "вино", example: "", tags: "напої", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "w2", georgian: "პური", translation: "хліб", example: "", tags: "їжа", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "w3", georgian: "წყალი", translation: "вода", example: "", tags: "напої, базове", created_at: "2026-07-01 10:00:00", synced: true },
];
reviews = {};
activeTag = null;
assert.strictEqual(wordsInScope().length, 3);
activeTag = "напої";
assert.strictEqual(wordsInScope().length, 2, "фільтр напої: " + wordsInScope().length);
let c = collectDue();
assert.strictEqual(c.fresh.length, 4, "повторення лише в межах тега: " + c.fresh.length);
activeTag = null;
c = collectDue();
assert.strictEqual(c.fresh.length, 6, "без фільтра всі картки: " + c.fresh.length);

// addWord нормалізує теги
addWord("კატა", "кіт", "", " Тварини,тварини ");
assert.strictEqual(words[0].tags, "тварини");

// CSV roundtrip з тегами
const rows = [["uuid", "georgian", "translation", "example", "tags", "created_at"],
  ["w9", "ძაღლი", "пес", "", "тварини, дім", "2026-07-01 10:00:00"]];
const csv = rows.map((r) => r.map(csvField).join(",")).join("\\r\\n");
const ws = csvToWords(csv);
assert.strictEqual(ws[0].tags, "тварини, дім");

// старий формат CSV без колонки tags — далі працює
const old = csvToWords("uuid,georgian,translation\\nw5,მზე,сонце\\n");
assert.strictEqual(old[0].tags, "");

console.log("ВСЕ OK: клієнтська логіка тегів коректна");
`);
