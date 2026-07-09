"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// простий CSV
let ws = csvToWords("uuid,georgian,translation,example,created_at\\nu1,წყალი,вода,,2026-07-01 10:00:00\\n");
assert.strictEqual(ws.length, 1);
assert.strictEqual(ws[0].uuid, "u1");
assert.strictEqual(ws[0].translation, "вода");

// BOM + CRLF + лапки з комою, подвоєні лапки, перенос рядка в полі
let raw = "\\uFEFFuuid,georgian,translation,example,created_at\\r\\n" +
  'u2,კარგი,"добре, гаразд","він сказав ""კარგი""",2026-07-01 10:00:00\\r\\n' +
  'u3,პური,хліб,"перший рядок\\nдругий рядок",2026-07-01 10:00:00\\r\\n';
ws = csvToWords(raw);
assert.strictEqual(ws.length, 2, "к-сть рядків: " + ws.length);
assert.strictEqual(ws[0].translation, "добре, гаразд", "кома в лапках");
assert.strictEqual(ws[0].example, 'він сказав "კარგი"', "подвоєні лапки");
assert.strictEqual(ws[1].example, "перший рядок\\nдругий рядок", "перенос у полі");

// інший порядок колонок + відсутня колонка example
ws = csvToWords("translation,georgian,uuid\\nвогонь,ცეცხლი,u4\\n");
assert.strictEqual(ws[0].uuid, "u4");
assert.strictEqual(ws[0].georgian, "ცეცხლი");
assert.strictEqual(ws[0].example, "");

// без обов'язкових колонок — помилка
assert.throws(() => csvToWords("a,b\\n1,2\\n"), /georgian.*translation/);

// порожні рядки в кінці файла ігноруються
ws = csvToWords("georgian,translation\\nდიახ,так\\n\\n\\n");
assert.strictEqual(ws.length, 1, "порожні рядки: " + ws.length);

// цикл export -> import: те, що згенерував csvField, парситься назад без втрат
const tricky = [
  { uuid: "e1", georgian: 'ციტატა "тест"', translation: "з комою, тут", example: "рядок1\\nрядок2", created_at: "2026-07-06 10:00:00" },
];
const rows = [["uuid", "georgian", "translation", "example", "created_at"],
  ...tricky.map((w) => [w.uuid, w.georgian, w.translation, w.example, w.created_at])];
const csv = rows.map((r) => r.map(csvField).join(",")).join("\\r\\n") + "\\r\\n";
ws = csvToWords(csv);
assert.strictEqual(ws[0].georgian, tricky[0].georgian, "roundtrip georgian");
assert.strictEqual(ws[0].translation, tricky[0].translation, "roundtrip translation");
assert.strictEqual(ws[0].example, tricky[0].example, "roundtrip example");

console.log("ВСЕ OK: CSV-парсер та roundtrip export/import коректні");
`);
