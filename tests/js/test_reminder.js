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

// якщо обраний час сьогодні вже минув — подія переноситься на завтра,
// інакше перший сигнал прийшов би одразу в минуле й ніколи не спрацював би
const now = new Date();
const pastHour = (now.getHours() - 1 + 24) % 24;
const icsPast = buildReminderIcs(pastHour, 0);
const m = /DTSTART:(\\d{8})T/.exec(icsPast);
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
const expected = \`\${tomorrow.getFullYear()}\${String(tomorrow.getMonth() + 1).padStart(2, "0")}\${String(tomorrow.getDate()).padStart(2, "0")}\`;
assert.strictEqual(m[1], expected, "час, що вже минув сьогодні -> подія переноситься на завтра");

console.log("ВСЕ OK: генерація .ics для щоденного нагадування коректна");
`);
