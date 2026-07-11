"use strict";

// ---------- локальне сховище ----------

const store = {
  load() {
    try { return JSON.parse(localStorage.getItem("words") || "[]"); }
    catch { return []; }
  },
  save(words) { localStorage.setItem("words", JSON.stringify(words)); },
};

let words = store.load();
let online = null;   // null = ще не знаємо

// прогрес повторень: ключ "uuid|напрямок" → {level, due_at, reviewed_at, synced}
let reviews = (() => {
  try { return JSON.parse(localStorage.getItem("reviews") || "{}"); }
  catch { return {}; }
})();
function saveReviews() { localStorage.setItem("reviews", JSON.stringify(reviews)); }

// журнал повторень по днях (локальна дата → кількість оцінених карток);
// живе тільки на цьому пристрої, потрібен для статистики й серії днів
let reviewLog = (() => {
  try { return JSON.parse(localStorage.getItem("reviewLog") || "{}"); }
  catch { return {}; }
})();

function localDateKey(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function logReview() {
  const k = localDateKey();
  reviewLog[k] = (reviewLog[k] || 0) + 1;
  localStorage.setItem("reviewLog", JSON.stringify(reviewLog));
}

// зарезервовані для вбудованих чипів у панелі тегів ("усі", "🩹 проблемні") —
// звичайним тегом стати не можуть, інакше в панелі буде два однакові на вигляд чипи
const RESERVED_TAGS = ["усі", "проблемні"];

// теги форм дієслів ("дієслово:<словникова форма>", конвенція чату — див.
// server/chat.py) згортаються в панелі під один чип "📖 Дієслова", інакше
// кожне нове дієслово додавало б окремий чип і панель швидко заповнилась би
const VERB_TAG_PREFIX = "дієслово:";
// "віртуальний тег" для activeTag: фільтр за будь-яким тегом з цим префіксом
const VERB_TAG = " verbs";

// "їжа, Дієслова,їжа" → "їжа, дієслова" (трім, нижній регістр, без дублів,
// без зарезервованих слів)
function normalizeTags(raw) {
  const seen = [];
  for (let t of (raw || "").split(",")) {
    t = t.trim().toLowerCase();
    if (t && !RESERVED_TAGS.includes(t) && !seen.includes(t)) seen.push(t);
  }
  return seen.join(", ");
}

function tagList(w) {
  return (w.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
}

let activeTag = null;   // активний фільтр списку і повторення

function wordsInScope() {
  if (activeTag === LEECH_TAG) return words.filter(isLeech);
  if (activeTag === VERB_TAG) {
    return words.filter((w) => tagList(w).some((t) => t.startsWith(VERB_TAG_PREFIX)));
  }
  return activeTag ? words.filter((w) => tagList(w).includes(activeTag)) : words;
}

function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // insecure context не має randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ---------- синхронізація ----------

// Без Wi-Fi (не просто "інтернет лежить") fetch() може висіти ~20-30с, поки
// ОС не здасться достукатись до локальної IP. Обмежуємо коротким таймаутом,
// щоб індикатор статусу і кнопки не зависали.
const NETWORK_TIMEOUT_MS = 4000;

function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

async function sync() {
  const pending = words.filter((w) => !w.synced);
  const pendingReviews = Object.values(reviews).filter((r) => !r.synced);
  try {
    const res = await fetchWithTimeout("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ words: pending, reviews: pendingReviews }),
    });
    if (!res.ok) throw new Error("sync failed");
    const data = await res.json();
    words = data.words.map((w) => ({ ...w, synced: true }));
    store.save(words);
    reviews = {};
    for (const r of data.reviews || []) {
      reviews[r.word_uuid + "|" + r.direction] = { ...r, synced: true };
    }
    saveReviews();
    online = true;
  } catch {
    online = false;
  }
  render();
}

// ---------- дії ----------

function addWord(georgian, translation, example, tags) {
  words.unshift({
    uuid: makeUuid(),
    id: null,
    georgian, translation, example,
    tags: normalizeTags(tags),
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    synced: false,
  });
  store.save(words);
  render();
  sync();
}

function dropLocalWord(uuid) {
  words = words.filter((x) => x.uuid !== uuid);
  store.save(words);
  for (const key of Object.keys(reviews)) {
    if (key.startsWith(uuid + "|")) delete reviews[key];
  }
  saveReviews();
}

async function deleteWord(w) {
  if (!confirm(`Видалити «${w.georgian}»?`)) return;
  if (!w.synced) {
    dropLocalWord(w.uuid);
    render();
    return;
  }
  try {
    const res = await fetchWithTimeout(`/api/words/${w.uuid}`, { method: "DELETE" });
    if (!res.ok) throw new Error();
    dropLocalWord(w.uuid);
    online = true;
  } catch {
    online = false;
    alert("Немає з'єднання з сервером — видалення збереженого слова можливе лише онлайн.");
  }
  render();
}
