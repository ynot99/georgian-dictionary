"use strict";

// ---------- події ----------

document.getElementById("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const georgian = document.getElementById("f-georgian").value.trim();
  const translation = document.getElementById("f-translation").value.trim();
  const example = document.getElementById("f-example").value.trim();
  const tags = document.getElementById("f-tags").value;
  if (!georgian || !translation) return;
  addWord(georgian, translation, example, tags);
  e.target.reset();
  document.getElementById("f-georgian").focus();
});

searchEl.addEventListener("input", render);
document.getElementById("sync-btn").addEventListener("click", sync);
document.getElementById("stats-btn").addEventListener("click", () => {
  statsVisible = !statsVisible;
  render();
});
document.getElementById("csv-btn").addEventListener("click", exportCsv);
const importFile = document.getElementById("import-file");
document.getElementById("import-btn").addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  if (importFile.files.length) {
    importCsv(importFile.files[0]);
    importFile.value = "";
  }
});
document.getElementById("review-btn").addEventListener("click", startReview);
document.getElementById("rv-close").addEventListener("click", closeReview);
rvReveal.addEventListener("click", reveal);
rvWrong.addEventListener("click", () => grade(false));
rvRight.addEventListener("click", () => grade(true));
rvType.addEventListener("submit", (e) => {
  e.preventDefault();
  checkTyped();
});
rvMode.addEventListener("click", () => {
  reviewMode = reviewMode === "type" ? "flip" : "type";
  localStorage.setItem("reviewMode", reviewMode);
  presentCard();   // перепоказати поточну картку в новому режимі
});

rvStrict.addEventListener("click", () => {
  reviewStrict = !reviewStrict;
  localStorage.setItem("reviewStrict", reviewStrict ? "1" : "0");
  updateModeBtn();
  // клік по кнопці забирає фокус з поля вводу — повертаємо його назад,
  // якщо картка ще не розкрита (поле вводу досі на екрані)
  if (!rvType.hidden) rvInput.focus();
});

function closeChat() {
  chatOverlay.hidden = true;
  unlockBodyScroll();
}

function closeNotes() {
  notesOverlay.hidden = true;
  unlockBodyScroll();
}

document.getElementById("chat-btn").addEventListener("click", openChat);
document.getElementById("ch-close").addEventListener("click", closeChat);
document.getElementById("ch-clear").addEventListener("click", clearChat);
document.getElementById("chat-form").addEventListener("submit", sendChat);
document.getElementById("notes-btn").addEventListener("click", () => openNotes());
document.getElementById("notes-close").addEventListener("click", closeNotes);
notesReviewBtn.addEventListener("click", toggleNoteReview);
nrReveal.addEventListener("click", revealNote);
nrWrong.addEventListener("click", () => gradeNote(false));
nrRight.addEventListener("click", () => gradeNote(true));

// клавіатура в сесії повторення: Enter/1/2/Escape
window.addEventListener("keydown", (e) => {
  if (!notesOverlay.hidden) {          // нотатки можуть відкритись поверх чату
    if (e.key === "Escape") closeNotes();
    return;
  }
  if (!chatOverlay.hidden) {          // чат зверху — клавіші повторення не діють
    if (e.key === "Escape") closeChat();
    return;
  }
  if (overlay.hidden) return;
  if (e.key === "Escape") {
    closeReview();
    return;
  }
  if (currentCard === null) {           // фінальний екран
    if (e.key === "Enter") closeReview();
    return;
  }
  const grading = !rvWrong.hidden;      // екран оцінки "знав/не знав"
  if (grading) {
    if (e.key === "1") { e.preventDefault(); grade(false); }
    else if (e.key === "2") { e.preventDefault(); grade(true); }
    else if (e.key === "Enter" && lastVerdict !== null) {
      // підтвердити вердикт перевірки одним Enter
      e.preventDefault();
      grade(lastVerdict);
    }
    return;
  }
  // лицьова сторона в режимі показу (в режимі друкування Enter обробляє форма)
  if (reviewMode === "flip" && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    reveal();
  }
});
window.addEventListener("online", sync);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}

render();
sync();
