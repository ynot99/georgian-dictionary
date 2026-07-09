"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

const kd = window.listeners.keydown[0];
const ev = (key) => ({ key, preventDefault() {} });
chatOverlay.hidden = true;   // у реальному DOM атрибут hidden стоїть у HTML

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

// пробіл теж відкриває; 1 = "не знав" (картка повертається в чергу)
kd(ev(" "));
assert.ok(!rvWrong.hidden, "пробіл має відкрити відповідь");
const qlen = queue.length;
kd(ev("1"));
assert.ok(queue.length === qlen + 1 || currentCard !== null, "1 = не знав, картка в черзі");

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

// фінальний екран: Enter закриває
queue = [];
overlay.hidden = false;
nextCard();
kd(ev("Enter"));
assert.ok(overlay.hidden, "Enter має закрити фінальний екран");

console.log("ВСЕ OK: клавіатурне керування сесією коректне");
`);
