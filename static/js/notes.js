"use strict";

// ---------- нотатки з граматики ----------

const notesOverlay = document.getElementById("notes-overlay");
registerKeyboardAwareOverlay(notesOverlay);
const notesLog = document.getElementById("notes-log");
const notesReviewBtn = document.getElementById("notes-review-btn");
const notesFilterBtn = document.getElementById("notes-filter-btn");
let notesCache = [];
// збережено в localStorage — на відміну від expandedToolCalls у чаті, це не
// одноразовий стан сесії, а стійке налаштування (щоб не перемикати щоразу)
const NOTES_FILTER_KEY = "notesStarredOnly";
let notesStarredOnly = localStorage.getItem(NOTES_FILTER_KEY) === "1";

// винесено окремо (без DOM) заради тестованості: які нотатки показувати,
// якщо ввімкнено фільтр "лише важливі"
function visibleNotes(notes, starredOnly) {
  return starredOnly ? notes.filter((n) => n.starred) : notes;
}

function applyNotesFilterButton() {
  notesFilterBtn.textContent = notesStarredOnly ? "★" : "☆";
  notesFilterBtn.title = notesStarredOnly ? "Показати всі нотатки" : "Показати лише важливі";
  notesFilterBtn.classList.toggle("active", notesStarredOnly);
}
applyNotesFilterButton();   // одразу відобразити збережений стан, ще до першого відкриття нотаток

async function openNotes(highlightId) {
  notesOverlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
  showNotesList();   // на випадок якщо минулого разу закрили посеред повторення
  try {
    const res = await fetchWithTimeout("/api/notes");
    if (!res.ok) throw new Error();
    const data = await res.json();
    notesCache = data.notes;
    renderNotes(highlightId);
  } catch {
    notesLog.replaceChildren(el("p", "ch-note",
      "Немає з'єднання з сервером — нотатки доступні лише онлайн."));
  }
}

function toggleNotesFilter() {
  notesStarredOnly = !notesStarredOnly;
  localStorage.setItem(NOTES_FILTER_KEY, notesStarredOnly ? "1" : "0");
  applyNotesFilterButton();
  renderNotes();
}

function renderNotes(highlightId) {
  notesLog.replaceChildren();
  const shown = visibleNotes(notesCache, notesStarredOnly);
  if (!shown.length) {
    notesLog.append(el("p", "ch-note", notesCache.length
      ? "Немає важливих нотаток — познач ⭐ потрібні, або вимкни фільтр."
      : "Нотаток поки немає — репетитор створить їх у чаті, коли пояснюватиме граматику."));
    return;
  }
  let toScroll = null;
  for (const n of shown) {
    const card = el("div", "note-card" + (n.id === highlightId ? " highlight" : ""));
    const titleRow = el("div", "note-title");
    titleRow.append(el("span", null, n.title));
    const actions = el("div", "note-actions");
    const starBtn = el("button", "note-star" + (n.starred ? " active" : ""), n.starred ? "★" : "☆");
    starBtn.title = n.starred ? "Прибрати з важливих" : "Позначити як важливу";
    starBtn.onclick = () => toggleNoteStar(n.id);
    actions.append(starBtn);
    const delBtn = el("button", "note-del", "🗑");
    delBtn.title = "Видалити нотатку";
    delBtn.onclick = () => deleteNote(n.id);
    actions.append(delBtn);
    titleRow.append(actions);
    const contentEl = el("div", "note-content");
    appendNoteRefs(contentEl, n.content);
    card.append(titleRow, contentEl);
    notesLog.append(card);
    if (n.id === highlightId) toScroll = card;
  }
  if (toScroll) toScroll.scrollIntoView({ block: "center" });
}

async function toggleNoteStar(id) {
  try {
    const res = await fetchWithTimeout(`/api/notes/${id}/star`, { method: "POST" });
    if (!res.ok) throw new Error();
    const data = await res.json();
    const note = notesCache.find((n) => n.id === id);
    if (note) note.starred = data.starred;
    renderNotes();
  } catch {
    alert("Немає з'єднання з сервером.");
  }
}

async function deleteNote(id) {
  if (!confirm("Видалити цю нотатку?")) return;
  try {
    const res = await fetchWithTimeout(`/api/notes/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    notesCache = notesCache.filter((n) => n.id !== id);
    renderNotes();
  } catch {
    alert("Немає з'єднання з сервером.");
  }
}

// ---------- повторення нотаток (SRS, flip-стиль, ті самі інтервали, що й слова) ----------

const notesReview = document.getElementById("notes-review");
const nrProgress = document.getElementById("nr-progress");
const nrTitle = document.getElementById("nr-title");
const nrContent = document.getElementById("nr-content");
const nrDone = document.getElementById("nr-done");
const nrReveal = document.getElementById("nr-reveal");
const nrWrong = document.getElementById("nr-wrong");
const nrRight = document.getElementById("nr-right");

let noteQueue = [];
let currentNote = null;
let noteDoneCount = 0;

// прострочені нотатки (є прогрес, due_at минув) + ще не тренувані (due_at немає);
// той самий принцип, що й collectDue() для слів, лише без напрямків/typed-перевірки
function collectDueNotes() {
  const now = nowStr();
  const due = [], fresh = [];
  for (const n of notesCache) {
    if (!n.due_at) fresh.push(n);
    else if (n.due_at <= now) due.push(n);
  }
  return { due, fresh };
}

function showNotesList() {
  notesReview.hidden = true;
  notesLog.hidden = false;
  notesReviewBtn.textContent = "🎓";
  notesReviewBtn.title = "Повторити нотатки";
}

function startNoteReview() {
  const { due, fresh } = collectDueNotes();
  noteQueue = [...shuffle(due), ...shuffle(fresh).slice(0, NEW_PER_SESSION)];
  noteDoneCount = 0;
  notesLog.hidden = true;
  notesReview.hidden = false;
  notesReviewBtn.textContent = "📖";
  notesReviewBtn.title = "До списку нотаток";
  nextNoteCard();
}

function toggleNoteReview() {
  if (notesReview.hidden) startNoteReview();
  else showNotesList();
}

function presentNoteCard() {
  const finished = currentNote === null;
  nrDone.hidden = !finished;
  nrTitle.hidden = finished;
  nrContent.hidden = true;
  nrReveal.hidden = finished;
  nrWrong.hidden = nrRight.hidden = true;
  if (finished) {
    nrDone.textContent = noteDoneCount
      ? `Готово! Повторено нотаток: ${noteDoneCount} 🎉`
      : "Наразі немає нотаток до повторення.";
    nrProgress.textContent = "";
    return;
  }
  nrProgress.textContent = `Залишилось: ${noteQueue.length + 1}`;
  nrTitle.textContent = currentNote.title;
  nrContent.replaceChildren();
  appendNoteRefs(nrContent, currentNote.content);
}

function nextNoteCard() {
  currentNote = noteQueue.shift() || null;
  presentNoteCard();
}

function revealNote() {
  nrContent.hidden = false;
  nrReveal.hidden = true;
  nrWrong.hidden = nrRight.hidden = false;
}

async function gradeNote(correct) {
  const note = currentNote;
  try {
    const res = await fetchWithTimeout(`/api/notes/${note.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ correct }),
    });
    if (res.ok) {
      const data = await res.json();
      note.level = data.level;
      note.due_at = data.due_at;
    }
    // якщо офлайн — просто не збережеться прогрес цієї оцінки; сесія однаково
    // триває далі, нотатки лишень online-фіча, тож не варто зупиняти алертом
  } catch { /* offline — прогрес не збережеться, сесія продовжується локально */ }
  if (correct) noteDoneCount++;
  else noteQueue.push(note);
  nextNoteCard();
}
