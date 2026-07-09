"use strict";

// ---------- нотатки з граматики ----------

const notesOverlay = document.getElementById("notes-overlay");
registerKeyboardAwareOverlay(notesOverlay);
const notesLog = document.getElementById("notes-log");
let notesCache = [];

async function openNotes(highlightId) {
  notesOverlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
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

function renderNotes(highlightId) {
  notesLog.replaceChildren();
  if (!notesCache.length) {
    notesLog.append(el("p", "ch-note",
      "Нотаток поки немає — репетитор створить їх у чаті, коли пояснюватиме граматику."));
    return;
  }
  let toScroll = null;
  for (const n of notesCache) {
    const card = el("div", "note-card" + (n.id === highlightId ? " highlight" : ""));
    const titleRow = el("div", "note-title");
    titleRow.append(el("span", null, n.title));
    const delBtn = el("button", "note-del", "🗑");
    delBtn.title = "Видалити нотатку";
    delBtn.onclick = () => deleteNote(n.id);
    titleRow.append(delBtn);
    card.append(titleRow, el("div", "note-content", n.content));
    notesLog.append(card);
    if (n.id === highlightId) toScroll = card;
  }
  if (toScroll) toScroll.scrollIntoView({ block: "center" });
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
