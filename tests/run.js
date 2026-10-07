// Minimal regression tests for the checker. Run: node tests/run.js
// Each case lists the error codes the checker must report (empty = must be clean).
require('../src/checker.js');
const fnSet = new Set(['writemessage', 'size', 'tostring', 'currentdate']);
const cases = [
  ['clean macro', 'Integer Index;\nInteger Total;\nFor Index from 1 to 3 :Sum\n   Total += Index;\nEndFor;\nTotal', []],
  ['For with = instead of from', 'Integer I;\nFor I = 1 to 3\n   Call WriteMessage("x");\nEndFor;\n1', ['E-FOR']],
  ['call without Call', 'WriteMessage("x");\n1', ['E-CALL']],
  ['last line ends with ;', 'Integer A = 1;\nA;', ['E-RETURN']],
  ['duplicate declaration', 'Integer A;\nString A;\nA', ['E-DUP']],
  ['no Boolean type', 'Boolean B;\nB', ['E-BOOL']],
  ['Break outside a loop', 'Break;\n1', ['E-BREAK']],
  ['Break without label', 'Integer I;\nFor I from 1 to 3\n   Break;\nEndFor;\n1', ['E-BREAK']],
  ['Break with label', 'Integer I;\nFor I from 1 to 3 : L1\n   Break L1;\nEndFor;\n1', []],
  ['semicolon after Then', 'Integer I;\nIf I < 2 Then;\n   I = 1;\nEndIf;\nI', ['E-EMPTY']],
  ['extra semicolons', 'Integer I;\nI = 2;;;\nI', ['E-EMPTY']],
  ['missing operator', 'String A = "a" "b";\nA', ['E-EXPR']],
  ['stray braces and empty parens', '[]\n{}\n()\n', ['E-EXPR', 'E-EXPR']],
  ['sub-vector is not a label', 'Vector Integer P = [2,3,5];\nVector Integer Q;\nInteger A = 1;\nInteger B = 2;\nQ = P[A:B];\nQ', []],
  ['For with by', 'Integer I;\nFor I from 10 to 1 by -1\n   Call WriteMessage(ToString(I));\nEndFor;\n1', []],
];
let failed = 0;
for (const [name, src, want] of cases) {
  const got = OPAL.check(src, { fnSet, globals: new Set() }).problems.filter(p => p.sev === 'error').map(p => p.code).sort();
  const ok = JSON.stringify(got) === JSON.stringify([...want].sort());
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (ok ? '' : `  expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`));
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
