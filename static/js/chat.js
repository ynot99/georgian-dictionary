"use strict";

// ---------- чат з репетитором ----------

const chatOverlay = document.getElementById("chat-overlay");
registerKeyboardAwareOverlay(chatOverlay);
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
let chatBusy = false;

// чернетка недописаного повідомлення переживає закриття вкладки/застосунку
// (не лише перехід між екранами в межах тієї ж сесії) — щоб написане й
// незаслане нікуди не зникало, якщо повернувся до чату значно пізніше
const CHAT_DRAFT_KEY = "chatDraft";

function saveChatDraft() {
  if (chatInput.value) localStorage.setItem(CHAT_DRAFT_KEY, chatInput.value);
  else localStorage.removeItem(CHAT_DRAFT_KEY);
}

const savedDraft = localStorage.getItem(CHAT_DRAFT_KEY);
if (savedDraft) chatInput.value = savedDraft;
chatInput.addEventListener("input", saveChatDraft);

// поки триває стрімінг відповіді — кнопка відправлення показує спінер
// замість "➤", щоб було видно, чи ще думає, чи вже готово
function setChatSending(sending) {
  chatSend.disabled = sending;
  if (sending) chatSend.replaceChildren(el("span", "spinner"));
  else chatSend.textContent = "➤";
}

// Клавіатура доанімовується вже ПІСЛЯ того, як повідомлення прокрутились до
// низу (мережевий запит зазвичай встигає раніше) — тодішній scrollTop вже не
// збігається зі справжнім кінцем, коли chatOverlay остаточно стискається під
// клавіатуру. Довідскролюємо, щойно visualViewport "осідає".
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    if (!chatOverlay.hidden) chatLog.scrollTop = chatLog.scrollHeight;
  });
}

// репетитор посилається на нотатку форматом [[note:ID|Назва]] — розбираємо
// на текст + клікабельні "жетони" без innerHTML (безпечно від довільного HTML)
const NOTE_REF_RE = /\[\[note:(\d+)\|([^\]]+)\]\]/g;

function parseNoteRefs(text) {
  NOTE_REF_RE.lastIndex = 0;
  const parts = [];
  let last = 0, m;
  while ((m = NOTE_REF_RE.exec(text))) {
    if (m.index > last) parts.push({ type: "text", value: text.slice(last, m.index) });
    parts.push({ type: "note", id: Number(m[1]), title: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

function renderBubbleContent(bubble, text) {
  bubble.replaceChildren();
  for (const part of parseNoteRefs(text)) {
    if (part.type === "text") {
      bubble.append(document.createTextNode(part.value));
    } else {
      const btn = el("button", "note-link", `📖 ${part.title}`);
      btn.type = "button";
      btn.onclick = () => openNotes(part.id);
      bubble.append(btn);
    }
  }
}

function chatBubble(role, text) {
  const bubble = el("div", "msg " + role);
  if (role === "assistant") renderBubbleContent(bubble, text);
  else bubble.textContent = text;
  chatLog.append(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
  return bubble;
}

function chatNote(text) {
  chatLog.append(el("p", "ch-note", text));
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function openChat() {
  chatOverlay.hidden = false;
  lockBodyScroll();
  syncOverlaysToViewport();
  forceReflow(chatOverlay);
  chatInput.focus();
  // якщо саме зараз у цій вкладці стрімиться відповідь — не перебудовувати
  // чат під живим бабблом; інакше завжди підтягуємо свіжий стан з сервера:
  // відповідь могла доробитись у фоні, поки вкладка була згорнута/закрита
  if (chatBusy) return;
  chatLog.replaceChildren();
  try {
    const res = await fetch("/api/chat");
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data.configured) {
      chatNote("Чат не налаштований. Створи файл .env поруч з app.py (зразок — .env.example), " +
        "встав туди ANTHROPIC_API_KEY з console.anthropic.com і перезапусти сервер.");
      return;
    }
    for (const m of data.messages) chatBubble(m.role, m.content);
    if (!data.messages.length) {
      chatNote("Привіт! Я твій репетитор грузинської — знаю всі слова з твого словника " +
        "і твій прогрес. Напиши щось українською або грузинською 🙂");
    }
  } catch {
    chatNote("Немає з'єднання з сервером — чат працює лише онлайн, у домашній мережі.");
  }
}

// стрімінг: без таймауту (Claude може відповідати десятки секунд)
async function sendChat(e) {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || chatBusy) return;
  chatBusy = true;
  setChatSending(true);
  chatInput.value = "";
  localStorage.removeItem(CHAT_DRAFT_KEY);   // надіслано -> це вже не чернетка
  chatBubble("user", text);
  const bubble = chatBubble("assistant", "…");
  bubble.classList.add("pending");
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "server error");
    }
    bubble.classList.remove("pending");
    bubble.textContent = "";
    let full = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      bubble.textContent = full;   // жива типографія під час стрімінгу
      chatLog.scrollTop = chatLog.scrollHeight;
    }
    if (!full) full = "(порожня відповідь)";
    renderBubbleContent(bubble, full);   // фінальний прохід: [[note:..]] -> клікабельні жетони
    // репетитор міг додати слово через add_word або нотатку через save_grammar_note
    sync();
  } catch (err) {
    bubble.classList.remove("pending");
    bubble.textContent = "⚠️ " + (err.message && err.message !== "Failed to fetch"
      ? err.message
      : "Не вдалося з'єднатися з сервером — чат працює лише онлайн.");
  }
  chatBusy = false;
  setChatSending(false);
  chatInput.focus();
}

async function clearChat() {
  if (!confirm("Очистити всю історію розмови?")) return;
  try {
    const res = await fetch("/api/chat", { method: "DELETE" });
    if (!res.ok) throw new Error();
    chatLog.replaceChildren();
    chatNote("Історію очищено. Почнімо заново!");
  } catch {
    alert("Немає з'єднання з сервером.");
  }
}

// ---------- 🔔 останні дії інструментів (add_word/edit_word/тощо) ----------

const toolCallsPanel = document.getElementById("tool-calls-panel");
// які картки розгорнуті — лише в межах сесії, скидається при перезавантаженні
const expandedToolCalls = new Set();

// поле, за яким тулза ШУКАЛА вже існуюче слово/нотатку (а не додавала як нове)
// — показуємо окремим рядком "🔎 ...", щоб не плутати з полями, які реально
// змінились (add_word/save_grammar_note тут немає: там усі поля — дані нового
// запису, шукати нема що)
const TOOL_LOOKUP_KEY = {
  edit_word: "georgian",
  retag_word: "georgian",
  get_grammar_note: "id",
};

function toolCallDetailLines(call) {
  const input = call.input || {};
  const lookupKey = TOOL_LOOKUP_KEY[call.tool_name];
  const lines = [];
  if (lookupKey && input[lookupKey] !== undefined) {
    lines.push({ cls: "tc-line tc-lookup", text: `🔎 ${input[lookupKey]}` });
  }
  for (const [k, v] of Object.entries(input)) {
    if (k !== lookupKey) lines.push({ cls: "tc-line", text: `${k}: ${v}` });
  }
  if (call.ok) {
    // uuid — внутрішній технічний ідентифікатор слова, ніде в UI не показується
    // й нічого не додає до розуміння "що сталось"; інші поля результату
    // показуємо лише якщо вони відрізняються від уже показаного вводу
    // (напр. retag_word повертає ПОВНИЙ злитий список тегів, а не лише додані)
    for (const [k, v] of Object.entries(call.result || {})) {
      if (k === "ok" || k === "uuid") continue;
      if (input[k] === v) continue;
      lines.push({ cls: "tc-line", text: `→ ${k}: ${v}` });
    }
  } else {
    lines.push({ cls: "tc-line", text: `→ помилка: ${(call.result && call.result.error) || "?"}` });
  }
  return lines;
}

function renderToolCalls(calls) {
  toolCallsPanel.replaceChildren();
  if (!calls.length) {
    toolCallsPanel.append(el("p", "tc-empty", "Ще жодного виклику інструментів."));
    return;
  }
  for (const call of calls) {
    const item = el("div", "tc-item");
    const header = el("button", "tc-header" + (call.ok ? "" : " tc-error"),
      `${call.ok ? "✓" : "⚠️"} ${call.summary}`);
    header.type = "button";
    const details = el("div", "tc-details");
    details.hidden = !expandedToolCalls.has(call.id);
    for (const line of toolCallDetailLines(call)) details.append(el("div", line.cls, line.text));
    header.onclick = () => {
      details.hidden = !details.hidden;
      if (details.hidden) expandedToolCalls.delete(call.id);
      else expandedToolCalls.add(call.id);
    };
    item.append(header, details);
    toolCallsPanel.append(item);
  }
}

// перебудовується щоразу — дії могли статись у фоновій генерації, поки
// панель була закрита (той самий принцип, що й у openChat())
async function toggleToolCallsPanel() {
  if (!toolCallsPanel.hidden) {
    toolCallsPanel.hidden = true;
    return;
  }
  toolCallsPanel.hidden = false;
  toolCallsPanel.replaceChildren(el("p", "tc-empty", "Завантаження…"));
  try {
    const res = await fetch("/api/tool_calls");
    if (!res.ok) throw new Error();
    const data = await res.json();
    renderToolCalls(data.calls);
  } catch {
    toolCallsPanel.replaceChildren(el("p", "tc-empty", "Немає з'єднання з сервером."));
  }
}
