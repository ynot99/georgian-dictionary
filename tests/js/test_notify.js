"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

const PAST = "2020-01-01 00:00:00";       // давно прострочене
const SOON = "2099-01-01 00:00:00";       // майбутнє, ближче
const LATER = "2099-06-01 00:00:00";      // майбутнє, далі

words = [
  { uuid: "w1", georgian: "წყალი", translation: "вода", example: "", tags: "побут", created_at: PAST, synced: true },
  { uuid: "w2", georgian: "პური", translation: "хліб", example: "", tags: "їжа", created_at: PAST, synced: true },
];

// --- nextDueAtAll: найраніша МАЙБУТНЯ картка по всьому словнику ---

reviews = {};
assert.strictEqual(nextDueAtAll(), null, "нових карток нема -> нема що планувати");

reviews = {
  "w1|ka2uk": { word_uuid: "w1", direction: "ka2uk", level: 1, due_at: PAST, lapses: 0 },
};
assert.strictEqual(nextDueAtAll(), null, "лише прострочене (це база, не сигнал) -> null");

reviews["w1|uk2ka"] = { word_uuid: "w1", direction: "uk2ka", level: 2, due_at: LATER, lapses: 0 };
reviews["w2|ka2uk"] = { word_uuid: "w2", direction: "ka2uk", level: 2, due_at: SOON, lapses: 0 };
assert.strictEqual(nextDueAtAll(), SOON, "з кількох майбутніх повертає найранішу");

// активний тег НЕ впливає: дозрівання в будь-якій категорії важливе (на відміну
// від nextDueAt() з srs.js, який звужується до wordsInScope())
activeTag = "побут";   // w2 (їжа) поза областю, але його картка все одно найраніша
assert.strictEqual(nextDueAtAll(), SOON, "nextDueAtAll ігнорує activeTag");
activeTag = null;

// --- msUntilDue: знак відносно поточного моменту ---

assert.ok(msUntilDue(LATER) > 0, "майбутня дата -> додатня затримка");
assert.ok(msUntilDue(PAST) < 0, "минула дата -> від'ємна затримка");

// --- chimeStep: клампимо 32-бітну межу setTimeout і від'ємне ---

let s = chimeStep(1000);
assert.deepStrictEqual(s, { delay: 1000, done: true }, "звичайна затримка -> бренькаємо цього разу");

s = chimeStep(-50);
assert.deepStrictEqual(s, { delay: 0, done: true }, "картка вже дозріла на волосину -> зараз (0), бренькаємо");

s = chimeStep(MAX_TIMEOUT);
assert.deepStrictEqual(s, { delay: MAX_TIMEOUT, done: true }, "рівно межа -> ще влазить, бренькаємо");

s = chimeStep(MAX_TIMEOUT + 1);
assert.strictEqual(s.done, false, "понад межу -> проміжна порція (переплануємось, а не бренькнемо)");
assert.strictEqual(s.delay, MAX_TIMEOUT, "проміжна порція чекає рівно до межі");

// 120 днів (найдовший SRS-інтервал) точно переповнили б setTimeout -> порційно
const ms120d = 120 * 24 * 60 * 60 * 1000;
assert.strictEqual(chimeStep(ms120d).done, false, "120 днів не влазять у setTimeout -> порційно");

console.log("ВСЕ OK: звук планується на момент дозрівання, з клампом 32-бітної межі setTimeout");
`);
