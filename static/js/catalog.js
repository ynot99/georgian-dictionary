"use strict";

// ---------- довідник ----------

// Велика база слів, яких ще немає у вивченні. Зберігається локально, тож пошук
// працює офлайн; з сервера перекачується лише тоді, коли змінилась його версія.
const CATALOG_SEARCH_LIMIT = 20;
const CATALOG_TAG = "довідник";

let catalog = (() => {
  try { return JSON.parse(localStorage.getItem("catalog") || "[]"); }
  catch { return []; }
})();
let catalogVersion = localStorage.getItem("catalogVersion") || "";
let catalogFormIndex = null;   // форма → записи довідника; будується ліниво

function catalogForms(entry) {
  return [entry.georgian, ...(entry.forms || "").split(" ").filter(Boolean)];
}

function catalogEntriesForForm(form) {
  if (!catalogFormIndex) {
    catalogFormIndex = new Map();
    for (const entry of catalog) {
      for (const f of catalogForms(entry)) {
        const list = catalogFormIndex.get(f);
        if (!list) catalogFormIndex.set(f, [entry]);
        else if (!list.includes(entry)) list.push(entry);
      }
    }
  }
  return catalogFormIndex.get(form) || [];
}

async function refreshCatalog(version) {
  if (!version || version === catalogVersion) return;
  try {
    const res = await fetchWithTimeout("/api/catalog");
    if (!res.ok) throw new Error();
    const data = await res.json();
    catalog = data.entries;
    catalogVersion = data.version;
    catalogFormIndex = null;
    localStorage.setItem("catalog", JSON.stringify(catalog));
    localStorage.setItem("catalogVersion", catalogVersion);
    render();
  } catch {
    // довідник лишається попередній — наступний sync спробує знову
  }
}

// слова словника, записані цим словом довідника або будь-якою його формою
// (напр. у словнику "კალათბურთს", а в довіднику "კალათბურთი")
function wordsForEntry(entry) {
  const forms = new Set(catalogForms(entry));
  return words.filter((w) => forms.has(w.georgian.trim()));
}

// інші слова словника, формою яких є щойно введене слово — для попередження
// при ручному додаванні (точний збіг написання перевіряється окремо)
function relatedWords(georgian) {
  const found = [];
  for (const entry of catalogEntriesForForm(georgian)) {
    for (const w of wordsForEntry(entry)) {
      if (w.georgian !== georgian && !found.includes(w)) found.push(w);
    }
  }
  return found;
}

function searchCatalog(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const exact = catalogEntriesForForm(q);
  const rest = catalog.filter((e) => !exact.includes(e) && (
    e.georgian.includes(q) || e.translation.toLowerCase().includes(q)
  ));
  rest.sort((a, b) => a.rank - b.rank);
  return [...exact, ...rest].slice(0, CATALOG_SEARCH_LIMIT);
}

function addFromCatalog(entry) {
  if (wordsForEntry(entry).length) return;   // уже вчиш — дубліката не буде
  addWord(entry.georgian, entry.translation, "", [entry.pos, CATALOG_TAG].join(", "));
}

function renderCatalogHits(query) {
  const hits = searchCatalog(query);
  if (!hits.length) return 0;
  listEl.append(el("p", "catalog-title", "📚 Довідник"));
  for (const entry of hits) {
    const card = el("div", "word catalog-entry");
    const body = el("div", "body");
    const kaEl = el("div", "ka", entry.georgian);
    if (entry.pos) kaEl.append(el("span", "catalog-pos", entry.pos));
    body.append(kaEl, el("div", "tr", entry.translation));
    if (entry.gloss) body.append(el("div", "ex", `англ.: ${entry.gloss}`));
    const known = wordsForEntry(entry);
    if (known.length) {
      body.append(el("div", "catalog-known",
        `✓ у словнику: ${known.map((w) => w.georgian).join(", ")}`));
    }
    card.append(body);
    if (!known.length) {
      const actions = el("div", "actions");
      const addBtn = el("button", "catalog-add", "+ Вчити");
      addBtn.title = "Додати у вивчення";
      addBtn.onclick = () => addFromCatalog(entry);
      actions.append(addBtn);
      card.append(actions);
    }
    listEl.append(card);
  }
  return hits.length;
}
