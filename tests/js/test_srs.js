"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

words = [
  { uuid: "w1", georgian: "წყალი", translation: "вода", example: "", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "w2", georgian: "პური", translation: "хліб", example: "პური და წყალი", created_at: "2026-07-01 10:00:00", synced: true },
];
reviews = {};
activeTag = null;

// без прогресу всі картки нові: 2 слова x 2 напрямки
let c = collectDue();
assert.strictEqual(c.due.length, 0);
assert.strictEqual(c.fresh.length, 4, "нові картки: " + c.fresh.length);

// правильна відповідь піднімає рівень і відкладає на майбутнє
startReview();
const first = currentCard;
grade(true);
const key1 = first.w.uuid + "|" + first.dir;
assert.strictEqual(reviews[key1].level, 1);
assert.ok(reviews[key1].due_at > nowStr(), "due_at має бути в майбутньому");
assert.strictEqual(reviews[key1].synced, false);

// неправильна відповідь: рівень 0, картка повертається в чергу
const second = currentCard;
grade(false);
const key2 = second.w.uuid + "|" + second.dir;
assert.strictEqual(reviews[key2].level, 0);
assert.strictEqual(queue[queue.length - 1], second, "забута картка має бути в кінці черги");

// прострочена картка потрапляє в due, майбутня — ні
reviews = {
  "w1|ka2uk": { word_uuid: "w1", direction: "ka2uk", level: 2, due_at: "2020-01-01 00:00:00", reviewed_at: "2020-01-01 00:00:00", synced: true },
  "w1|uk2ka": { word_uuid: "w1", direction: "uk2ka", level: 3, due_at: "2099-01-01 00:00:00", reviewed_at: "2026-07-01 00:00:00", synced: true },
};
c = collectDue();
assert.strictEqual(c.due.length, 1);
assert.strictEqual(c.due[0].w.uuid, "w1");
assert.strictEqual(c.due[0].dir, "ka2uk");
assert.strictEqual(c.fresh.length, 2, "w2 має 2 нові картки: " + c.fresh.length);

// рівень не росте вище стелі INTERVALS.length
reviews["w1|ka2uk"].level = 7;
queue = [{ w: words[0], dir: "ka2uk" }];
currentCard = null;
nextCard();
grade(true);
assert.strictEqual(reviews["w1|ka2uk"].level, 7, "рівень не має рости вище стелі");

// видалення слова прибирає і його прогрес
dropLocalWord("w1");
assert.ok(!("w1|ka2uk" in reviews) && !("w1|uk2ka" in reviews));
assert.strictEqual(words.length, 1);
assert.strictEqual(words[0].uuid, "w2");

console.log("ВСЕ OK: клієнтська SRS-логіка коректна");
`);
