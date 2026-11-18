"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");
overlay.hidden = true;

const past = "2020-01-01 00:00:00";
words = [
  { uuid: "s1", georgian: "ჩოგბურთელი", translation: "тенісист", example: "", tags: "спорт", created_at: past, synced: true },
  { uuid: "s2", georgian: "წყალი", translation: "вода", example: "", tags: "спорт", created_at: past, synced: true },
];
reviews = {
  "s1|ka2uk": { word_uuid: "s1", direction: "ka2uk", level: 2, due_at: past, reviewed_at: past, lapses: 5, synced: true },
  "s2|ka2uk": { word_uuid: "s2", direction: "ka2uk", level: 1, due_at: past, reviewed_at: past, lapses: 0, synced: true },
};
suspensions = {};
sentences = [{ id: 1, word_uuid: "s1", sentence: "____", answer: "x", translation: "x", hint: "" }];
activeTag = null;

// до відкладання: s1 — проблемне, обидва слова в повторенні
assert.ok(isLeech(words[0]));
assert.strictEqual(collectDue().due.length + collectDue().fresh.length, 4);

setSuspended(words[0], true);
assert.ok(isSuspended(words[0]) && !isSuspended(words[1]));
assert.strictEqual(suspensions.s1.synced, false, "нова позначка чекає синхронізації");
assert.ok(!isLeech(words[0]), "відкладене слово не позначається проблемним");

// повторення, тренування за тегом, речення, слово дня — без відкладеного слова
const { due, fresh } = collectDue();
assert.ok([...due, ...fresh].every((c) => c.w.uuid === "s2"), "повторення без відкладеного");
activeTag = "спорт";
assert.ok(collectPractice().every((c) => c.w.uuid === "s2"), "тренування тега без відкладеного");
assert.strictEqual(sentencesInScope().length, 0, "речення відкладеного слова не показуються");
assert.strictEqual(wordsInScope().length, 2, "у списку за тегом слово лишається");
activeTag = null;
assert.strictEqual(wordOfDay().uuid, "s2");

// фільтр "відкладені": у списку й тренуванні — лише вони, у повторенні — нічого
activeTag = SUSPENDED_TAG;
assert.deepStrictEqual(wordsInScope().map((w) => w.uuid), ["s1"]);
assert.strictEqual(collectDue().due.length + collectDue().fresh.length, 0);
assert.strictEqual(collectPractice().length, 2, "тренування відкладених можливе");
assert.strictEqual(sentencesInScope().length, 1);
activeTag = null;

// "відкладені" — зарезервоване слово, справжнім тегом не стає
assert.strictEqual(normalizeTags("Відкладені, спорт"), "спорт");

// відкласти під час сесії: обидва напрямки зникають з черги й з "Ще раз провалені",
// прогрес SRS не змінюється
suspensions = {};
startReview();
const first = currentCard.w;
sessionWrong = [{ w: first, dir: "uk2ka" }];
const levelBefore = reviews[first.uuid + "|ka2uk"].level;
suspendCurrent();
assert.ok(isSuspended(first));
assert.ok(queue.every((c) => c.w.uuid !== first.uuid), "у черзі не лишилось карток слова");
assert.ok(currentCard === null || currentCard.w.uuid !== first.uuid);
assert.strictEqual(sessionWrong.length, 0);
assert.strictEqual(reviews[first.uuid + "|ka2uk"].level, levelBefore, "рівень не змінився");

// повернення: позначка лишається (suspended=false), щоб перемогти на сервері за часом
setSuspended(first, false);
assert.ok(!isSuspended(first));
assert.strictEqual(suspensions[first.uuid].suspended, false);

// видалення слова прибирає і його позначку
setSuspended(words[0], true);
dropLocalWord("s1");
assert.ok(!("s1" in suspensions));

console.log("test_suspend: OK");
`);
