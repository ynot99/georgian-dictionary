"use strict";

// ---------- 🤖 переклади з української (вправи від моделі через OpenRouter) ----------

// Слова обирає застосунок (pickAiWords), модель лише складає речення. Вправи
// зберігаються на сервері: дешеві моделі помиляються в грузинській, тож кожну
// можна виправити, видалити, позначити ⚠️, а Claude Code перевіряє їх
// (review: "ok" — можна вчити, "bad" — у тренування не потрапляє).
// Як і вправи на реченнях, тренування нічого не пише в SRS. Лише онлайн, як нотатки.
const AI_MODE = "translate_uk_ka";
const AI_WORDS_PER_CALL = 5;            // = AI_EXERCISES_PER_CALL у server/ai.py
const AI_PRACTICE_PER_SESSION = 10;
const AI_TIMEOUT_MS = 150000;           // сервер чекає на модель до 2 × 60 с

const aiOverlay = document.getElementById("ai-overlay");
registerKeyboardAwareOverlay(aiOverlay);
const aiLog = document.getElementById("ai-log");
const aiStatus = document.getElementById("ai-status");
const aiGenBtn = document.getElementById("ai-gen-btn");
const aiPracticeBtn = document.getElementById("ai-practice-btn");
const aiForm = document.getElementById("ai-form");
const afQuestion = document.getElementById("af-question");
const afAnswer = document.getElementById("af-answer");
const afHint = document.getElementById("af-hint");

let aiCache = [];
let aiEnabled = false;
let aiSpent = 0;
let aiBusy = false;
let aiEditingId = null;
// id вправи, у якої 🗑 вже натиснуто раз: видаляє другий тап, а не confirm(),
// бо браузер може мовчки блокувати системні діалоги
let aiDeleteArmed = null;

// ---- вибір слів (без DOM — заради тестів) ----

// Спершу слова, для яких вправ ще найменше (щоб не крутити ті самі), далі ті,
// що вже в повторенні (переклад речення з ще не баченим словом — завеликий
// стрибок), серед них — слабші: нижчий рівень, більше провалів. Несинхронізованих
// слів сервер ще не знає, тож їх не беремо.
function pickAiWords(exercises, n = AI_WORDS_PER_CALL) {
  const counts = {};
  for (const e of exercises) {
    if (e.review !== "bad") counts[e.word_uuid] = (counts[e.word_uuid] || 0) + 1;
  }
  const stats = (w) => {
    const cards = DIRECTIONS.map((d) => reviews[`${w.uuid}|${d}`]).filter(Boolean);
    return {
      unseen: cards.length ? 0 : 1,
      level: cards.length ? Math.min(...cards.map((c) => c.level)) : 0,
      lapses: cards.reduce((sum, c) => sum + c.lapses, 0),
    };
  };
  return shuffle(practicableInScope().filter((w) => w.synced))   // shuffle — випадковість серед рівних
    .map((w) => ({ w, n: counts[w.uuid] || 0, ...stats(w) }))
    .sort((a, b) => a.n - b.n || a.unseen - b.unseen || a.level - b.level || b.lapses - a.lapses)
    .slice(0, n)
    .map((x) => x.w);
}

// у тренування — усе, крім забракованого, і лише слова активної області
function aiPracticePool(exercises) {
  const uuids = new Set(practicableInScope().map((w) => w.uuid));
  return exercises.filter((e) => e.review !== "bad" && uuids.has(e.word_uuid));
}

function aiReviewLabel(e) {
  if (e.review === "ok") return "✔ перевірено";
  if (e.review === "bad") return "✖ не вчити" + (e.review_note ? `: ${e.review_note}` : "");
  return "не перевірено";
}

// ---- список ----

function setAiStatus(text, isError = false) {
  aiStatus.textContent = text;
  aiStatus.hidden = !text;
  aiStatus.classList.toggle("error", isError);
}

async function reloadAi(highlightIds) {
  try {
    const res = await fetchWithTimeout("/api/ai/exercises");
    if (!res.ok) throw new Error();
    const data = await res.json();
    aiCache = data.exercises;
    aiEnabled = data.enabled;
    aiSpent = data.spent || 0;
    renderAi(highlightIds);
  } catch {
    aiLog.replaceChildren(el("p", "ch-note",
      "Немає з'єднання з сервером — переклади доступні лише онлайн."));
  }
}

async function openAi() {
  aiOverlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
  setAiStatus("");
  showAiList();
  await reloadAi();
}

function closeAi() {
  aiOverlay.hidden = true;
  aiDeleteArmed = null;
  unlockBodyScroll();
}

function renderAi(highlightIds = new Set()) {
  aiLog.replaceChildren();
  const ok = aiCache.filter((e) => e.review === "ok").length;
  const bad = aiCache.filter((e) => e.review === "bad").length;
  // виклик коштує частки цента — з двома знаками все виглядало б як $0.00
  const spent = aiSpent ? ` · витрачено $${aiSpent.toFixed(aiSpent < 0.1 ? 4 : 2)}` : "";
  aiLog.append(el("p", "ai-summary", aiCache.length
    ? `Вправ: ${aiCache.length} · перевірено: ${ok} · не вчити: ${bad}${spent}`
    : `Вправ поки немає — ➕ складе ${AI_WORDS_PER_CALL} речень на переклад зі слів, які ти вчиш.`));
  if (!aiEnabled) {
    aiLog.append(el("p", "ch-note", "Генерація вимкнена: потрібні OPENROUTER_API_KEY і " +
      "OPENROUTER_MODEL у .env на сервері. Готові вправи можна тренувати й без них."));
  }
  let toScroll = null;
  for (const e of aiCache) {
    const card = el("div", "note-card ai-card" + (highlightIds.has(e.id) ? " highlight" : "")
      + (e.review === "bad" ? " rejected" : ""));
    const titleRow = el("div", "note-title");
    titleRow.append(el("span", null, e.question));
    const actions = el("div", "note-actions");
    const flagBtn = el("button", "note-star" + (e.flagged ? " active" : ""), "⚠️");
    flagBtn.title = e.flagged ? "Зняти позначку «підозріла вправа»" : "Позначити як підозрілу";
    flagBtn.onclick = () => toggleAiFlag(e);
    const editBtn = el("button", "note-edit", "✏️");
    editBtn.title = "Виправити вправу";
    editBtn.onclick = () => openAiForm(e);
    const armed = aiDeleteArmed === e.id;
    const delBtn = el("button", "note-del" + (armed ? " armed" : ""), armed ? "🗑?" : "🗑");
    delBtn.title = armed ? "Натисни ще раз, щоб видалити" : "Видалити вправу";
    delBtn.onclick = () => deleteAiExercise(e.id);
    actions.append(flagBtn, editBtn, delBtn);
    titleRow.append(actions);
    const answer = el("p", "ai-answer", e.answer);
    answer.lang = "ka";
    card.append(titleRow, answer);
    if (e.hint) card.append(el("p", "ai-hint", `💡 ${e.hint}`));
    const meta = [e.georgian ? `${e.georgian} — ${e.translation}` : null, e.model, aiReviewLabel(e)];
    if (e.flagged) meta.push("⚠️ позначено як підозрілу");
    card.append(el("p", "ai-meta", meta.filter(Boolean).join(" · ")));
    aiLog.append(card);
    if (highlightIds.has(e.id) && !toScroll) toScroll = card;
  }
  if (toScroll) toScroll.scrollIntoView({ block: "center" });
}

// PATCH і заміна вправи в кеші відповіддю сервера (там і скинута перевірка)
async function patchAiExercise(id, body) {
  const res = await fetchWithTimeout(`/api/ai/exercises/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Не вдалося зберегти.");
  aiCache = aiCache.map((e) => (e.id === id ? data : e));
  return data;
}

async function toggleAiFlag(e) {
  aiDeleteArmed = null;
  try {
    await patchAiExercise(e.id, { flagged: !e.flagged });
    renderAi();
  } catch {
    setAiStatus("Немає з'єднання з сервером.", true);
  }
}

async function deleteAiExercise(id) {
  if (aiDeleteArmed !== id) {
    aiDeleteArmed = id;
    renderAi();
    return;
  }
  aiDeleteArmed = null;
  try {
    const res = await fetchWithTimeout(`/api/ai/exercises/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    aiCache = aiCache.filter((e) => e.id !== id);
    renderAi();
  } catch {
    setAiStatus("Немає з'єднання з сервером.", true);
  }
}

// ---- генерація ----

async function generateAiExercises() {
  if (aiBusy) return;
  aiDeleteArmed = null;
  if (!aiEnabled) {
    setAiStatus("Генерація вимкнена: додай OPENROUTER_API_KEY і OPENROUTER_MODEL у .env " +
      "і перезапусти сервер.", true);
    return;
  }
  const picked = pickAiWords(aiCache);
  if (!picked.length) {
    setAiStatus("Немає слів для вправ у цій області — зміни фільтр або синхронізуй нові слова.", true);
    return;
  }
  aiBusy = true;
  aiGenBtn.disabled = true;
  setAiStatus(`⏳ Складаю вправи для: ${picked.map((w) => w.georgian).join(", ")}…`);
  try {
    const res = await fetchWithTimeout("/api/ai/exercises/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: AI_MODE, word_uuids: picked.map((w) => w.uuid) }),
    }, AI_TIMEOUT_MS);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAiStatus(data.error || `Помилка сервера (${res.status}).`, true);
      return;
    }
    const skipped = data.skipped ? ` (ще ${data.skipped} модель склала непридатно — відкинуто)` : "";
    const cost = typeof data.cost === "number" ? ` · $${data.cost.toFixed(4)}` : "";
    setAiStatus(`Додано вправ: ${data.exercises.length}${skipped}${cost}`);
    await reloadAi(new Set(data.exercises.map((e) => e.id)));
  } catch (e) {
    setAiStatus(e.name === "AbortError"
      ? "Модель не відповіла вчасно — спробуй ще раз."
      : "Немає з'єднання з сервером.", true);
  } finally {
    aiBusy = false;
    aiGenBtn.disabled = false;
  }
}

// ---- редагування ----

function openAiForm(e) {
  if (!aiPractice.hidden) showAiList();
  aiDeleteArmed = null;
  setAiStatus("");
  aiEditingId = e.id;
  afQuestion.value = e.question;
  afAnswer.value = e.answer;
  afHint.value = e.hint;
  aiForm.hidden = false;
  aiLog.hidden = true;   // не показуємо список під формою — мало місця на телефоні
  afAnswer.focus();
}

function closeAiForm() {
  aiForm.hidden = true;
  aiLog.hidden = false;
  aiEditingId = null;
}

async function saveAiForm(ev) {
  ev.preventDefault();
  const id = aiEditingId;
  try {
    await patchAiExercise(id, {
      question: afQuestion.value, answer: afAnswer.value, hint: afHint.value,
    });
    closeAiForm();
    setAiStatus("");
    renderAi(new Set([id]));
  } catch (e) {
    setAiStatus(e instanceof TypeError || e.name === "AbortError"
      ? "Немає з'єднання з сервером." : e.message, true);
  }
}

// ---- тренування ----

const aiPractice = document.getElementById("ai-practice");
const apProgress = document.getElementById("ap-progress");
const apQuestion = document.getElementById("ap-question");
const apYours = document.getElementById("ap-yours");
const apAnswer = document.getElementById("ap-answer");
const apHint = document.getElementById("ap-hint");
const apDone = document.getElementById("ap-done");
const apForm = document.getElementById("ap-form");
const apInput = document.getElementById("ap-input");
const apWrong = document.getElementById("ap-wrong");
const apRight = document.getElementById("ap-right");
const apBack = document.getElementById("ap-back");
const apMeta = document.getElementById("ap-meta");
const apFlag = document.getElementById("ap-flag");
const apInfo = document.getElementById("ap-info");

let apQueue = [];
let apCurrent = null;
let apDoneCount = 0;
let apTotal = 0;

function showAiList() {
  closeAiForm();
  aiPractice.hidden = true;
  aiLog.hidden = false;
  aiPracticeBtn.textContent = "🎓";
  aiPracticeBtn.title = "Тренувати переклад";
}

function startAiPractice() {
  closeAiForm();
  aiDeleteArmed = null;
  setAiStatus("");
  apQueue = shuffle(aiPracticePool(aiCache)).slice(0, AI_PRACTICE_PER_SESSION);
  apTotal = apQueue.length;
  apDoneCount = 0;
  aiLog.hidden = true;
  aiPractice.hidden = false;
  aiPracticeBtn.textContent = "📋";
  aiPracticeBtn.title = "До списку вправ";
  forceReflow(aiOverlay);   // щоб автофокус бачив уже готову геометрію вікна
  nextAiExercise();
}

function toggleAiPractice() {
  if (aiPractice.hidden) startAiPractice();
  else {
    showAiList();
    renderAi();   // позначки ⚠️, зроблені під час тренування
  }
}

function nextAiExercise() {
  apCurrent = apQueue.shift() || null;
  const finished = apCurrent === null;
  apQuestion.hidden = apForm.hidden = finished;
  apYours.hidden = apAnswer.hidden = apHint.hidden = apMeta.hidden = true;
  apWrong.hidden = apRight.hidden = true;
  apDone.hidden = apBack.hidden = !finished;
  if (finished) {
    apProgress.textContent = "";
    apDone.textContent = apTotal
      ? `Готово! Перекладено речень: ${apDoneCount} 🤖 SRS не змінився.`
      : "Немає вправ для тренування в цій області — склади нові ➕ або зміни фільтр.";
    return;
  }
  const scope = activeScopeLabel();
  apProgress.textContent = `🤖 Переклад${scope ? `: ${scope}` : ""} (без SRS) · Залишилось: ${apQueue.length + 1}`;
  apQuestion.textContent = apCurrent.question;
  apInput.value = "";
  apInput.focus();
}

// Перевірки моделлю немає (етап 1): порядок слів у грузинській вільний, тож
// точний збіг з еталоном — не єдина правильна відповідь. Оцінюєш сам, а збіг
// лише підказуємо
function revealAiAnswer() {
  const typed = apInput.value.trim();
  const exact = typed && normAnswer(typed) === normAnswer(apCurrent.answer);
  apYours.textContent = typed ? `Ти: ${typed}${exact ? "  ✅ як в еталоні" : ""}` : "Ти: —";
  apAnswer.textContent = apCurrent.answer;
  apHint.textContent = apCurrent.hint ? `💡 ${apCurrent.hint}` : "";
  apYours.hidden = apAnswer.hidden = false;
  apHint.hidden = !apCurrent.hint;
  apForm.hidden = true;
  apWrong.hidden = apRight.hidden = false;
  updateApMeta();
  apMeta.hidden = false;
}

function updateApMeta() {
  apFlag.textContent = apCurrent.flagged ? "⚠️ Позначено як підозрілу" : "⚠️ Помилка у вправі?";
  apFlag.classList.toggle("active", apCurrent.flagged);
  apInfo.textContent = `${apCurrent.model} · ${aiReviewLabel(apCurrent)}`;
}

async function toggleApFlag() {
  try {
    apCurrent = await patchAiExercise(apCurrent.id, { flagged: !apCurrent.flagged });
    updateApMeta();
  } catch {
    apInfo.textContent = "Немає з'єднання — позначку не збережено.";
  }
}

function gradeAiExercise(correct) {
  if (correct) apDoneCount++;
  else apQueue.push(apCurrent);   // незнане речення — в кінець цієї ж сесії
  nextAiExercise();
}
