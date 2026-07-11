"use strict";

// ---------- чат з репетитором ----------

const chatOverlay = document.getElementById("chat-overlay");
registerKeyboardAwareOverlay(chatOverlay);
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
let chatBusy = false;

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
