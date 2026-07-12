"use strict";

// ---------- події ----------

document.getElementById("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const georgian = document.getElementById("f-georgian").value.trim();
  const translation = document.getElementById("f-translation").value.trim();
  const example = document.getElementById("f-example").value.trim();
  const tags = document.getElementById("f-tags").value;
  if (!georgian || !translation) return;
  // попередження, не заборона: у грузинській бувають омоніми (однакове
  // написання, різне значення) — рідкісний, але легітимний випадок
  const dup = words.find((w) => w.georgian === georgian);
  if (dup && !confirm(`«${georgian}» вже є в словнику (переклад: ${dup.translation}). Додати ще раз?`)) {
    return;
  }
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
rvRetryWrong.addEventListener("click", retryWrong);
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

// ---------- щоденне нагадування (.ics) ----------

// Не push-сповіщення (той вимагав би, щоб сервер на комп'ютері був завжди
// увімкнений) — замість цього генеруємо файл календаря, який телефон додає
// у СВІЙ календар (Google/Apple Calendar), і той сам про все нагадує далі,
// повністю незалежно від того, чи запущений цей застосунок чи сервер
function pad2(n) {
  return String(n).padStart(2, "0");
}

function buildReminderIcs(hh, mm) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
  if (start < now) start.setDate(start.getDate() + 1);   // час сьогодні вже минув -> з завтра
  const dtstart = `${start.getFullYear()}${pad2(start.getMonth() + 1)}${pad2(start.getDate())}` +
    `T${pad2(hh)}${pad2(mm)}00`;
  const dtstamp = now.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const uid = crypto.randomUUID() + "@dictionary-app";
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//dictionary-app//uk",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    "DURATION:PT5M",
    "RRULE:FREQ=DAILY",
    "SUMMARY:📖 Перевір словник",
    "DESCRIPTION:Час перевірити повторення та слово дня в словнику.",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Перевір словник",
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";
}

function downloadReminder() {
  const input = prompt("О котрій годині нагадувати щодня? (напр. 20:00)", "20:00");
  if (input === null) return;
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) {
    alert("Невірний формат часу — введи як ГГ:ХХ, напр. 20:00");
    return;
  }
  const blob = new Blob([buildReminderIcs(+m[1], +m[2])], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "dictionary-reminder.ics";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  alert("Файл завантажено — відкрий його, щоб додати щоденне нагадування у свій календар.");
}

document.getElementById("reminder-btn").addEventListener("click", downloadReminder);

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
document.getElementById("ch-tools").addEventListener("click", toggleToolCallsPanel);
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
    // якщо є що повторити — Enter одразу починає міні-раунд "Ще раз
    // провалені", а не закриває вікно; якщо кнопки нема (нема провалів) —
    // стара поведінка (закрити). Escape вище вже завжди закриває незалежно
    // від цього — свідомий "пропустити" варіант
    if (e.key === "Enter") {
      if (!rvRetryWrong.hidden) retryWrong();
      else closeReview();
    }
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
