"use strict";

// ---------- вправи на реченнях ----------

// Речення готуються заздалегідь (POST /api/sentences) і лежать у локальній копії,
// тож під час вправи немає ні запитів до Claude, ні потреби в мережі. Це практика
// поза розкладом: як і тренування за тегом, вправа нічого не пише в SRS.
const SENTENCES_PER_SESSION = 10;

function sentencesInScope() {
  const uuids = new Set(wordsInScope().map((w) => w.uuid));
  return sentences.filter((s) => uuids.has(s.word_uuid));
}

// Без прощення одруківок, незалежно від reviewStrict: одна літера тут часто і є
// відмінковим закінченням (წყალი/წყალს), яке вправа й перевіряє
function checkSentence(typed, answer) {
  const t = normAnswer(typed);
  return !!t && answerVariants(answer).includes(t);
}

function filledSentence(s) {
  const firstVariant = s.answer.split(/[,;\/]/)[0].trim();
  return s.sentence.replace("____", () => firstVariant);
}

let stQueue = [];
let stCurrent = null;
let stDoneCount = 0;
let stLastCorrect = false;

const sentencesOverlay = document.getElementById("sentences-overlay");
registerKeyboardAwareOverlay(sentencesOverlay);
const stProgress = document.getElementById("st-progress");
const stSentence = document.getElementById("st-sentence");
const stTranslation = document.getElementById("st-translation");
const stVerdict = document.getElementById("st-verdict");
const stGrammar = document.getElementById("st-grammar");
const stDone = document.getElementById("st-done");
const stForm = document.getElementById("st-form");
const stInput = document.getElementById("st-input");
const stNext = document.getElementById("st-next");
document.getElementById("st-keys").hidden = !hasPointer;

function startSentences() {
  stQueue = shuffle(sentencesInScope()).slice(0, SENTENCES_PER_SESSION);
  stDoneCount = 0;
  sentencesOverlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
  forceReflow(sentencesOverlay);   // щоб автофокус нижче бачив уже готову геометрію вікна
  nextSentence();
}

function nextSentence() {
  stCurrent = stQueue.shift() || null;
  const finished = stCurrent === null;
  stVerdict.hidden = stGrammar.hidden = true;
  stSentence.hidden = stTranslation.hidden = finished;
  stDone.hidden = !finished;
  stForm.hidden = finished;
  stNext.hidden = !finished;
  stNext.textContent = "Закрити";
  if (finished) {
    stProgress.textContent = "";
    stDone.textContent = `Готово! Пройдено речень: ${stDoneCount} ✍️ SRS не змінився.`;
    return;
  }
  stProgress.textContent = `✍️ Речення (без SRS) · Залишилось: ${stQueue.length + 1}`;
  stSentence.textContent = stCurrent.sentence;
  stTranslation.textContent = stCurrent.translation;
  stInput.value = "";
  stInput.focus();
}

function checkSentenceTyped() {
  const typed = stInput.value.trim();
  stLastCorrect = checkSentence(typed, stCurrent.answer);
  if (typed) {
    stVerdict.textContent = stLastCorrect ? "✅ Правильно!" : `❌ Ти написав: ${typed}`;
    stVerdict.className = "rv-verdict " + (stLastCorrect ? "ok" : "bad");
    stVerdict.hidden = false;
  }
  stSentence.textContent = filledSentence(stCurrent);
  stGrammar.textContent = stCurrent.hint;
  stGrammar.hidden = !stCurrent.hint;
  stForm.hidden = true;
  stNext.textContent = "Далі";
  stNext.hidden = false;
}

// кнопка під результатом: далі по черзі, а на фінальному екрані — закрити
function advanceSentence() {
  if (stCurrent === null) {
    closeSentences();
    return;
  }
  if (stLastCorrect) stDoneCount++;
  else stQueue.push(stCurrent);   // незнане речення — в кінець цієї ж сесії
  nextSentence();
}

function closeSentences() {
  sentencesOverlay.hidden = true;
  unlockBodyScroll();
  render();
}
