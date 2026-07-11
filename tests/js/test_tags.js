"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// нормалізація тегів
assert.strictEqual(normalizeTags(" Їжа, напої,їжа "), "їжа, напої");
assert.strictEqual(normalizeTags(""), "");
assert.strictEqual(normalizeTags(null), "");

// зарезервовані слова ("усі", "проблемні") ніколи не стають реальним тегом —
// інакше в панелі тегів було б два однакові на вигляд чипи
assert.strictEqual(normalizeTags("Усі"), "", "усі -> відфільтровано");
assert.strictEqual(normalizeTags("ПРОБЛЕМНІ"), "", "проблемні -> відфільтровано (без урахування регістру)");
assert.strictEqual(normalizeTags("їжа, усі, напої"), "їжа, напої", "серед інших тегів усі -> прибирається, решта лишається");

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

// віртуальний фільтр "проблемні слова" (LEECH_TAG) обмежує список і повторення так само, як тег
reviews = {
  "w2|ka2uk": { word_uuid: "w2", direction: "ka2uk", level: 0, due_at: "2020-01-01 00:00:00", reviewed_at: "2020-01-01 00:00:00", lapses: LEECH_THRESHOLD, synced: true },
};
assert.ok(isLeech(words[1]), "w2 має бути leech");
assert.ok(!isLeech(words[0]) && !isLeech(words[2]), "w1/w3 не leech");
activeTag = LEECH_TAG;
assert.strictEqual(wordsInScope().length, 1, "фільтр leech: " + wordsInScope().length);
assert.strictEqual(wordsInScope()[0].uuid, "w2");
c = collectDue();
assert.strictEqual(c.due.length, 1, "прострочена leech-картка потрапляє в due");
assert.strictEqual(c.due[0].w.uuid, "w2");
activeTag = null;
reviews = {};

// віртуальний фільтр "дієслова" (VERB_TAG): збігається з будь-яким тегом
// "дієслово:*", незалежно від конкретної форми; конкретний під-тег фільтрує точніше
words = [
  { uuid: "v1", georgian: "მივდივარ", translation: "я йду", example: "", tags: "дієслово:წასვლა", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "v2", georgian: "წავედი", translation: "я пішов", example: "", tags: "дієслово:წასვლა, минулий", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "v3", georgian: "ვჭამ", translation: "я їм", example: "", tags: "дієслово:ჭამა", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "v4", georgian: "წყალი", translation: "вода", example: "", tags: "напої", created_at: "2026-07-01 10:00:00", synced: true },
];
activeTag = VERB_TAG;
assert.strictEqual(wordsInScope().length, 3, "усі слова з дієслівним тегом, незалежно від конкретної форми");
assert.ok(wordsInScope().every((w) => w.uuid !== "v4"), "звичайний тег (напої) не потрапляє під VERB_TAG");
activeTag = "дієслово:წასვლა";
assert.deepStrictEqual(wordsInScope().map((w) => w.uuid).sort(), ["v1", "v2"], "конкретне дієслово фільтрує точніше за агрегат");
activeTag = null;

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
