"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// одруківка не прощається навіть поза строгим режимом: це інший відмінок
reviewStrict = false;
assert.ok(checkSentence("წყალს", "წყალს"));
assert.ok(checkSentence("  წყალს. ", "წყალს"));
assert.ok(!checkSentence("წყალი", "წყალს"));
assert.ok(!checkSentence("", "წყალს"));
assert.ok(checkSentence("მივდივარ", "მივდივარ, მივალ"), "варіант через кому");

const s = { sentence: "მე ____ ვსვამ.", answer: "წყალს, წყალსა" };
assert.strictEqual(filledSentence(s), "მე წყალს ვსვამ.");
assert.strictEqual(filledSentence({ sentence: "a ____", answer: "$&" }), "a $&");

// область: лише речення слів з активного тега
words = [
  { uuid: "w1", georgian: "a", translation: "a", tags: "їжа" },
  { uuid: "w2", georgian: "b", translation: "b", tags: "дім" },
];
sentences = [
  { id: 1, word_uuid: "w1", sentence: "x ____", answer: "a", translation: "t1", hint: "" },
  { id: 2, word_uuid: "w2", sentence: "y ____", answer: "b", translation: "t2", hint: "" },
  { id: 3, word_uuid: "gone", sentence: "z ____", answer: "c", translation: "t3", hint: "" },
];
assert.strictEqual(sentencesInScope().length, 2, "речення видаленого слова не показуємо");
activeTag = "їжа";
assert.deepStrictEqual(sentencesInScope().map((x) => x.id), [1]);

// сесія: помилка повертає речення в кінець, SRS не змінюється
const reviewsBefore = JSON.stringify(reviews);
startSentences();
assert.strictEqual(stCurrent.id, 1);
stInput.value = "неправильно";
checkSentenceTyped();
assert.strictEqual(stLastCorrect, false);
assert.strictEqual(stSentence.textContent, "x a");
advanceSentence();
assert.strictEqual(stCurrent.id, 1, "незнане речення повернулось");
stInput.value = "a";
checkSentenceTyped();
assert.strictEqual(stLastCorrect, true);
advanceSentence();
assert.strictEqual(stCurrent, null);
assert.strictEqual(stDoneCount, 1);
assert.strictEqual(JSON.stringify(reviews), reviewsBefore, "SRS не змінився");
advanceSentence();
assert.strictEqual(sentencesOverlay.hidden, true, "фінальна кнопка закриває вікно");

// ліміт сесії
activeTag = null;
words = [{ uuid: "w1", georgian: "a", translation: "a", tags: "" }];
sentences = Array.from({ length: 15 }, (_, i) => (
  { id: i, word_uuid: "w1", sentence: i + " ____", answer: "a", translation: "t", hint: "" }
));
startSentences();
assert.strictEqual(stQueue.length + 1, SENTENCES_PER_SESSION);
closeSentences();

// клавіатура: Enter іде далі лише після перевірки, Escape закриває
chatOverlay.hidden = true;    // у реальному DOM атрибут hidden стоїть у HTML
notesOverlay.hidden = true;
const kd = window.listeners.keydown[0];
const ev = (key) => ({ key, preventDefault() {} });
sentences = sentences.slice(0, 2);
startSentences();
const first = stCurrent;
kd(ev("Enter"));
assert.strictEqual(stCurrent, first, "до перевірки Enter лишається за формою");
stInput.value = "a";
checkSentenceTyped();
kd(ev("Enter"));
assert.notStrictEqual(stCurrent, first, "після перевірки Enter веде далі");
kd(ev("Escape"));
assert.strictEqual(sentencesOverlay.hidden, true);

// видалення слова локально прибирає його речення
dropLocalWord("w1");
assert.strictEqual(sentences.length, 0);
`);
