// tools/gen-codex.mjs
//
// Phase 3 — 단계 1 (⚠️ ChatGPT 사용량 소모): 청크별로 `codex exec`를 호출해
// krMeaning + example + pos(품사)를 생성한다.
//
// ※ 이 스크립트는 사용자 ChatGPT 요금제의 사용량을 소모한다. 실행 전 사용자 확인 필수.
//
// 입력:  tools/out/chunks/<level>-NN.json   (prepare-source.mjs 산출물)
// 출력:  tools/out/gen/<level>-NN.json       (codex 원본 응답: [{id,jpKana,jpKanji,krMeaning,example,pos}])
//
// 사용법:
//   node tools/gen-codex.mjs <level> [--from N] [--to M] [--force] [--model NAME]
//   예) 파일럿 1청크:  node tools/gen-codex.mjs n3 --from 1 --to 1
//   예) 전체:          node tools/gen-codex.mjs n3
//
// 이미 생성된 청크는 건너뛴다(--force로 재생성). JSON이 깨지면 1회 재시도.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const level = (args[0] || '').toLowerCase();
function flag(name, def) {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
if (!['n3', 'n2', 'n1'].includes(level)) {
  console.error('usage: node tools/gen-codex.mjs <n3|n2|n1> [--from N] [--to M] [--force] [--model NAME]');
  process.exit(1);
}
const LEVEL_UPPER = level.toUpperCase();
const from = Number(flag('--from', 1));
const to = flag('--to', null);
const force = args.includes('--force');
const model = flag('--model', null);

const chunkDir = path.join('tools', 'out', 'chunks');
const genDir = path.join('tools', 'out', 'gen');
fs.mkdirSync(genDir, { recursive: true });

const schemaPath = path.join('tools', 'prompts', 'gen-schema.json');
const promptTemplate = fs
  .readFileSync(path.join('tools', 'prompts', 'gen.md'), 'utf8')
  .replaceAll('{{LEVEL_UPPER}}', LEVEL_UPPER)
  .replaceAll('{{LEVEL}}', level);

const chunkFiles = fs
  .readdirSync(chunkDir)
  .filter((f) => f.startsWith(`${level}-`) && f.endsWith('.json'))
  .sort();
if (!chunkFiles.length) { console.error(`no chunks for ${level} in ${chunkDir}`); process.exit(1); }

const toNum = to ? Number(to) : chunkFiles.length;

function runCodex(prompt) {
  const tmpOut = path.join(genDir, `.last-${process.pid}.txt`);
  const codexArgs = ['exec', '-s', 'read-only', '--skip-git-repo-check', '--output-schema', schemaPath, '-o', tmpOut];
  if (model) codexArgs.push('-m', String(model));
  codexArgs.push('-'); // read prompt from stdin
  const res = spawnSync('codex', codexArgs, {
    input: prompt,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`codex exited ${res.status}: ${(res.stderr || '').slice(0, 500)}`);
  }
  const raw = fs.existsSync(tmpOut) ? fs.readFileSync(tmpOut, 'utf8') : (res.stdout || '');
  try { fs.unlinkSync(tmpOut); } catch {}
  return raw;
}

function extractItems(raw) {
  let txt = String(raw).trim();
  // 코드펜스가 있으면 벗긴다
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) txt = fence[1].trim();
  let obj;
  try {
    obj = JSON.parse(txt);
  } catch {
    // 본문에서 첫 { ... } 또는 [ ... ] 추출 시도
    const m = txt.match(/[\[{][\s\S]*[\]}]/);
    if (!m) throw new Error('no JSON found in codex output');
    obj = JSON.parse(m[0]);
  }
  const items = Array.isArray(obj) ? obj : obj.items;
  if (!Array.isArray(items)) throw new Error('output has no items array');
  return items;
}

let ok = 0, skipped = 0, failed = 0;
const startAll = Date.now();

for (const file of chunkFiles) {
  const nn = file.replace(`${level}-`, '').replace('.json', '');
  const n = Number(nn);
  if (n < from || n > toNum) continue;

  const outPath = path.join(genDir, file);
  if (!force && fs.existsSync(outPath)) {
    console.log(`skip ${file} (already generated; --force to redo)`);
    skipped++;
    continue;
  }

  const chunk = JSON.parse(fs.readFileSync(path.join(chunkDir, file), 'utf8'));
  const prompt = `${promptTemplate}\n${JSON.stringify(chunk, null, 2)}\n`;

  let items = null;
  for (let attempt = 1; attempt <= 2 && !items; attempt++) {
    const t0 = Date.now();
    process.stdout.write(`gen ${file} (${chunk.length} words) attempt ${attempt}... `);
    try {
      const raw = runCodex(prompt);
      const got = extractItems(raw);
      if (got.length !== chunk.length) {
        throw new Error(`count mismatch: expected ${chunk.length}, got ${got.length}`);
      }
      items = got;
      console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      if (attempt === 2) failed++;
    }
  }

  if (items) {
    fs.writeFileSync(outPath, JSON.stringify(items, null, 2) + '\n', 'utf8');
    ok++;
  }
}

console.log(`\ndone in ${((Date.now() - startAll) / 1000).toFixed(1)}s — generated:${ok} skipped:${skipped} failed:${failed}`);
if (failed) process.exit(1);
