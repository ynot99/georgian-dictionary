"use strict";

// ---------- повторення (SRS) ----------

// Інтервали в днях для рівнів 1..7. Правильна відповідь піднімає рівень на 1,
// неправильна скидає на 0 (картка повернеться ще в цій же сесії).
const INTERVALS = [1, 3, 7, 14, 30, 60, 120];
const NEW_PER_SESSION = 10;   // щоб перша сесія не завалила сотнею нових карток
const DIRECTIONS = ["ka2uk", "uk2ka"];
// скільки провалів (за весь час) — і слово вважається "проблемним". Нижче за
// дефолт Anki (8), бо там lapse рахується лише для вже вивченого слова, що
// регресує, а тут — кожен провал узагалі, включно з першим вивченням
const LEECH_THRESHOLD = 4;

// на відміну від level (скидається на 0 при провалі), lapses ніколи не
// зменшується — це довгостроковий слід "скільки разів це слово вже провалено"
function isLeech(w) {
  return DIRECTIONS.some((dir) => {
    const r = reviews[w.uuid + "|" + dir];
    return r && r.lapses >= LEECH_THRESHOLD;
  });
}

// "віртуальний тег" для activeTag: фільтр за isLeech(), а не за реальним тегом.
// Пробіл на початку робить значення недосяжним для звичайного тексту тега.
const LEECH_TAG = " leech";

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

// всі картки активної області, незалежно від розкладу — саме в цьому суть
// тренування за тегом: пройти категорію зараз, а не чекати, поки слова стануть
// due (ліміту NEW_PER_SESSION теж немає — сесію ти почав свідомо й сам)
function collectPractice() {
  const cards = [];
  for (const w of wordsInScope()) {
    for (const dir of DIRECTIONS) cards.push({ w, dir });
  }
  return shuffle(cards);
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

// чи картка a складніша за b (для впорядкування близнюків): головний сигнал —
// lapses (скільки разів цей напрямок провалено за весь час, тобто який бік ти
// хронічно знаєш гірше); за рівних lapses складнішим вважаємо менший level
function harderCard(a, b) {
  const ra = reviews[a.w.uuid + "|" + a.dir];
  const rb = reviews[b.w.uuid + "|" + b.dir];
  const lapA = ra ? ra.lapses || 0 : 0;
  const lapB = rb ? rb.lapses || 0 : 0;
  if (lapA !== lapB) return lapA > lapB;
  const lvlA = ra ? ra.level : 0;
  const lvlB = rb ? rb.level : 0;
  return lvlA < lvlB;
}

// коли обидва напрямки одного слова потрапили в цю сесію, ставимо складніший
// ПЕРЕД легшим: інакше легкий напрямок, показаний першим, підказав би відповідь
// для важкого (обидва напрямки — те саме слово). Свопаємо лише два близнюки
// місцями, зберігаючи решту перемішаного порядку — НЕ кластеризуємо їх поруч і
// НЕ робимо сесію "все важке спочатку" (це вбило б користь від перемішування
// різних складнощів). Мутує масив на місці й повертає його.
function orderSiblingsHarderFirst(cards) {
  const idxByWord = new Map();
  cards.forEach((c, i) => {
    const arr = idxByWord.get(c.w.uuid);
    if (arr) arr.push(i);
    else idxByWord.set(c.w.uuid, [i]);
  });
  for (const idxs of idxByWord.values()) {
    if (idxs.length < 2) continue;   // лише один напрямок у черзі — впорядковувати нема що
    const [lo, hi] = idxs[0] < idxs[1] ? [idxs[0], idxs[1]] : [idxs[1], idxs[0]];
    if (harderCard(cards[hi], cards[lo])) {
      [cards[lo], cards[hi]] = [cards[hi], cards[lo]];
    }
  }
  return cards;
}

// коли стане доступна найближча картка (якщо зараз нічого не due і немає
// нових слів) — щоб не треба було раз у раз відкривати застосунок "про всяк
// випадок"; null, якщо взагалі нема запланованих повторень у цій області
function nextDueAt() {
  const now = nowStr();
  let earliest = null;
  for (const w of wordsInScope()) {
    for (const dir of DIRECTIONS) {
      const r = reviews[w.uuid + "|" + dir];
      if (r && r.due_at > now && (earliest === null || r.due_at < earliest)) {
        earliest = r.due_at;
      }
    }
  }
  return earliest;
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

// Неправильна відповідь інколи збігається з правильною відповіддю ІНШОГО
// слова зі словника — це сигнал, що те друге слово теж могло сплутатись
// (точний збіг, без прощення одруківок — щоб не було випадкових спрацювань).
function findConfusedWord(typed, dir, excludeUuid) {
  const norm = normAnswer(typed);
  if (!norm) return null;
  for (const w of words) {
    if (w.uuid === excludeUuid) continue;
    const text = dir === "ka2uk" ? w.translation : w.georgian;
    if (answerVariants(text).includes(norm)) return w;
  }
  return null;
}

// поле, за яким користувач впізнає "те інше слово" в повідомленні —
// протилежне до того, що він щойно (помилково) ввів
function confusionLabel(confused, dir) {
  return dir === "ka2uk" ? confused.georgian : confused.translation;
}

// Речення-приклад з пропущеним словом — контекстна підказка для напрямку
// переклад→ქართули (де саме грузинське слово треба вгадати/ввести). Працює
// лише коли приклад містить точний словниковий запис слова — після відмінка
// чи дієвідміни форма в реченні вже інша, і збіг не знайдеться.
function clozeHint(w) {
  if (!w.example || !w.example.includes(w.georgian)) return null;
  return w.example.replace(w.georgian, "____");
}

let queue = [];
let currentCard = null;
let doneCount = 0;
// картки, провалені хоч раз у цій сесії (навіть якщо потім таки відповів
// правильно при повторній зустрічі в тій же черзі) — для "Ще раз провалені"
let sessionWrong = [];
let sessionWrongKeys = new Set();
// міні-раунд "Ще раз провалені" — це практика, не новий залік: правильна
// відповідь тут НЕ рухає level/due_at далі (інакше дві правильні відповіді за
// 10 хвилин в одній сидьці "виграли" б стільки ж днів перепочинку, скільки й
// справжнє повторення через реальний часовий розрив). Провал і тут лишається
// провалом — це нова ознака труднощів, а не менш вартий сигнал.
let inRetryRound = false;
// тренування за тегом ("🎯 Тренувати") — практика ПОЗА розкладом, тож не пише
// в SRS нічого: ні level/due_at, ні lapses, ні журнал для серії днів. Причина
// та сама, що й вище: слово, яке ще не спливло, згадується "по свіжій пам'яті",
// і зарахувати це як справжнє повторення означало б відсунути наступний показ
// далі, ніж заслужено. На відміну від inRetryRound, тут і провал не карається:
// там картка була справді due і ти її справді завалив (валідний сигнал), а сюди
// слова потрапляють гуртом незалежно від розкладу — і спроба потренувати
// категорію не повинна мати шансу зіпсувати реальний прогрес.
let practiceMode = false;
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
const rvCloze = document.getElementById("rv-cloze");
const rvBack = document.getElementById("rv-back");
const rvEx = document.getElementById("rv-ex");
const rvDone = document.getElementById("rv-done");
const rvReveal = document.getElementById("rv-reveal");
const rvWrong = document.getElementById("rv-wrong");
const rvRight = document.getElementById("rv-right");
const rvRetryWrong = document.getElementById("rv-retry-wrong");
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

function openSession(cards, practice) {
  queue = cards;
  doneCount = 0;
  sessionWrong = [];
  sessionWrongKeys = new Set();
  inRetryRound = false;
  practiceMode = practice;
  overlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
  forceReflow(overlay);   // щоб автофокус нижче бачив уже готову геометрію вікна
  nextCard();
}

function startReview() {
  const { due, fresh } = collectDue();
  // впорядковуємо близнюків лише серед прострочених (due): нові (fresh) обидва
  // ще level 0/lapses 0 — рівні, тож там нема "складнішого". Порядок due-перед-
  // fresh зберігається (спершу розгрібаємо борг, потім нові слова)
  const queue = [
    ...orderSiblingsHarderFirst(shuffle(due)),
    ...shuffle(fresh).slice(0, NEW_PER_SESSION),
  ];
  openSession(queue, false);
}

// тренування активного тега: та сама механіка карток, але без запису в SRS
function startPractice() {
  openSession(collectPractice(), true);
}

// новий міні-раунд лише з карток, провалених у щойно завершеній сесії —
// дає паузу перед повторною спробою (пройшов усю решту слів), замість
// миттєвого повтору одразу після підказки в тій самій черзі
function retryWrong() {
  queue = shuffle([...sessionWrong]);
  sessionWrong = [];
  sessionWrongKeys = new Set();
  doneCount = 0;
  inRetryRound = true;
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
  rvBack.hidden = rvEx.hidden = rvVerdict.hidden = rvCloze.hidden = true;
  rvWrong.hidden = rvRight.hidden = rvRetryWrong.hidden = true;
  rvMode.hidden = finished;
  lastVerdict = null;
  if (finished) {
    rvReveal.hidden = rvType.hidden = true;
    rvDone.textContent = practiceMode
      ? `Тренування завершено! Пройдено карток: ${doneCount} 🎯 SRS не змінився.`
      : doneCount
        ? `Готово! Повторено карток: ${doneCount} 🎉`
        : "Наразі немає карток до повторення. Приходь пізніше!";
    rvProgress.textContent = "";
    rvRetryWrong.hidden = sessionWrong.length === 0;
    setHint(rvRetryWrong.hidden
      ? "Enter — закрити"
      : "Enter — ще раз провалені · Esc — закрити");
    return;
  }
  const { w, dir } = currentCard;
  rvProgress.textContent = (practiceMode ? "🎯 Тренування (без SRS) · " : "")
    + `Залишилось: ${queue.length + 1}`;
  rvDir.textContent = dir === "ka2uk" ? "ქართული → переклад" : "переклад → ქართული";
  rvFront.textContent = dir === "ka2uk" ? w.georgian : w.translation;
  rvBack.textContent = dir === "ka2uk" ? w.translation : w.georgian;
  if (reviewMode === "type") {
    rvReveal.hidden = true;
    rvType.hidden = false;
    rvInput.value = "";
    // семантична підказка мови поля (клавіатуру перемикаєш сам)
    rvInput.lang = dir === "uk2ka" ? "ka" : "uk";
    const hint = dir === "uk2ka" ? clozeHint(w) : null;
    rvCloze.hidden = !hint;
    rvCloze.textContent = hint ? "🧩 " + hint : "";
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
  rvCloze.hidden = true;   // повний приклад (rv-ex) нижче замінює собою підказку з пропуском
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
    if (ok) {
      rvVerdict.textContent = "✅ Правильно!";
    } else {
      const confused = findConfusedWord(typed, dir, w.uuid);
      if (confused) {
        // неправильна відповідь випадково збіглась з відповіддю іншого слова —
        // саме воно теж могло сплутатись, тож додаємо його в практику цієї
        // сесії (без штрафу lapses/level — це лише непряма підказка, не залік)
        const key = confused.uuid + "|" + dir;
        if (!sessionWrongKeys.has(key)) {
          sessionWrongKeys.add(key);
          sessionWrong.push({ w: confused, dir });
        }
        rvVerdict.textContent =
          `❌ Ти написав: ${typed.trim()} — це відповідь для «${confusionLabel(confused, dir)}»`;
      } else {
        rvVerdict.textContent = `❌ Ти написав: ${typed.trim()}`;
      }
    }
    rvVerdict.className = "rv-verdict " + (ok ? "ok" : "bad");
    rvVerdict.hidden = false;
  }
  // порожній ввід = "не пам'ятаю, покажи" — без вердикту
  reveal();
}

// чи йде ця відповідь у SRS. Тренування за тегом не пише нічого взагалі;
// міні-раунд "ще раз провалені" не зараховує лише ПРАВИЛЬНУ відповідь
// (провал там — валідний сигнал: картка була справді due і ти її завалив)
function writesSrs(correct) {
  return !practiceMode && !(inRetryRound && correct);
}

function grade(correct) {
  const { w, dir } = currentCard;
  const key = w.uuid + "|" + dir;

  if (writesSrs(correct)) {
    const prevLevel = reviews[key] ? reviews[key].level : 0;
    const prevLapses = reviews[key] ? reviews[key].lapses || 0 : 0;
    const level = correct ? Math.min(prevLevel + 1, INTERVALS.length) : 0;
    reviews[key] = {
      word_uuid: w.uuid,
      direction: dir,
      level,
      due_at: correct ? dueDateStr(INTERVALS[level - 1]) : nowStr(),
      reviewed_at: nowStr(),
      lapses: correct ? prevLapses : prevLapses + 1,
      synced: false,
    };
    saveReviews();
    logReview();
  }

  if (correct) doneCount++;
  else {
    queue.push(currentCard);   // забуту картку — в кінець цієї ж сесії
    if (!sessionWrongKeys.has(key)) {
      sessionWrongKeys.add(key);
      sessionWrong.push(currentCard);
    }
  }
  nextCard();
}

function closeReview() {
  overlay.hidden = true;
  unlockBodyScroll();
  render();
  sync();   // відправити свіжі оцінки на сервер
}
