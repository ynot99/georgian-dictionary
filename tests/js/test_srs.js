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

// checkTyped() виявляє плутанину з відповіддю ІНШОГО слова і додає його в
// sessionWrong для практики цієї сесії — без штрафу lapses/level
reviews = {};
sessionWrong = [];
sessionWrongKeys = new Set();
queue = [{ w: words[0], dir: "ka2uk" }];   // words[0] = წყალი/вода
currentCard = null;
nextCard();
rvInput.value = words[1].translation;      // "хліб" — правильна відповідь ІНШОГО слова (words[1])
checkTyped();
assert.strictEqual(lastVerdict, false, "хліб — неправильна відповідь для წყალი");
assert.strictEqual(currentCard.w.uuid, "w1", "checkTyped сам по собі не рухає чергу");
assert.strictEqual(sessionWrong.length, 1, "плутанина з іншим словом додає його в sessionWrong");
assert.strictEqual(sessionWrong[0].w.uuid, "w2", "саме те слово, чию відповідь написав помилково");
assert.ok(!("w2|ka2uk" in reviews), "плутанина не штрафує lapses/level того слова напряму");

// звичайна помилка без збігу з іншим словом -> нічого зайвого в sessionWrong
sessionWrong = [];
sessionWrongKeys = new Set();
rvInput.value = "цілком стороннє слово";
checkTyped();
assert.strictEqual(sessionWrong.length, 0, "помилка без збігу з іншим словом не додає нічого стороннього");

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

// nextDueAt: серед майбутніх карток бере найРАНІШУ, ігноруючи прострочені
// (due_at <= now, вони й так уже в c.due) — сама due/fresh наявність її не
// цікавить, це окрема ручка, яку render.js викликає лише коли total === 0
assert.strictEqual(nextDueAt(), "2099-01-01 00:00:00", "єдина майбутня картка серед наявних (w1|uk2ka)");

reviews["w2|ka2uk"] = { word_uuid: "w2", direction: "ka2uk", level: 1, due_at: "2099-03-01 00:00:00", reviewed_at: "2026-07-01 00:00:00", synced: true };
reviews["w2|uk2ka"] = { word_uuid: "w2", direction: "uk2ka", level: 1, due_at: "2099-02-01 00:00:00", reviewed_at: "2026-07-01 00:00:00", synced: true };
assert.strictEqual(nextDueAt(), "2099-01-01 00:00:00", "серед кількох майбутніх карток обирає найранішу (не останню додану)");

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

// ---------- тренування за тегом (🎯): практика без запису в SRS ----------

words = [
  { uuid: "p1", georgian: "ბუ", translation: "сова", example: "", tags: "тварини", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "p2", georgian: "ხე", translation: "дерево", example: "", tags: "тварини", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "p3", georgian: "პური", translation: "хліб", example: "", tags: "їжа", created_at: "2026-07-01 10:00:00", synced: true },
];
reviews = {};
reviewLog = {};
activeTag = "тварини";

// у тренування йдуть УСІ картки тега (2 слова x 2 напрямки), незалежно від
// розкладу — на відміну від collectDue(), яке дало б лише прострочені/нові
reviews["p1|ka2uk"] = { word_uuid: "p1", direction: "ka2uk", level: 3, due_at: "2099-01-01 00:00:00", reviewed_at: "2026-07-01 00:00:00", lapses: 1, synced: true };
let practice = collectPractice();
assert.strictEqual(practice.length, 4, "усі картки тега: " + practice.length);
assert.ok(practice.every((c) => c.w.uuid !== "p3"), "слово з іншого тега не потрапляє");

// правильна відповідь у тренуванні НЕ рухає level/due_at і не пише в журнал
startPractice();
queue = [{ w: words[0], dir: "ka2uk" }];
currentCard = null;
nextCard();
grade(true);
assert.strictEqual(reviews["p1|ka2uk"].level, 3, "рівень не має змінитись");
assert.strictEqual(reviews["p1|ka2uk"].due_at, "2099-01-01 00:00:00", "due_at не має зрушити");
assert.deepStrictEqual(reviewLog, {}, "тренування не рахується в серію днів");

// провал у тренуванні теж нічого не псує: ні level, ні lapses
queue = [{ w: words[0], dir: "ka2uk" }];
currentCard = null;
nextCard();
grade(false);
assert.strictEqual(reviews["p1|ka2uk"].level, 3, "провал у тренуванні не скидає рівень");
assert.strictEqual(reviews["p1|ka2uk"].lapses, 1, "провал у тренуванні не додає lapses");
assert.deepStrictEqual(reviewLog, {}, "провал у тренуванні теж не пише в журнал");

// ...але картка все одно повертається в чергу і йде в "ще раз провалені" —
// це стан сесії, він до SRS не має стосунку
assert.strictEqual(sessionWrong.length, 1, "провалена картка потрапляє в sessionWrong");

// нове слово, якого SRS ще не бачив, після тренування лишається невідомим —
// тренування не має "створювати" прогрес із нічого
queue = [{ w: words[1], dir: "uk2ka" }];
currentCard = null;
nextCard();
grade(true);
assert.ok(!("p2|uk2ka" in reviews), "тренування не створює запис прогресу для нового слова");

// "слово, з яким сплутав" працює і в тренуванні: це стан сесії (sessionWrong),
// а не запис у SRS, тож practiceMode його не блокує
startPractice();
queue = [{ w: words[0], dir: "ka2uk" }];   // картка ბუ -> "сова"
currentCard = null;
nextCard();
assert.strictEqual(sessionWrong.length, 0, "старт сесії чистить список провалених");
rvInput.value = "хліб";                    // це правильна відповідь для p3 (პური)
checkTyped();
assert.ok(sessionWrong.some((c) => c.w.uuid === "p3"),
  "сплутане слово потрапляє в 'ще раз провалені' і в тренуванні");
assert.ok(!("p3|ka2uk" in reviews),
  "...але прогрес сплутаного слова в SRS не створюється");

// звичайне повторення після тренування знову пише в SRS (practiceMode скинуто)
startReview();
queue = [{ w: words[0], dir: "ka2uk" }];
currentCard = null;
nextCard();
grade(true);
assert.strictEqual(reviews["p1|ka2uk"].level, 4, "звичайне повторення знову рухає рівень");
assert.strictEqual(reviewLog[localDateKey()], 1, "звичайне повторення знову пише в журнал");

console.log("ВСЕ OK: тренування за тегом не зачіпає SRS");

// ---------- близнюки: складніший напрямок першим ----------

words = [
  { uuid: "s1", georgian: "ა", translation: "а-переклад", example: "", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "s2", georgian: "ბ", translation: "б-переклад", example: "", created_at: "2026-07-01 10:00:00", synced: true },
];
activeTag = null;

// harderCard: більше lapses -> складніший
reviews = {
  "s1|ka2uk": { word_uuid: "s1", direction: "ka2uk", level: 4, due_at: "2020-01-01 00:00:00", reviewed_at: "2020-01-01 00:00:00", lapses: 0, synced: true },
  "s1|uk2ka": { word_uuid: "s1", direction: "uk2ka", level: 1, due_at: "2020-01-01 00:00:00", reviewed_at: "2020-01-01 00:00:00", lapses: 3, synced: true },
};
const easy = { w: words[0], dir: "ka2uk" };   // 0 провалів, level 4 — легший
const hard = { w: words[0], dir: "uk2ka" };   // 3 провали — складніший
assert.ok(harderCard(hard, easy), "більше lapses -> складніший");
assert.ok(!harderCard(easy, hard), "менше lapses -> легший");

// за рівних lapses складнішим є менший level
reviews["s1|ka2uk"].lapses = 3;
assert.ok(harderCard({ w: words[0], dir: "uk2ka" }, { w: words[0], dir: "ka2uk" }),
  "за рівних lapses менший level (1 < 4) -> складніший");
reviews["s1|ka2uk"].lapses = 0;   // повертаємо для наступних перевірок

// orderSiblingsHarderFirst: легкий перед важким -> свопаються місцями
let cards = [easy, hard];
orderSiblingsHarderFirst(cards);
assert.strictEqual(cards[0].dir, "uk2ka", "складніший напрямок стає першим");
assert.strictEqual(cards[1].dir, "ka2uk");

// важкий уже перший -> порядок не міняється
cards = [hard, easy];
orderSiblingsHarderFirst(cards);
assert.strictEqual(cards[0].dir, "uk2ka", "уже правильний порядок лишається");

// свопаємо ЛИШЕ два близнюки, решту перемішаного порядку не чіпаємо:
// інша картка між ними лишається на своєму місці
const other = { w: words[1], dir: "ka2uk" };
cards = [easy, other, hard];
orderSiblingsHarderFirst(cards);
assert.strictEqual(cards[0].dir, "uk2ka", "важкий близнюк переїхав на позицію легкого (0)");
assert.strictEqual(cards[1].w.uuid, "s2", "стороння картка між близнюками лишилась на місці");
assert.strictEqual(cards[2].dir, "ka2uk", "легкий близнюк переїхав на позицію важкого (2)");

// лише один напрямок слова в черзі -> нічого не міняється
cards = [easy, other];
orderSiblingsHarderFirst(cards);
assert.strictEqual(cards[0].dir, "ka2uk", "один напрямок — впорядковувати нема що");
assert.strictEqual(cards[1].w.uuid, "s2");

// обидва fresh (немає запису reviews) -> рівні, без свопу (порядок стабільний)
reviews = {};
cards = [{ w: words[0], dir: "ka2uk" }, { w: words[0], dir: "uk2ka" }];
orderSiblingsHarderFirst(cards);
assert.strictEqual(cards[0].dir, "ka2uk", "нові близнюки рівні -> порядок не змінюється");

console.log("ВСЕ OK: близнюки впорядковуються складнішим напрямком уперед");
`);
