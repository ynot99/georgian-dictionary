"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// формат DTSTART/DTSTAMP і базова структура .ics
const ics = buildReminderIcs(20, 5);
assert.ok(ics.startsWith("BEGIN:VCALENDAR\\r\\n"), "має починатись з BEGIN:VCALENDAR");
assert.ok(ics.includes("RRULE:FREQ=DAILY"), "нагадування має повторюватись щодня");
assert.ok(ics.includes("BEGIN:VALARM") && ics.includes("END:VALARM"), "має містити сигнал (VALARM)");
assert.match(ics, /DTSTART:\\d{8}T200500/, "час у DTSTART відповідає переданим годині/хвилині");
assert.match(ics, /UID:.+@dictionary-app/, "UID згенерований");
assert.ok(ics.endsWith("END:VCALENDAR\\r\\n"), "має закінчуватись END:VCALENDAR");

// DTSTART = перше МАЙБУТНЄ спрацювання обраного часу: якщо час сьогодні вже
// минув — переноситься на завтра, інакше лишається сьогодні (перший сигнал не
// має прийти одразу в минуле). Беремо час на годину раніше поточного; чи це
// минуле сьогодні, чи вже майбутнє (напр. біля півночі година−1 = 23 год, а це
// ще попереду) — очікувану дату рахуємо тим самим правилом, що й код, а не
// припускаємо "завжди завтра" (це й ламало тест одразу після опівночі).
const now = new Date();
const testHour = (now.getHours() + 23) % 24;   // на годину раніше, з переходом через північ
const testMin = now.getMinutes();
const icsPast = buildReminderIcs(testHour, testMin);
const m = /DTSTART:(\\d{8})T/.exec(icsPast);
const occ = new Date(now.getFullYear(), now.getMonth(), now.getDate(), testHour, testMin, 0);
if (occ < now) occ.setDate(occ.getDate() + 1);
const expected = \`\${occ.getFullYear()}\${String(occ.getMonth() + 1).padStart(2, "0")}\${String(occ.getDate()).padStart(2, "0")}\`;
assert.strictEqual(m[1], expected, "DTSTART = перше майбутнє спрацювання обраного часу");

console.log("ВСЕ OK: генерація .ics для щоденного нагадування коректна");
`);
