"use strict";

// ---------- повторення (SRS) ----------

// Інтервали в днях для рівнів 1..7. Правильна відповідь піднімає рівень на 1,
// неправильна скидає на 0 (картка повернеться ще в цій же сесії).
const INTERVALS = [1, 3, 7, 14, 30, 60, 120];
const NEW_PER_SESSION = 10;   // щоб перша сесія не завалила сотнею нових карток
const DIRECTIONS = ["ka2uk", "uk2ka"];

function nowStr() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function dueDateStr(days) {
  return new Date(Date.now() + days * 86400000).toISOString()
    .slice(0, 19).replace("T", " ");
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// картки до повторення: прострочені + нові (ліміт на сесію);
// активний тег-фільтр обмежує і повторення — можна тренувати тему окремо
function collectDue() {
  const now = nowStr();
  const due = [], fresh = [];
  for (const w of wordsInScope()) {
    for (const dir of DIRECTIONS) {
      const r = reviews[w.uuid + "|" + dir];
      if (!r) fresh.push({ w, dir });
      else if (r.due_at <= now) due.push({ w, dir });
    }
  }
  return { due, fresh };
}

// ---- перевірка надрукованої відповіді ----

function normAnswer(s) {
  return (s || "").toLowerCase()
    .replace(/\(.*?\)/g, " ")                 // "(з поясненням)" не обов'язкове
    .replace(/[.,;:!?'"«»„"”()\/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "дякую, спасибі" → зараховуємо і повну форму, і кожен варіант окремо
function answerVariants(s) {
  const out = [];
  for (const v of [s, ...s.split(/[,;\/]/)]) {
    const n = normAnswer(v);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

// відстань Левенштейна ≤ 1 (одна одруківка: заміна, пропуск або зайва літера)
function within1Edit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function checkAnswer(typed, correct) {
  const t = normAnswer(typed);
  if (!t) return false;
  for (const v of answerVariants(correct)) {
    if (t === v) return true;
    // у строгому режимі (reviewStrict) одруківки не прощаються взагалі —
    // потрібно, щоб точно вивчити грузинське написання, буква в букву
    if (!reviewStrict && v.length >= 5 && within1Edit(t, v)) return true;
  }
  return false;
}

let queue = [];
let currentCard = null;
let doneCount = 0;
// "type" — друкуєш відповідь, "flip" — класичний показ; вибір запам'ятовується
let reviewMode = localStorage.getItem("reviewMode") || "type";
// строгий режим: вимикає прощення одруківок у checkAnswer
let reviewStrict = localStorage.getItem("reviewStrict") === "1";
// вердикт останньої перевірки (true/false), null якщо відповідь не друкувалась
let lastVerdict = null;
// підказки клавіш показуємо лише там, де ймовірно є клавіатура
const hasPointer = window.matchMedia && window.matchMedia("(hover: hover)").matches;

const overlay = document.getElementById("review-overlay");
registerKeyboardAwareOverlay(overlay);
const rvProgress = document.getElementById("rv-progress");
const rvDir = document.getElementById("rv-dir");
const rvFront = document.getElementById("rv-front");
const rvBack = document.getElementById("rv-back");
const rvEx = document.getElementById("rv-ex");
const rvDone = document.getElementById("rv-done");
const rvReveal = document.getElementById("rv-reveal");
const rvWrong = document.getElementById("rv-wrong");
const rvRight = document.getElementById("rv-right");
const rvMode = document.getElementById("rv-mode");
const rvStrict = document.getElementById("rv-strict");
const rvType = document.getElementById("rv-type");
const rvInput = document.getElementById("rv-input");
const rvVerdict = document.getElementById("rv-verdict");
const rvHint = document.getElementById("rv-hint");

function setHint(text) {
  rvHint.hidden = !hasPointer || !text;
  rvHint.textContent = text;
}

function startReview() {
  const { due, fresh } = collectDue();
  queue = [...shuffle(due), ...shuffle(fresh).slice(0, NEW_PER_SESSION)];
  doneCount = 0;
  overlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
  forceReflow(overlay);   // щоб автофокус нижче бачив уже готову геометрію вікна
  nextCard();
}

function updateModeBtn() {
  rvMode.textContent = reviewMode === "type" ? "⌨️" : "👁";
  rvMode.title = reviewMode === "type"
    ? "Режим: друкування відповіді (тап — перемкнути на показ)"
    : "Режим: показ відповіді (тап — перемкнути на друкування)";
  rvStrict.hidden = reviewMode !== "type";   // строгість стосується лише друкування
  rvStrict.textContent = reviewStrict ? "🔒" : "🔓";
  rvStrict.title = reviewStrict
    ? "Строгий режим: одруківки НЕ прощаються (тап — вимкнути)"
    : "Звичайний режим: одна одруківка прощається (тап — увімкнути строгий)";
}

function presentCard() {
  const finished = currentCard === null;
  updateModeBtn();
  rvDone.hidden = !finished;
  rvDir.hidden = rvFront.hidden = finished;
  rvBack.hidden = rvEx.hidden = rvVerdict.hidden = true;
  rvWrong.hidden = rvRight.hidden = true;
  rvMode.hidden = finished;
  lastVerdict = null;
  if (finished) {
    rvReveal.hidden = rvType.hidden = true;
    rvDone.textContent = doneCount
      ? `Готово! Повторено карток: ${doneCount} 🎉`
      : "Наразі немає карток до повторення. Приходь пізніше!";
    rvProgress.textContent = "";
    setHint("Enter — закрити");
    return;
  }
  const { w, dir } = currentCard;
  rvProgress.textContent = `Залишилось: ${queue.length + 1}`;
  rvDir.textContent = dir === "ka2uk" ? "ქართული → переклад" : "переклад → ქართული";
  rvFront.textContent = dir === "ka2uk" ? w.georgian : w.translation;
  rvBack.textContent = dir === "ka2uk" ? w.translation : w.georgian;
  if (reviewMode === "type") {
    rvReveal.hidden = true;
    rvType.hidden = false;
    rvInput.value = "";
    // семантична підказка мови поля (клавіатуру перемикаєш сам)
    rvInput.lang = dir === "uk2ka" ? "ka" : "uk";
    rvInput.placeholder = dir === "uk2ka" ? "ქართული…" : "Переклад…";
    setHint("Enter — перевірити");
    rvInput.focus();
  } else {
    rvType.hidden = true;
    rvReveal.hidden = false;
    setHint("Enter — показати відповідь");
  }
}

function nextCard() {
  currentCard = queue.shift() || null;
  presentCard();
}

function reveal() {
  rvBack.hidden = false;
  if (currentCard.w.example) {
    rvEx.textContent = currentCard.w.example;
    rvEx.hidden = false;
  }
  rvReveal.hidden = rvType.hidden = true;
  rvWrong.hidden = rvRight.hidden = false;
  setHint(lastVerdict === null
    ? "1 — не знав · 2 — знав"
    : "Enter — підтвердити · 1 — не знав · 2 — знав");
}

function checkTyped() {
  const typed = rvInput.value;
  const { w, dir } = currentCard;
  const correctText = dir === "ka2uk" ? w.translation : w.georgian;
  if (normAnswer(typed)) {
    const ok = checkAnswer(typed, correctText);
    lastVerdict = ok;
    rvVerdict.textContent = ok ? "✅ Правильно!" : `❌ Ти написав: ${typed.trim()}`;
    rvVerdict.className = "rv-verdict " + (ok ? "ok" : "bad");
    rvVerdict.hidden = false;
  }
  // порожній ввід = "не пам'ятаю, покажи" — без вердикту
  reveal();
}

function grade(correct) {
  const { w, dir } = currentCard;
  const key = w.uuid + "|" + dir;
  const prevLevel = reviews[key] ? reviews[key].level : 0;
  const level = correct ? Math.min(prevLevel + 1, INTERVALS.length) : 0;
  reviews[key] = {
    word_uuid: w.uuid,
    direction: dir,
    level,
    due_at: correct ? dueDateStr(INTERVALS[level - 1]) : nowStr(),
    reviewed_at: nowStr(),
    synced: false,
  };
  saveReviews();
  logReview();
  if (correct) doneCount++;
  else queue.push(currentCard);   // забуту картку — в кінець цієї ж сесії
  nextCard();
}

function closeReview() {
  overlay.hidden = true;
  unlockBodyScroll();
  render();
  sync();   // відправити свіжі оцінки на сервер
}
