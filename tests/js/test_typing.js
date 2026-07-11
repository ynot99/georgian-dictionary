"use strict";
const { runInAppContext } = require("./_harness");

runInAppContext(`
const assert = require("assert");

// точний збіг, регістр, пробіли
assert.ok(checkAnswer("вода", "вода"));
assert.ok(checkAnswer("  Вода ", "вода"));
assert.ok(checkAnswer("გამარჯობა", "გამარჯობა"));

// варіанти через кому: будь-який зараховується
assert.ok(checkAnswer("дякую", "дякую, спасибі"));
assert.ok(checkAnswer("спасибі", "дякую, спасибі"));
assert.ok(checkAnswer("дякую, спасибі", "дякую, спасибі"));
assert.ok(!checkAnswer("будь ласка", "дякую, спасибі"));

// дужки необов'язкові
assert.ok(checkAnswer("вода", "вода (water)"));
assert.ok(checkAnswer("тигр", "тигр (з казки)"));

// розділові знаки ігноруються
assert.ok(checkAnswer("добре гаразд", "добре, гаразд!"));

// одна одруківка прощається для слів від 5 літер
assert.ok(checkAnswer("гамарджоба", "гамарджоба"));
assert.ok(checkAnswer("спасибя", "спасибі"), "заміна літери");
assert.ok(checkAnswer("спасиб", "спасибі"), "пропуск літери");
assert.ok(checkAnswer("спасибіі", "спасибі"), "зайва літера");
assert.ok(!checkAnswer("спасибяя", "спасибі"), "дві одруківки — не прощається");

// коротким словам одруківки не прощаються
assert.ok(!checkAnswer("вода", "воля"));
assert.ok(!checkAnswer("так", "тик"));

// порожній ввід — не зараховується
assert.ok(!checkAnswer("", "вода"));
assert.ok(!checkAnswer("   ", "вода"));

// нормалізація
assert.strictEqual(normAnswer("Вода, (water)!  "), "вода");
assert.deepStrictEqual(answerVariants("дякую, спасибі"), ["дякую спасибі", "дякую", "спасибі"]);

// відстань Левенштейна (одна одруківка)
assert.ok(within1Edit("абвгд", "абвгд"));
assert.ok(within1Edit("абвгд", "абвгж"));
assert.ok(within1Edit("абвгд", "абвг"));
assert.ok(!within1Edit("абвгд", "абгвд2х"));
assert.ok(!within1Edit("абвгд", "вгдаб"));

// строгий режим: одруківки не прощаються, точний збіг досі зараховується
assert.strictEqual(reviewStrict, false, "за замовчуванням строгий режим вимкнений");
assert.ok(checkAnswer("спасибя", "спасибі"), "звичайний режим досі прощає одруківку");
reviewStrict = true;
assert.ok(!checkAnswer("спасибя", "спасибі"), "у строгому режимі одруківка не прощається");
assert.ok(checkAnswer("спасибі", "спасибі"), "точний збіг зараховується і в строгому режимі");
assert.ok(checkAnswer("вода", "вода (water)"), "дужки досі ігноруються в строгому режимі");
reviewStrict = false;

// findConfusedWord: неправильна відповідь, що збігається з відповіддю ІНШОГО слова
words = [
  { uuid: "w1", georgian: "ლომი", translation: "лев", example: "", created_at: "2026-07-01 10:00:00", synced: true },
  { uuid: "w2", georgian: "ვეფხვი", translation: "тигр", example: "", created_at: "2026-07-01 10:00:00", synced: true },
];
// ka2uk: показано "ლომი", написав "тигр" (переклад іншого слова w2) -> знайдено w2
let confused = findConfusedWord("тигр", "ka2uk", "w1");
assert.strictEqual(confused && confused.uuid, "w2", "тигр -> має знайти w2 (тигр)");
assert.strictEqual(confusionLabel(confused, "ka2uk"), "ვეფხვი", "показуємо грузинське слово того, з ким сплутав");

// uk2ka: показано "лев", написав "ვეფხვი" (грузинське написання іншого слова) -> знайдено w2
confused = findConfusedWord("ვეფხვი", "uk2ka", "w1");
assert.strictEqual(confused && confused.uuid, "w2");
assert.strictEqual(confusionLabel(confused, "uk2ka"), "тигр", "показуємо переклад того, з ким сплутав");

// правильна відповідь для того самого слова -> не "плутанина" (excludeUuid відсікає)
assert.strictEqual(findConfusedWord("лев", "ka2uk", "w1"), null, "відповідь власного слова не рахується плутаниною");

// просто неправильна відповідь, що нічого не збігається -> null
assert.strictEqual(findConfusedWord("слон", "ka2uk", "w1"), null, "випадкова помилка без збігу -> немає плутанини");

console.log("ВСЕ OK: перевірка надрукованої відповіді коректна");
`);
