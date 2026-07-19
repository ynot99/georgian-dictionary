"use strict";

// ---------- звукове нагадування (поки сайт відкрито) ----------

// НЕ push і НЕ .ics: сигнал, поки вкладка з застосунком відкрита на комп'ютері.
// Замість періодичного опитування ставимо ОДИН таймер рівно на момент, коли
// дозріє найближча запланована картка (той самий розрахунок, що й рядок
// "Наступне повторення …"). Спрацював — коротко бренькаємо (Web Audio, без
// зовнішнього файлу) і переплановуємось на наступну. Стан у localStorage, опція
// поруч із 📅 на головному екрані.

const SOUND_KEY = "reviewSound";
let soundOn = localStorage.getItem(SOUND_KEY) === "1";
let chimeTimer = null;
let audioCtx = null;

// setTimeout зберігає затримку 32-бітним числом — усе понад ~24.85 дня
// переповнюється й спрацьовує НЕГАЙНО. А SRS-інтервали сягають 120 днів, тож
// задовге очікування ставимо порціями: дійшовши до межі, переплановуємось наново
const MAX_TIMEOUT = 2147483647;

const soundBtn = document.getElementById("sound-btn");

// найраніша МАЙБУТНЯ картка по ВСЬОМУ словнику (не за activeTag — сигнал не має
// залежати від активного фільтра). Уже прострочені НЕ враховуємо: вони — база
// (їх і так видно на кнопці "🎓 Повторення"), а бренькати треба саме на нове
// дозрівання. null, якщо запланованих майбутніх карток нема. По суті — той самий
// nextDueAt() з srs.js, але по всіх словах, а не лише в межах активного тега
function nextDueAtAll() {
  const now = nowStr();
  let earliest = null;
  for (const w of words) {
    for (const dir of DIRECTIONS) {
      const r = reviews[w.uuid + "|" + dir];
      if (r && r.due_at > now && (earliest === null || r.due_at < earliest)) {
        earliest = r.due_at;
      }
    }
  }
  return earliest;
}

// скільки мс лишилось до due_at (зберігається в UTC "YYYY-MM-DD HH:MM:SS")
function msUntilDue(dueAtUtc) {
  return new Date(dueAtUtc.replace(" ", "T") + "Z").getTime() - Date.now();
}

// яку затримку ставити цього разу. Якщо до дозрівання більше за 32-бітну межу
// setTimeout — чекаємо лише до межі (done:false -> проміжна порція, переставимось
// знову), інакше done:true -> цього разу справді бренькнемо. Від'ємне (картка вже
// дозріла на волосину) підтягуємо до 0
function chimeStep(delayMs) {
  if (delayMs > MAX_TIMEOUT) return { delay: MAX_TIMEOUT, done: false };
  return { delay: Math.max(0, delayMs), done: true };
}

function clearChimeTimer() {
  if (chimeTimer !== null) window.clearTimeout(chimeTimer);
  chimeTimer = null;
}

// (пере)ставляємо єдиний таймер на дозрівання найближчої майбутньої картки.
// Викликається при вмиканні звуку і щоразу, коли змінюються reviews — усі такі
// зміни (grade / sync / видалення слова) проходять через saveReviews()
function scheduleNextChime() {
  clearChimeTimer();
  if (!soundOn) return;
  const next = nextDueAtAll();
  if (next === null) return;   // нема майбутніх карток — таймер не потрібен
  const { delay, done } = chimeStep(msUntilDue(next));
  chimeTimer = window.setTimeout(done ? onChimeDue : scheduleNextChime, delay);
}

function onChimeDue() {
  chimeTimer = null;
  // не бренькаємо поверх відкритої сесії повторення — там і так усе перед очима
  if (soundOn && overlay.hidden) playChime();
  // картка, що щойно дозріла, вже "минула" -> nextDueAtAll поверне наступну
  scheduleNextChime();
}

// два коротких м'яких тони із загасанням — приємний «дзинь», без різкості
function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t0 = audioCtx.currentTime;
    for (const [freq, at] of [[880, 0], [1320, 0.16]]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      // старт із майже-нуля й expo-загасання: без клацань на початку/кінці
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.25);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.3);
    }
  } catch { /* Web Audio недоступний — тихо ігноруємо */ }
}

function applySoundBtn() {
  soundBtn.textContent = soundOn ? "🔔" : "🔕";
  soundBtn.title = soundOn
    ? "Звук нагадування увімкнено — тапни, щоб вимкнути"
    : "Звук, коли настає час повторення (лише поки сайт відкрито) — тапни, щоб увімкнути";
}

function toggleSound() {
  soundOn = !soundOn;
  localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
  applySoundBtn();
  if (soundOn) {
    // сам клік — це користувацький жест: створюємо/розбуджуємо AudioContext саме
    // зараз, щоб політика автовідтворення не заблокувала звук пізніше на таймері,
    // і одразу коротко бренькаємо як підтвердження, що звук працює
    playChime();
    scheduleNextChime();
  } else {
    clearChimeTimer();
  }
}

// AudioContext, створений без користувацького жесту (напр. одразу після
// перезавантаження вкладки, де звук лишився увімкненим), стартує «suspended» і
// на таймері може не зазвучати — тож розблоковуємо його на першому ж жесті
function primeAudioOnce() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  try {
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* ігноруємо */ }
}

applySoundBtn();
if (soundOn) {
  scheduleNextChime();
  window.addEventListener("pointerdown", primeAudioOnce, { once: true });
  window.addEventListener("keydown", primeAudioOnce, { once: true });
}
