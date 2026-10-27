// A plain-text reporter for the game logic tests: ASCII only, so it reads the same on any terminal.
//   node --test --test-reporter=./scripts/games/reporter.mjs "scripts/games/*.test.mjs"
// One line per test ([PASS] / [FAIL]), grouped under their suite, the failure message under a failing test, and a
// RESULT line at the end. Exit code 1 when anything fails (Node sets it; the reporter only prints).

const COLOR = process.stdout.isTTY && !process.argv.includes("--no-color");
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);

export default async function* reporter(source) {
  let passed = 0; let failed = 0; let skipped = 0;
  const failures = [];
  for await (const event of source) {
    const { type, data } = event;
    if (type === "test:start" && data.nesting === 0) yield `\n${data.name}\n`;
    if (type === "test:pass" && data.nesting > 0) {
      if (data.skip || data.todo) { skipped += 1; yield `  [SKIP] ${data.name}\n`; }
      else { passed += 1; yield `  ${paint(32, "[PASS]")} ${data.name}\n`; }
    }
    if (type === "test:fail" && data.nesting > 0) {
      failed += 1;
      const error = data.details?.error;
      const cause = error?.cause ?? error;
      const message = String(cause?.message ?? error?.message ?? "failed").split("\n").map((line) => `         ${line}`).join("\n");
      failures.push(`${data.name} (${data.file ? data.file.replace(/^.*\/scripts\//, "scripts/") : "?"}:${data.line ?? "?"})`);
      yield `  ${paint(31, "[FAIL]")} ${data.name}\n${message}\n`;
    }
    if (type === "test:stderr" || type === "test:stdout") {
      const text = String(data.message).trim();
      if (text && !/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|add "type": "module"|--trace-warnings/.test(text)) yield `         ${text}\n`;
    }
  }
  const total = passed + failed + skipped;
  yield `\n${"-".repeat(60)}\n`;
  if (failures.length) yield `FAILED TESTS:\n${failures.map((entry) => `  - ${entry}`).join("\n")}\n\n`;
  yield `RESULT: ${total} tests, ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}  ->  ${failed ? paint(31, "FAIL") : paint(32, "ALL TESTS PASS")}\n`;
}
