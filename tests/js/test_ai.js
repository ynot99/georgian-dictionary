"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");
overlay.hidden = true;

const past = "2020-01-01 00:00:00";
const word = (uuid, tags, synced = true) =>
  ({ uuid, georgian: uuid, translation: uuid, example: "", tags, created_at: past, synced });
words = [
  word("weak", "дім"), word("strong", "дім"), word("unseen", "дім"),
  word("covered", "дім"), word("local", "дім", false), word("food", "їжа"),
];
const card = (uuid, level, lapses) =>
  ({ word_uuid: uuid, direction: "ka2uk", level, due_at: past, reviewed_at: past, lapses, synced: true });
reviews = {
  "weak|ka2uk": card("weak", 1, 4),
  "strong|ka2uk": card("strong", 5, 0),
  "covered|ka2uk": card("covered", 0, 9),
  "food|ka2uk": card("food", 1, 0),
};
suspensions = {};
activeTag = "дім";
const ex = (id, word_uuid, review = "") =>
  ({ id, word_uuid, question: "q" + id, answer: "ჩვენი ბინა დიდია.", hint: "", model: "m", review, flagged: false });

// вибір слів: спершу без вправ, тоді вже бачені, серед них слабші; несинхронізовані — ні
const exercises = [ex(1, "covered"), ex(2, "weak", "bad")];
assert.deepStrictEqual(pickAiWords(exercises).map((w) => w.uuid), ["weak", "strong", "unseen", "covered"],
  "забракована вправа не рахується, covered — останнє");
assert.deepStrictEqual(pickAiWords(exercises, 2).map((w) => w.uuid), ["weak", "strong"]);
setSuspended(words[0], true);
assert.ok(!pickAiWords(exercises).some((w) => w.uuid === "weak"), "відкладене слово не береться");
suspensions = {};

// тренування: без забракованих і лише в межах активного тега
const all = [ex(1, "covered"), ex(2, "weak", "bad"), ex(3, "strong", "ok"), ex(4, "food")];
assert.deepStrictEqual(aiPracticePool(all).map((e) => e.id).sort(), [1, 3]);
activeTag = null;
assert.deepStrictEqual(aiPracticePool(all).map((e) => e.id).sort(), [1, 3, 4]);

// сесія: самооцінка, «не знав» повертає в кінець, SRS не змінюється
aiCache = [ex(3, "strong", "ok")];
const reviewsBefore = JSON.stringify(reviews);
startAiPractice();
assert.strictEqual(apCurrent.id, 3);
apInput.value = "  ჩვენი ბინა დიდია ";
revealAiAnswer();
assert.ok(apYours.textContent.includes("як в еталоні"), "збіг без урахування пунктуації");
assert.ok(!apWrong.hidden && !apRight.hidden && apForm.hidden);
gradeAiExercise(false);
assert.strictEqual(apCurrent.id, 3, "незнане речення повертається");
apInput.value = "ბინა დიდია";
revealAiAnswer();
assert.ok(!apYours.textContent.includes("як в еталоні"));
gradeAiExercise(true);
assert.strictEqual(apCurrent, null);
assert.ok(apDone.textContent.includes("Перекладено речень: 1"));
assert.strictEqual(JSON.stringify(reviews), reviewsBefore, "SRS не змінився");

aiCache = [];
startAiPractice();
assert.ok(apDone.textContent.includes("Немає вправ"), "порожня сесія пояснює, що робити");

assert.strictEqual(aiReviewLabel({ review: "bad", review_note: "не той відмінок" }), "✖ не вчити: не той відмінок");
console.log("test_ai: OK");
`);
