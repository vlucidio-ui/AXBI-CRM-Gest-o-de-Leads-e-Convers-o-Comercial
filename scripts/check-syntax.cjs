const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') && !entry.name.endsWith('.d.mts')) files.push(full);
  }
}
walk(process.cwd());
let failed = false;
for (const file of files) {
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX }
  });
  for (const d of result.diagnostics || []) {
    failed = true;
    process.stderr.write(`${file}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}\n`);
  }
}
if (failed) process.exit(1);
process.stdout.write(`Sintaxe TypeScript/TSX válida: ${files.length} arquivo(s).\n`);
