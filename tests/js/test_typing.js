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

console.log("ВСЕ OK: перевірка надрукованої відповіді коректна");
`);
