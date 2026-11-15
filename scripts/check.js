// Build step: there is nothing to compile, so this only checks that every JavaScript file parses.
// AI-assisted: written with Claude Code (Anthropic).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.js')) files.push(full);
  }
}
// folders left out of a deployment (for example tests/) are simply skipped
for (const dir of ['api', 'src', 'scripts', 'tests', path.join('public', 'js')]) if (existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });
console.log(`Checked ${files.length} JavaScript files: all parse.`);
