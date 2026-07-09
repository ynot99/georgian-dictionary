"use strict";

// ---------- слово дня та статистика ----------

// детерміноване на день: у всіх рендерах те саме слово, завтра — інше
function wordOfDay() {
  if (!words.length) return null;
  const sorted = [...words].sort((a, b) => (a.uuid < b.uuid ? -1 : 1));
  let h = 0;
  for (const ch of localDateKey()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return sorted[h % sorted.length];
}

// переклад слова дня відкривається/ховається по тапу; стан зберігається на
// весь день (localStorage), тож повторний заход того ж дня його не скидає
function isWodRevealed() {
  return localStorage.getItem("wodRevealedDate") === localDateKey();
}

function toggleWod() {
  if (isWodRevealed()) localStorage.removeItem("wodRevealedDate");
  else localStorage.setItem("wodRevealedDate", localDateKey());
  render();
}

function renderWod() {
  const box = document.getElementById("wod");
  const w = wordOfDay();
  box.hidden = !w;
  if (!w) return;
  const parts = [el("div", "wod-label", "Слово дня"), el("div", "wod-ka", w.georgian)];
  if (isWodRevealed()) {
    parts.push(el("div", "wod-tr", w.translation + (w.example ? " · " + w.example : "")));
  } else {
    parts.push(el("div", "wod-hint", "тапни, щоб побачити переклад"));
  }
  box.onclick = toggleWod;
  box.replaceChildren(...parts);
}

function streakDays() {
  let s = 0;
  const d = new Date();
  // якщо сьогодні ще не повторював — серія рахується до вчора включно
  if (!(reviewLog[localDateKey(d)] > 0)) d.setDate(d.getDate() - 1);
  while (reviewLog[localDateKey(d)] > 0) {
    s++;
    d.setDate(d.getDate() - 1);
  }
  return s;
}

function statsData() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
    .slice(0, 19).replace("T", " ");
  const addedWeek = words.filter((w) => w.created_at >= weekAgo).length;

  // рівень картки = поточний рівень SRS; слово має 2 картки (напрямки)
  let fresh = 0, learning = 0, solid = 0;
  for (const w of words) {
    for (const dir of DIRECTIONS) {
      const r = reviews[w.uuid + "|" + dir];
      const level = r ? r.level : 0;
      if (level === 0) fresh++;
      else if (level <= 3) learning++;
      else solid++;
    }
  }

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last7.push(reviewLog[localDateKey(d)] || 0);
  }

  return {
    total: words.length,
    addedWeek,
    fresh, learning, solid,
    reviewedToday: reviewLog[localDateKey()] || 0,
    streak: streakDays(),
    last7,
  };
}

let statsVisible = false;

function renderStats() {
  const box = document.getElementById("stats");
  box.hidden = !statsVisible;
  if (!statsVisible) return;
  const s = statsData();
  box.replaceChildren(
    el("div", null, `Слів: ${s.total}` +
      (s.addedWeek ? ` (+${s.addedWeek} за 7 днів)` : "")),
    el("div", null, `Картки: 🆕 нові ${s.fresh} · 📖 вивчаються ${s.learning} · 💪 закріплені ${s.solid}`),
    el("div", null, `Сьогодні повторено: ${s.reviewedToday}` +
      (s.streak ? ` · серія: ${s.streak} дн. 🔥` : "")),
    el("div", "muted", `Останні 7 днів: ${s.last7.join(" · ")}`),
  );
}
