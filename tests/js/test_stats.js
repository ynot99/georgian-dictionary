"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

const day = 86400000;
const pastStr = (d) => new Date(Date.now() - d * day).toISOString().slice(0, 19).replace("T", " ");

words = [
  { uuid: "a", georgian: "ერთი", translation: "один", example: "", tags: "", created_at: pastStr(10), synced: true },
  { uuid: "b", georgian: "ორი", translation: "два", example: "", tags: "", created_at: pastStr(2), synced: true },
  { uuid: "c", georgian: "სამი", translation: "три", example: "", tags: "", created_at: pastStr(0), synced: true },
];
reviews = {
  "a|ka2uk": { word_uuid: "a", direction: "ka2uk", level: 5, due_at: "2099-01-01 00:00:00", reviewed_at: pastStr(1), synced: true },
  "a|uk2ka": { word_uuid: "a", direction: "uk2ka", level: 2, due_at: "2099-01-01 00:00:00", reviewed_at: pastStr(1), synced: true },
};
activeTag = null;

// слово дня детерміноване в межах дня
const w1 = wordOfDay(), w2 = wordOfDay();
assert.ok(w1 && w1.uuid === w2.uuid, "слово дня має бути стабільним у межах дня");
const savedWords = words.slice();
words.length = 0;
assert.strictEqual(wordOfDay(), null, "порожній словник — нема слова дня");
words.push(...savedWords);

// statsData: додані за тиждень, рівні карток
let s = statsData();
assert.strictEqual(s.total, 3);
assert.strictEqual(s.addedWeek, 2, "за 7 днів: " + s.addedWeek);
assert.strictEqual(s.fresh, 4, "нових карток: " + s.fresh);
assert.strictEqual(s.learning, 1, "вивчаються: " + s.learning);
assert.strictEqual(s.solid, 1, "закріплені: " + s.solid);

// журнал повторень і серія
assert.strictEqual(s.reviewedToday, 0);
assert.strictEqual(s.streak, 0);
logReview(); logReview(); logReview();
s = statsData();
assert.strictEqual(s.reviewedToday, 3);
assert.strictEqual(s.streak, 1, "серія з одного дня: " + s.streak);
assert.strictEqual(s.last7.join(","), "0,0,0,0,0,0,3");

// серія з учорашнім днем
reviewLog[localDateKey(new Date(Date.now() - day))] = 5;
reviewLog[localDateKey(new Date(Date.now() - 2 * day))] = 2;
assert.strictEqual(streakDays(), 3, "серія 3 дні: " + streakDays());
assert.ok(!reviewLog[localDateKey(new Date(Date.now() - 3 * day))], "розрив 3 дні тому");

// якщо сьогодні ще не повторював — серія рахується до вчора
delete reviewLog[localDateKey()];
assert.strictEqual(streakDays(), 2, "серія до вчора: " + streakDays());

// grade() пише в журнал повторень
reviews = {}; queue = [{ w: words[0], dir: "ka2uk" }]; currentCard = null;
nextCard();
grade(true);
s = statsData();
assert.strictEqual(s.reviewedToday, 1, "grade має писати в журнал");

console.log("ВСЕ OK: слово дня, статистика і журнал повторень коректні");
`);
