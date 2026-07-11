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

// cloze-підказка: точний збіг слова в прикладі -> пропуск замість нього
assert.strictEqual(clozeHint(words[1]), "____ და წყალი", "приклад містить точне слово -> пропуск");
assert.strictEqual(clozeHint(words[0]), null, "порожній приклад -> немає підказки");
assert.strictEqual(
  clozeHint({ georgian: "მაგიდა", example: "ეს არის სკამი." }),
  null, "слово не входить у приклад дослівно (напр. інша відмінкова форма) -> немає підказки"
);

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
assert.strictEqual(reviews[key2].lapses, 1, "перший провал -> lapses 1");
assert.strictEqual(queue[queue.length - 1], second, "забута картка має бути в кінці черги");

// lapses росте з кожним провалом і НЕ скидається при успіху (на відміну від level)
reviews[key2] = { ...reviews[key2], lapses: LEECH_THRESHOLD - 1 };
queue = [{ w: second.w, dir: second.dir }];
currentCard = null;
nextCard();
grade(false);
assert.strictEqual(reviews[key2].lapses, LEECH_THRESHOLD, "поріг leech досягнуто");
assert.ok(isLeech(second.w), "слово має позначитись як leech після " + LEECH_THRESHOLD + " провалів");
queue = [{ w: second.w, dir: second.dir }];
currentCard = null;
nextCard();
grade(true);
assert.strictEqual(reviews[key2].lapses, LEECH_THRESHOLD, "успішна відповідь не скидає lapses");
assert.ok(isLeech(second.w), "leech-позначка лишається навіть після успішного повторення");

// сесійний список провалених карток ("Ще раз провалені"): провал лишається
// зафіксованим, навіть якщо картку виправив пізніше в тій же сесії
reviews = {};
sessionWrong = [];
sessionWrongKeys = new Set();
queue = [{ w: words[0], dir: "ka2uk" }, { w: words[1], dir: "ka2uk" }];
currentCard = null;
doneCount = 0;
nextCard();
grade(false);   // words[0] провалено -> в кінець черги і в sessionWrong
assert.strictEqual(sessionWrong.length, 1, "провал потрапляє в sessionWrong");
grade(true);    // words[1] — правильно
grade(true);    // words[0] повернулось після провалу — цього разу правильно
assert.strictEqual(currentCard, null, "черга має закінчитись");
assert.strictEqual(sessionWrong.length, 1, "sessionWrong не чиститься від виправлення в тій же сесії");
assert.strictEqual(sessionWrong[0].w.uuid, "w1");

const levelBeforeRetry = reviews["w1|ka2uk"].level;
const dueBeforeRetry = reviews["w1|ka2uk"].due_at;

retryWrong();
assert.strictEqual(sessionWrong.length, 0, "retryWrong очищує список для нового міні-раунду");
assert.strictEqual(currentCard.w.uuid, "w1", "retryWrong перезапускає чергу лише провалених карток");
assert.ok(inRetryRound, "прапорець міні-раунду має бути увімкнений");
grade(true);   // практика: успіх у міні-раунді НЕ рухає SRS-прогрес далі
assert.strictEqual(currentCard, null, "міні-раунд з однієї картки одразу завершується");
assert.strictEqual(doneCount, 1, "doneCount рахує лише поточний міні-раунд, не всю сесію");
assert.strictEqual(reviews["w1|ka2uk"].level, levelBeforeRetry, "успіх у міні-раунді не рухає level далі");
assert.strictEqual(reviews["w1|ka2uk"].due_at, dueBeforeRetry, "успіх у міні-раунді не рухає due_at далі");

// провал у міні-раунді — це НЕ безкоштовна практика: рахується як справжній
// провал (level скидається, lapses росте), і слово знову йде в sessionWrong
sessionWrong = [{ w: words[0], dir: "ka2uk" }];
sessionWrongKeys = new Set(["w1|ka2uk"]);
const lapsesBeforeRetryFail = reviews["w1|ka2uk"].lapses;
retryWrong();
grade(false);
assert.strictEqual(reviews["w1|ka2uk"].level, 0, "провал у міні-раунді скидає level так само, як звичайний провал");
assert.strictEqual(reviews["w1|ka2uk"].lapses, lapsesBeforeRetryFail + 1, "провал у міні-раунді рахується в lapses");
assert.strictEqual(sessionWrong.length, 1, "провал у міні-раунді знову потрапляє в sessionWrong для наступного раунду");

startReview();
assert.strictEqual(inRetryRound, false, "нова звичайна сесія скидає прапорець міні-раунду");

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
