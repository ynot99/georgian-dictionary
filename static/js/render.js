"use strict";

// ---------- рендеринг ----------

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const searchEl = document.getElementById("search");

// переклад/приклад у списку приховані, доки не тапнеш слово — свідомо не в
// localStorage: скидається при кожному відкритті сторінки, але лишається
// розкритим у межах сесії (переживає повторні render() від пошуку/синку/тощо)
const revealedWords = new Set();

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function renameTagPrompt(oldTag) {
  const input = prompt(`Перейменувати тег «${oldTag}» на:`, oldTag);
  if (input === null) return;
  const newTag = normalizeTags(input);
  if (!newTag) { alert("Порожня назва тега — скасовано."); return; }
  if (newTag === oldTag) return;
  try {
    const res = await fetchWithTimeout("/api/tags/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ old: oldTag, new: newTag }),
    });
    if (!res.ok) throw new Error();
    const { updated } = await res.json();
    // локальні ще не синхронізовані слова сервер не бачив — виправляємо і їх
    for (const w of words) {
      if (!w.synced && tagList(w).includes(oldTag)) {
        w.tags = normalizeTags(tagList(w).map((t) => (t === oldTag ? newTag : t)).join(","));
      }
    }
    activeTag = newTag;
    online = true;
    await sync();
    if (updated) alert(`Перейменовано в ${updated} словах.`);
  } catch {
    online = false;
    render();
    alert("Перейменування тегів потребує з'єднання з сервером.");
  }
}

function renderTagbar() {
  const tagbar = document.getElementById("tagbar");
  const counts = new Map();
  for (const w of words) {
    for (const t of tagList(w)) counts.set(t, (counts.get(t) || 0) + 1);
  }
  const leechCount = words.filter(isLeech).length;
  if (activeTag && activeTag !== LEECH_TAG && !counts.has(activeTag)) activeTag = null;
  if (activeTag === LEECH_TAG && !leechCount) activeTag = null;
  tagbar.hidden = counts.size === 0 && !leechCount;
  tagbar.replaceChildren();
  if (!counts.size && !leechCount) return;
  const allChip = el("button", "chip" + (activeTag === null ? " active" : ""),
    `усі (${words.length})`);
  allChip.onclick = () => { activeTag = null; render(); };
  tagbar.append(allChip);
  if (leechCount) {
    const leechChip = el("button", "chip" + (activeTag === LEECH_TAG ? " active" : ""),
      `🩹 проблемні (${leechCount})`);
    leechChip.onclick = () => { activeTag = activeTag === LEECH_TAG ? null : LEECH_TAG; render(); };
    tagbar.append(leechChip);
  }
  for (const [tag, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const chip = el("button", "chip" + (activeTag === tag ? " active" : ""),
      `${tag} (${n})`);
    chip.onclick = () => { activeTag = activeTag === tag ? null : tag; render(); };
    tagbar.append(chip);
  }
  if (activeTag && activeTag !== LEECH_TAG) {
    const renameBtn = el("button", "chip", "✎");
    renameBtn.title = `Перейменувати тег «${activeTag}»`;
    renameBtn.onclick = () => renameTagPrompt(activeTag);
    tagbar.append(renameBtn);
  }
}

function render() {
  renderWod();
  renderStats();
  renderTagbar();
  const q = searchEl.value.trim().toLowerCase();
  const scope = wordsInScope();
  const shown = q
    ? scope.filter((w) =>
        w.georgian.toLowerCase().includes(q) ||
        w.translation.toLowerCase().includes(q))
    : scope;

  listEl.replaceChildren();
  for (const w of shown) {
    const card = el("div", "word");
    const body = el("div", "body tappable");
    const kaEl = el("div", "ka", w.georgian);
    if (isLeech(w)) {
      const badge = el("span", "leech-badge", "🩹");
      badge.title = `Проблемне слово — провалено на повтореннях ${LEECH_THRESHOLD}+ разів`;
      kaEl.append(badge);
    }
    body.append(kaEl);
    const revealed = revealedWords.has(w.uuid);
    if (revealed) {
      body.append(el("div", "tr", w.translation));
      if (w.example) body.append(el("div", "ex", w.example));
    } else {
      body.append(el("div", "tr hint", "тапни, щоб побачити переклад"));
    }
    body.onclick = () => {
      if (revealed) revealedWords.delete(w.uuid);
      else revealedWords.add(w.uuid);
      render();
    };
    const wTags = tagList(w);
    if (wTags.length) {
      const tagsEl = el("div", "tags");
      for (const t of wTags) tagsEl.append(el("span", "tag", t));
      body.append(tagsEl);
    }
    if (!w.synced) body.append(el("div", "pending", "⏳ не синхронізовано"));
    card.append(body);

    const actions = el("div", "actions");
    if (w.synced && w.id != null && online) {
      const editLink = el("a", null, "✎");
      editLink.href = `/edit/${w.id}`;
      editLink.title = "Редагувати";
      actions.append(editLink);
    }
    const delBtn = el("button", null, "✕");
    delBtn.title = "Видалити";
    delBtn.onclick = () => deleteWord(w);
    actions.append(delBtn);
    card.append(actions);
    listEl.append(card);
  }
  if (!shown.length) {
    listEl.append(el("p", "empty",
      q || activeTag ? "Нічого не знайдено." : "Поки що порожньо — додай перше слово!"));
  }

  const pending = words.filter((w) => !w.synced).length;
  statusEl.classList.toggle("offline", online === false);
  let text = `Слів: ${words.length}`;
  if (online === false) text += " · офлайн";
  if (pending) text += ` · ⏳ ${pending} не синхр.`;
  statusText.textContent = text;

  const { due, fresh } = collectDue();
  const total = due.length + Math.min(fresh.length, NEW_PER_SESSION);
  const reviewBtn = document.getElementById("review-btn");
  const scopeLabel = activeTag === LEECH_TAG ? "проблемні" : activeTag;
  const label = activeTag ? `🎓 Повторення: ${scopeLabel}` : "🎓 Повторення";
  reviewBtn.textContent = total ? `${label} (${total})` : label;
  reviewBtn.disabled = !total;
}
