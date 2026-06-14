// tools/merge-gen.mjs
//
// Phase 3 — Codex 생성 청크(tools/out/gen/<level>-NN.json)를 최종 스키마로 병합한다.
// 무료·결정적. Codex/네트워크 호출 없음.
//
//   - pos:"na"이면 jpKana/jpKanji 끝에 だ 보강(Codex 누락 대비), pos 필드는 버림
//   - 최종 스키마 {id, jpKana, jpKanji, krMeaning, note:"", example}로 정렬(id 오름차순)
//   - note는 빈 문자열로 초기화(검수 플래그는 merge-review 단계에서 기입)
//
// 사용법:  node tools/merge-gen.mjs <level> [outFile]
//   기본 outFile: tools/out/vocab-<level>.candidate.js  (const VOCAB_<LEVEL>)

import fs from 'node:fs';
import path from 'node:path';

const level = (process.argv[2] || '').toLowerCase();
if (!['n3', 'n2', 'n1'].includes(level)) {
  console.error('usage: node tools/merge-gen.mjs <n3|n2|n1> [outFile]');
  process.exit(1);
}
const CONST = `VOCAB_${level.toUpperCase()}`;
const outFile = process.argv[3] || path.join('tools', 'out', `vocab-${level}.candidate.js`);

const genDir = path.join('tools', 'out', 'gen');
const files = fs
  .readdirSync(genDir)
  .filter((f) => f.startsWith(`${level}-`) && f.endsWith('.json'))
  .sort();
if (!files.length) { console.error(`no gen chunks for ${level} in ${genDir}`); process.exit(1); }

let merged = [];
for (const f of files) {
  const items = JSON.parse(fs.readFileSync(path.join(genDir, f), 'utf8'));
  merged = merged.concat(items);
}

const out = merged.map((x) => {
  let kana = String(x.jpKana || '').trim();
  let kanji = String(x.jpKanji || '').trim();
  if (x.pos === 'na') {
    if (kana && !/だ$/u.test(kana)) kana += 'だ';
    if (kanji && !/だ$/u.test(kanji)) kanji += 'だ';
  }
  return {
    id: x.id,
    jpKana: kana,
    jpKanji: kanji,
    krMeaning: String(x.krMeaning || '').trim(),
    note: '',
    example: String(x.example || '').trim(),
  };
});

out.sort((a, b) => a.id - b.id);

const header =
  `// ${path.basename(outFile)} — JLPT ${level.toUpperCase()} 단어장 (Codex 생성 → 검수 파이프라인 산출물)\n` +
  `// id 범위: ${level === 'n3' ? '10001~19999' : level === 'n2' ? '20001~29999' : '30001~39999'} (배포된 id는 변경·재사용 금지)\n` +
  `// 생성 청크 ${files.length}개 병합, 총 ${out.length}개\n\n`;

// 기존 vocab.js와 같은 객체 리터럴 스타일(키 따옴표 없음, 후행 콤마)로 직렬화
const s = (v) => JSON.stringify(v); // 문자열 이스케이프 재사용
const body = out
  .map(
    (w) =>
      `  {\n` +
      `    id: ${w.id},\n` +
      `    jpKana: ${s(w.jpKana)},\n` +
      `    jpKanji: ${s(w.jpKanji)},\n` +
      `    krMeaning: ${s(w.krMeaning)},\n` +
      `    note: ${s(w.note)},\n` +
      `    example: ${s(w.example)},\n` +
      `  },`
  )
  .join('\n');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, `${header}const ${CONST} = [\n${body}\n];\n`, 'utf8');

const naCount = merged.filter((x) => x.pos === 'na').length;
const emptyEx = out.filter((x) => !x.example).length;
console.log(`merged ${files.length} chunk(s) -> ${out.length} entries`);
console.log(`  na-adjectives: ${naCount}, empty examples: ${emptyEx}`);
console.log(`  id range: ${out[0].id}~${out[out.length - 1].id}`);
console.log(`wrote ${outFile}`);
