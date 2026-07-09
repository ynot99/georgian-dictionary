"use strict";

// ---------- CSV-експорт ----------

// Клієнтський (не серверний) експорт: PWA в standalone-режимі не має кнопки
// "назад", тож звичайне посилання на /export.csv "виносить" з застосунку
// без можливості повернутись. Генеруємо CSV з уже наявних локальних даних —
// заодно працює й офлайн.
function csvField(value) {
  const s = String(value ?? "");
  return /["\r\n,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportCsv() {
  // uuid потрібен, щоб імпорт міг оновити саме це слово, а не створити дублікат
  const rows = [["uuid", "georgian", "translation", "example", "tags", "created_at"], ...words.map(
    (w) => [w.uuid, w.georgian, w.translation, w.example, w.tags || "", w.created_at]
  )];
  const csv = "﻿" + rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dictionary-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- CSV-імпорт ----------

// Розбирає CSV з лапками, комами й переносами рядків усередині полів
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = "";
      rows.push(row); row = [];
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

// CSV → список слів; колонки шукаються по заголовку, порядок неважливий
function csvToWords(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("Файл порожній або без рядків даних.");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = {};
  for (const name of ["uuid", "georgian", "translation", "example", "tags", "created_at"]) {
    col[name] = header.indexOf(name);
  }
  if (col.georgian === -1 || col.translation === -1) {
    throw new Error("У заголовку CSV мають бути колонки georgian і translation.");
  }
  const pick = (r, name) => (col[name] === -1 ? "" : (r[col[name]] || "").trim());
  return rows.slice(1).map((r) => ({
    uuid: pick(r, "uuid"),
    georgian: pick(r, "georgian"),
    translation: pick(r, "translation"),
    example: pick(r, "example"),
    tags: pick(r, "tags"),
    created_at: pick(r, "created_at"),
  }));
}

async function importCsv(file) {
  let incoming;
  try {
    incoming = csvToWords(await file.text());
  } catch (err) {
    alert("Не вдалося прочитати CSV: " + err.message);
    return;
  }
  const known = new Set(words.map((w) => w.uuid));
  const toUpdate = incoming.filter((r) => r.uuid && known.has(r.uuid)).length;
  const toCreate = incoming.length - toUpdate;
  if (!confirm(`Імпорт: рядків ${incoming.length} — оновиться до ${toUpdate}, нових до ${toCreate}. Продовжити?`)) return;
  try {
    const res = await fetchWithTimeout("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: incoming }),
    });
    if (!res.ok) throw new Error();
    const c = await res.json();
    await sync();   // підтягнути оновлений стан з сервера
    alert(`Імпорт завершено: оновлено ${c.updated}, додано ${c.created}, без змін ${c.unchanged}, пропущено ${c.skipped}.`);
  } catch {
    online = false;
    render();
    alert("Імпорт потребує з'єднання з сервером — спробуй, коли будеш у домашній мережі.");
  }
}
