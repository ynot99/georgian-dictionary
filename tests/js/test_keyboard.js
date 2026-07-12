"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

const kd = window.listeners.keydown[0];
const ev = (key) => ({ key, preventDefault() {} });
chatOverlay.hidden = true;    // у реальному DOM атрибут hidden стоїть у HTML
notesOverlay.hidden = true;

words = [{ uuid: "w1", georgian: "წყალი", translation: "вода", example: "", tags: "", created_at: "2026-07-01 10:00:00", synced: true }];
reviews = {};
activeTag = null;

// режим показу: Enter відкриває відповідь, 2 = "знав"
reviewMode = "flip";
startReview();
assert.ok(!overlay.hidden);
assert.ok(rvWrong.hidden, "оцінки ще приховані");
kd(ev("Enter"));
assert.ok(!rvWrong.hidden, "Enter має відкрити відповідь");
const doneBefore = doneCount;
kd(ev("2"));
assert.strictEqual(doneCount, doneBefore + 1, "2 = знав");
assert.ok(rvWrong.hidden, "наступна картка — знову лицьова сторона");

// пробіл теж відкриває; 1 = "не знав" (лічильник провалів росте, level = 0)
kd(ev(" "));
assert.ok(!rvWrong.hidden, "пробіл має відкрити відповідь");
const cardBefore1 = currentCard;
const key1 = cardBefore1.w.uuid + "|" + cardBefore1.dir;
const lapsesBefore = (reviews[key1] && reviews[key1].lapses) || 0;
kd(ev("1"));
assert.strictEqual(reviews[key1].level, 0, "1 = не знав -> level 0");
assert.strictEqual(reviews[key1].lapses, lapsesBefore + 1, "1 = не знав -> lapses +1");
// єдине слово в тесті — забута картка повертається в чергу і одразу ж
// з'являється знову (більше нема з чого вибирати)
assert.strictEqual(currentCard, cardBefore1, "картка має повернутись у чергу, а не зникнути");

// Enter на лицьовій стороні без вердикту не має оцінювати
assert.ok(rvWrong.hidden);
kd(ev("Enter"));
const doneMid = doneCount;
kd(ev("Enter"));
assert.strictEqual(doneCount, doneMid, "Enter без вердикту не має оцінювати");
kd(ev("2"));

// режим друкування: вердикт + Enter підтверджує
reviewMode = "type";
if (currentCard === null) { queue = [{ w: words[0], dir: "ka2uk" }]; nextCard(); }
else presentCard();
rvInput.value = "вода";
checkTyped();
assert.strictEqual(lastVerdict, true);
const doneBeforeConfirm = doneCount;
kd(ev("Enter"));
assert.strictEqual(doneCount, doneBeforeConfirm + 1, "Enter має підтвердити вердикт як 'знав'");

// неправильна відповідь: Enter підтверджує як "не знав"
if (currentCard === null) { queue = [{ w: words[0], dir: "ka2uk" }]; nextCard(); }
const failKey = currentCard.w.uuid + "|" + currentCard.dir;
rvInput.value = "хліб";
checkTyped();
assert.strictEqual(lastVerdict, false);
kd(ev("Enter"));
assert.strictEqual(reviews[failKey].level, 0, "Enter має підтвердити 'не знав'");

// Escape закриває сесію
assert.ok(!overlay.hidden);
kd(ev("Escape"));
assert.ok(overlay.hidden, "Escape має закрити сесію");

// фінальний екран, є що повторити (кнопка "Ще раз провалені" видима):
// Enter одразу починає міні-раунд, а НЕ закриває вікно
queue = [];
overlay.hidden = false;
sessionWrong = [{ w: words[0], dir: "ka2uk" }];
sessionWrongKeys = new Set(["w1|ka2uk"]);
nextCard();
assert.ok(!rvRetryWrong.hidden, "є що повторити -> кнопка видима");
kd(ev("Enter"));
assert.ok(!overlay.hidden, "Enter з видимою кнопкою retry не має закривати вікно");
assert.ok(inRetryRound, "Enter має запустити міні-раунд 'Ще раз провалені'");
assert.strictEqual(currentCard.w.uuid, "w1", "міні-раунд запускається саме з провалених карток");

// фінальний екран, повторювати нічого (кнопки нема): Enter закриває — стара
// поведінка лишається незмінною
queue = [];
sessionWrong = [];
sessionWrongKeys = new Set();
nextCard();
assert.ok(rvRetryWrong.hidden, "нема провалів -> кнопки нема");
kd(ev("Enter"));
assert.ok(overlay.hidden, "Enter без кнопки retry закриває фінальний екран, як і раніше");

// Escape на фінальному екрані завжди закриває ("пропустити"), незалежно від
// того, чи є що повторити
queue = [];
overlay.hidden = false;
sessionWrong = [{ w: words[0], dir: "ka2uk" }];
sessionWrongKeys = new Set(["w1|ka2uk"]);
nextCard();
kd(ev("Escape"));
assert.ok(overlay.hidden, "Escape завжди закриває фінальний екран, навіть якщо є що повторити");

console.log("ВСЕ OK: клавіатурне керування сесією коректне");
`);
