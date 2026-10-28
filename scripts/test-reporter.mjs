// The plain-text reporter of scripts/run-tests.mjs: ASCII only, so it reads the same on any terminal.
// Compact (the default): every test on one line, [PASS] or [FAIL], under its suite, then the list of failing
// tests and a RESULT line. With TESTS_DETAILS=1 (the runner's --details), the failure message is printed under
// each failing test. Exit code 1 when anything fails (Node sets it; the reporter only prints).

const DETAILS = process.env.TESTS_DETAILS === "1";
const COLOR = process.stdout.isTTY && process.env.TESTS_NO_COLOR !== "1";
const SUITE = process.env.TESTS_SUITE ?? "";
const paint = (code, text) => (COLOR ? `\u001b[${code}m${text}\u001b[0m` : text);
const green = (text) => paint(32, text);
const red = (text) => paint(31, text);
const dim = (text) => paint(2, text);

export default async function* reporter(source) {
  let passed = 0; let failed = 0; let skipped = 0;
  const failures = [];
  let suite = "?";
  for await (const event of source) {
    const { type, data } = event;
    if (type === "test:start" && data.nesting === 0) { suite = data.name; yield `\n${data.name}\n`; }
    if (type === "test:pass" && data.nesting > 0) {
      if (data.skip || data.todo) { skipped += 1; yield `  [SKIP] ${data.name}\n`; }
      else { passed += 1; yield `  ${green("[PASS]")} ${data.name}\n`; }
    }
    if (type === "test:fail" && data.nesting > 0) {
      failed += 1;
      const error = data.details?.error;
      const cause = error?.cause ?? error;
      const message = String(cause?.message ?? error?.message ?? "failed");
      failures.push({ suite, name: data.name, file: data.file ? data.file.replace(/^.*\/scripts\//, "scripts/") : "?", line: data.line ?? "?" });
      yield `  ${red("[FAIL]")} ${data.name}\n`;
      if (DETAILS) yield `${message.split("\n").map((line) => `         ${line}`).join("\n")}\n`;
    }
    if (type === "test:stderr" || type === "test:stdout") {
      const text = String(data.message).trim();
      if (text && !/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module|add "type": "module"|--trace-warnings/.test(text)) yield `         ${text}\n`;
    }
  }
  yield `\n${"-".repeat(76)}\n`;
  if (failures.length) {
    yield "FAILED TESTS:\n";
    let group = null;
    for (const failure of failures) {
      if (failure.suite !== group) { group = failure.suite; yield `  ${group}\n`; }
      yield `    - ${failure.name}  ${dim(`(${failure.file}:${failure.line})`)}\n`;
    }
    yield "\n";
  }
  const verdict = failed ? red("FAIL") : green("ALL TESTS PASS");
  yield `RESULT: ${passed + failed + skipped} tests, ${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ""}  ->  ${verdict}\n`;
  yield "\n";
  yield dim(`Options: npm run test:${SUITE || "<games|missions>"} -- --details   (why each failing test fails)\n`);
  yield dim(`         npm run test:${SUITE || "<games|missions>"} -- --only=<file>   (one test file only: ${SUITE === "games" ? "airways, n-back, circuits..." : "layout, generator, modules, wiring"})\n`);
  yield dim("         --no-color   (plain text)   --help\n");
}
