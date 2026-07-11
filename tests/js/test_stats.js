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

// вага: чим нижчий рівень (гірше вивчено) — тим вища вага; без повторень
// (рівень 0 з обох напрямків) — максимальна вага
assert.ok(wodWeight(words[0]) < wodWeight(words[1]),
  "слово 'a' (рівні 5/2) має нижчу вагу за 'b' (без повторень, рівень 0)");

// регресія: підміняємо wodKey контрольованими значеннями, щоб детерміновано
// відтворити саме той баг, що був — раніше слово дня обиралось як
// sorted[h % sorted.length], і сам ІНДЕКС "плавав" від довжини масиву, тож
// вибір стрибав щоразу, коли додавалось хоч одне нове слово того ж дня.
// Зараз вибір — argmax власного ключа кожного слова, тож має лишатись
// незмінним, доки в нового слова ключ нижчий за вже переможне
const origWodKey = wodKey;
const fixedKeys = { a: 0.9, b: 0.1, c: 0.2 };
wodKey = (w) => fixedKeys[w.uuid];
assert.strictEqual(wordOfDay().uuid, "a", "має обрати слово з найвищим ключем");
words.push({
  uuid: "d", georgian: "ოთხი", translation: "чотири", example: "",
  tags: "", created_at: pastStr(0), synced: true,
});
fixedKeys.d = 0.05;   // нижчий ключ, ніж усі інші
assert.strictEqual(wordOfDay().uuid, "a",
  "нове слово з нижчим ключем не має міняти вибір (незалежно від довжини масиву)");
words.pop();
wodKey = origWodKey;

// переклад слова дня прихований, доки не "тапнути"; повторний тап ховає назад
assert.strictEqual(isWodRevealed(), false, "спочатку переклад має бути прихований");
toggleWod();
assert.strictEqual(isWodRevealed(), true, "після тапу переклад відкритий");
assert.strictEqual(localStorage.getItem("wodRevealedDate"), localDateKey());
toggleWod();
assert.strictEqual(isWodRevealed(), false, "повторний тап має сховати переклад назад");

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
