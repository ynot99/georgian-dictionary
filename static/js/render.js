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

// прокрутка панелі тегів до активного чипа (чи назад на початок при знятті
// фільтра) має спрацьовувати лише як РЕАКЦІЯ на зміну activeTag, а не на
// кожен render() узагалі (інакше звичайний пошук/синк відкидав би ручний
// скрол користувача) — тому порівнюємо з попереднім значенням
let lastActiveTagForScroll;

// сам елемент панелі тегів стабільний між рендерами (перебудовуються лише
// чипи всередині) — тримаємо один раз, щоб підписатись на scroll лише раз
const tagbarEl = document.getElementById("tagbar");

// тінь на sticky-контейнері кнопок ✎/🗑 — не просто "є переповнення взагалі",
// а саме "у поточній позиції скролу праворуч ще щось приховано". Викликається
// і з renderTagbar() (після перебудови чипів), і при самому скролі панелі.
function updateTagbarShadow() {
  const actions = tagbarEl.querySelector(".tagbar-actions");
  if (!actions) return;
  const hiddenToRight = tagbarEl.scrollWidth - tagbarEl.scrollLeft - tagbarEl.clientWidth > 1;
  actions.classList.toggle("overflowing", hiddenToRight);
}
tagbarEl.addEventListener("scroll", updateTagbarShadow);

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

async function deleteTagPrompt(tag) {
  if (!confirm(`Прибрати тег «${tag}» з усіх слів? Сам тег зникне з панелі, слова лишаться.`)) return;
  try {
    const res = await fetchWithTimeout("/api/tags/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag }),
    });
    if (!res.ok) throw new Error();
    const { deleted } = await res.json();
    // локальні ще не синхронізовані слова сервер не бачив — виправляємо і їх
    for (const w of words) {
      if (!w.synced && tagList(w).includes(tag)) {
        w.tags = normalizeTags(tagList(w).filter((t) => t !== tag).join(","));
      }
    }
    activeTag = null;
    online = true;
    await sync();
    if (deleted) alert(`Тег прибрано з ${deleted} слів.`);
  } catch {
    online = false;
    render();
    alert("Видалення тега потребує з'єднання з сервером.");
  }
}

function renderTagbar() {
  const tagbar = tagbarEl;
  const counts = new Map();       // звичайні теги
  const verbCounts = new Map();   // "дієслово:*" — окремо, згорнуті під один чип
  for (const w of words) {
    for (const t of tagList(w)) {
      if (t.startsWith(VERB_TAG_PREFIX)) verbCounts.set(t, (verbCounts.get(t) || 0) + 1);
      else counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const leechCount = words.filter(isLeech).length;
  const verbWordCount = words.filter((w) =>
    tagList(w).some((t) => t.startsWith(VERB_TAG_PREFIX))).length;
  // "у режимі дієслів" — або сам агрегатний чип активний, або конкретне дієслово з нього
  const inVerbView = activeTag === VERB_TAG
    || (typeof activeTag === "string" && activeTag.startsWith(VERB_TAG_PREFIX));

  if (activeTag && activeTag !== LEECH_TAG && activeTag !== VERB_TAG
      && !counts.has(activeTag) && !verbCounts.has(activeTag)) {
    activeTag = null;
  }
  if (activeTag === LEECH_TAG && !leechCount) activeTag = null;
  if (activeTag === VERB_TAG && !verbWordCount) activeTag = null;

  tagbar.hidden = counts.size === 0 && !leechCount && !verbWordCount;
  tagbar.replaceChildren();
  if (!counts.size && !leechCount && !verbWordCount) {
    lastActiveTagForScroll = activeTag;
    return;
  }

  let activeChipEl = null;   // чип, що відповідає поточному activeTag — для прокрутки

  const allChip = el("button", "chip" + (activeTag === null ? " active" : ""),
    `усі (${words.length})`);
  allChip.onclick = () => { activeTag = null; render(); };
  tagbar.append(allChip);

  if (leechCount) {
    const leechChip = el("button", "chip" + (activeTag === LEECH_TAG ? " active" : ""),
      `🩹 проблемні (${leechCount})`);
    leechChip.onclick = () => { activeTag = activeTag === LEECH_TAG ? null : LEECH_TAG; render(); };
    tagbar.append(leechChip);
    if (activeTag === LEECH_TAG) activeChipEl = leechChip;
  }

  if (verbWordCount) {
    const verbChip = el("button", "chip" + (inVerbView ? " active" : ""),
      `📖 Дієслова (${verbWordCount})`);
    verbChip.onclick = () => { activeTag = inVerbView ? null : VERB_TAG; render(); };
    tagbar.append(verbChip);
    if (activeTag === VERB_TAG) activeChipEl = verbChip;
  }

  if (inVerbView) {
    // розгорнутий вигляд: лише конкретні дієслова (без звичайних тегів поруч)
    for (const [tag, n] of [...verbCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const chip = el("button", "chip" + (activeTag === tag ? " active" : ""),
        `${tag.slice(VERB_TAG_PREFIX.length)} (${n})`);
      chip.onclick = () => { activeTag = activeTag === tag ? VERB_TAG : tag; render(); };
      tagbar.append(chip);
      if (activeTag === tag) activeChipEl = chip;
    }
  } else {
    for (const [tag, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      const chip = el("button", "chip" + (activeTag === tag ? " active" : ""),
        `${tag} (${n})`);
      chip.onclick = () => { activeTag = activeTag === tag ? null : tag; render(); };
      tagbar.append(chip);
      if (activeTag === tag) activeChipEl = chip;
    }
  }

  if (activeTag && activeTag !== LEECH_TAG && activeTag !== VERB_TAG) {
    // sticky-контейнер: щоб не гортати панель до самого кінця, коли тегів
    // уже багато — обидві кнопки в одному елементі, інакше кожна окремо
    // "прилипала" б до того самого правого краю й перекривала іншу
    const actions = el("div", "tagbar-actions");
    const renameBtn = el("button", "chip", "✎");
    renameBtn.title = `Перейменувати тег «${activeTag}»`;
    renameBtn.onclick = () => renameTagPrompt(activeTag);
    actions.append(renameBtn);

    const deleteBtn = el("button", "chip", "🗑");
    deleteBtn.title = `Прибрати тег «${activeTag}» з усіх слів`;
    deleteBtn.onclick = () => deleteTagPrompt(activeTag);
    actions.append(deleteBtn);
    tagbar.append(actions);
  }

  // прокрутка — лише якщо тег справді щойно змінився (не на кожен render())
  if (activeTag !== lastActiveTagForScroll) {
    if (activeTag === null) tagbar.scrollLeft = 0;
    else if (activeChipEl) activeChipEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  lastActiveTagForScroll = activeTag;

  updateTagbarShadow();   // після можливої прокрутки вище — щоб врахувати фінальну позицію
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
      for (const t of wTags) {
        const tagEl = el("span", "tag tappable" + (t === activeTag ? " active" : ""), t);
        tagEl.onclick = (e) => {
          e.stopPropagation();   // інакше клік по тегу ще й перемкнув би переклад картки
          activeTag = activeTag === t ? null : t;
          render();
        };
        tagsEl.append(tagEl);
      }
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
  const scopeLabel = activeTag === LEECH_TAG ? "проблемні"
    : activeTag === VERB_TAG ? "дієслова" : activeTag;
  const label = activeTag ? `🎓 Повторення: ${scopeLabel}` : "🎓 Повторення";
  reviewBtn.textContent = total ? `${label} (${total})` : label;
  reviewBtn.disabled = !total;

  // тренування — лише для конкретної категорії: пройти всю тему зараз має сенс,
  // а "тренувати весь словник" (activeTag === null) дублювало б звичайне
  // повторення, тільки без користі для розкладу
  const practiceBtn = document.getElementById("practice-btn");
  const practiceCards = activeTag ? wordsInScope().length * DIRECTIONS.length : 0;
  practiceBtn.hidden = !practiceCards;
  if (practiceCards) {
    practiceBtn.textContent = `🎯 Тренувати: ${scopeLabel} (${practiceCards})`;
    practiceBtn.title = "Пройти всю категорію зараз — не впливає на SRS-розклад";
  }

  const nextEl = document.getElementById("review-next");
  const next = !total && nextDueAt();
  nextEl.hidden = !next;
  if (next) nextEl.textContent = formatNextDue(next);
}

// due_at зберігається в UTC (nowStr()/dueDateStr() з toISOString()) — тому
// перед показом користувачу переводимо назад у його локальний час
function formatNextDue(dueAtUtc) {
  const due = new Date(dueAtUtc.replace(" ", "T") + "Z");
  const now = new Date();
  const time = due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dueDay = localDateKey(due);
  if (dueDay === localDateKey(now)) return `Наступне повторення сьогодні о ${time}`;
  if (dueDay === localDateKey(new Date(now.getTime() + 86400000))) {
    return `Наступне повторення завтра о ${time}`;
  }
  const dateStr = due.toLocaleDateString([], { day: "numeric", month: "short" });
  return `Наступне повторення ${dateStr} о ${time}`;
}
