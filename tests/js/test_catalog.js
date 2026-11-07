"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

catalog = [
  { id: 1, georgian: "წყალი", pos: "іменник", translation: "вода", gloss: "water",
    forms: "წყლის წყალს წყლით", rank: 2 },
  { id: 2, georgian: "კალათბურთი", pos: "іменник", translation: "баскетбол", gloss: "basketball",
    forms: "კალათბურთის კალათბურთს", rank: 5 },
  { id: 3, georgian: "წყარო", pos: "іменник", translation: "джерело", gloss: "spring",
    forms: "წყაროს", rank: 1 },
];
catalogFormIndex = null;
words = [{ uuid: "u1", georgian: "კალათბურთს", translation: "баскетбол", tags: "", synced: true }];

// пошук: за словом, за будь-якою формою (першим), за перекладом
assert.deepStrictEqual(searchCatalog("წყ").map((e) => e.id), [3, 1], "підрядок — за частотністю");
assert.deepStrictEqual(searchCatalog("წყალს").map((e) => e.id), [1], "форма знаходить словникове слово");
assert.deepStrictEqual(searchCatalog("Вода").map((e) => e.id), [1]);
assert.deepStrictEqual(searchCatalog("წ"), [], "менше 2 символів — без довідника");

// уже вивчене слово впізнається навіть в іншій формі
assert.deepStrictEqual(wordsForEntry(catalog[1]).map((w) => w.uuid), ["u1"]);
assert.deepStrictEqual(wordsForEntry(catalog[0]), []);

// додавання: з тегами, а вдруге — без дубліката
addFromCatalog(catalog[0]);
assert.strictEqual(words.length, 2);
assert.strictEqual(words[0].georgian, "წყალი");
assert.strictEqual(words[0].tags, "іменник, довідник");
addFromCatalog(catalog[0]);
assert.strictEqual(words.length, 2, "повторне додавання не дублює");
addFromCatalog(catalog[1]);
assert.strictEqual(words.length, 2, "слово вже є в іншій формі — не додаємо");

// попередження при ручному додаванні іншої форми вже наявного слова
assert.deepStrictEqual(relatedWords("კალათბურთი").map((w) => w.uuid), ["u1"]);
assert.deepStrictEqual(relatedWords("წყლის").map((w) => w.georgian), ["წყალი"]);
assert.deepStrictEqual(relatedWords("წყალი"), [], "точний збіг перевіряється окремо");
assert.deepStrictEqual(relatedWords("ქალაქი"), []);

// той самий номер версії — довідник не перекачується
let fetched = false;
fetch = () => { fetched = true; return Promise.reject(new Error("offline")); };
catalogVersion = "3:2026-11-07 10:00:00";
refreshCatalog("3:2026-11-07 10:00:00");
refreshCatalog("");
assert.strictEqual(fetched, false);
refreshCatalog("4:2026-11-07 11:00:00");
assert.strictEqual(fetched, true, "нова версія — перекачуємо");
`);
