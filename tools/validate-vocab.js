// tools/validate-vocab.js
//
// Phase 3 — 단계 2 (무료·결정적): 레벨별 단어장 파일을 형식 검증한다 (§8-3).
// 데이터 PR 머지 전 반드시 통과해야 하는 게이트. Codex/네트워크 호출 없음.
//
// 검사 항목:
//   - 스키마 고정: 정확히 {id, jpKana, jpKanji, krMeaning, note, example}
//   - id가 레벨 고정 범위 내 + 파일 내·전체 중복 없음
//   - jpKana 비어있지 않음
//   - example이 비어있지 않으면 【 】 마커 정확히 1쌍, 길이 10~20자 내외(경고)
//   - 하위 레벨과 jpKana+jpKanji 중복 없음 (だ/な 뗀 어간 기준 포함)
//   - 품사 일치: jpKana가 だ로 끝나면 krMeaning의 모든 의미도 "다"로 끝남
//   - note는 배포 전 빈 문자열이어야 함(검수 플래그 잔존 시 경고)
//
// 사용법:  node tools/validate-vocab.js <vocabFile> <level>
//   예) node tools/validate-vocab.js vocab-n3.js n3
//
// 종료 코드: ERROR가 하나라도 있으면 1, 아니면 0 (WARNING은 0).

'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const [, , vocabFile, levelArg] = process.argv;
if (!vocabFile || !levelArg) {
  console.error('usage: node tools/validate-vocab.js <vocabFile> <level>');
  process.exit(2);
}
const level = levelArg.toLowerCase();

const LEVELS = {
  n5n4: { file: 'vocab.js', name: 'VOCAB', range: [1, 1495] },
  n3: { file: 'vocab-n3.js', name: 'VOCAB_N3', range: [10001, 19999] },
  n2: { file: 'vocab-n2.js', name: 'VOCAB_N2', range: [20001, 29999] },
  n1: { file: 'vocab-n1.js', name: 'VOCAB_N1', range: [30001, 39999] },
};
const ORDER = ['n5n4', 'n3', 'n2', 'n1'];
if (!LEVELS[level]) { console.error(`unknown level: ${level}`); process.exit(2); }

const SCHEMA = ['id', 'jpKana', 'jpKanji', 'krMeaning', 'note', 'example'];

// だ送り仮名 부사·예외 — 사전형 표제어가 한자·가나 모두 だ로 끝나지만
// な형용사가 아니라서 뜻이 "-다"로 끝나지 않는다 (未だ=아직, 甚だ=몹시).
// 아래 kanaDa&&kanjiDa 품사 검사가 이들을 な형용사로 오탐하지 않도록 제외한다.
const DA_NOT_NA = new Set(['未だ', '甚だ']);

function loadConst(file, name) {
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const val = vm.runInNewContext(`${src}\n;${name};`, {}, { filename: file });
  return Array.isArray(val) ? val : [];
}

function stem(s) { return String(s || '').trim().replace(/[だな]$/u, ''); }
function dedupKey(kana, kanji) { return `${stem(kana)} ${stem(kanji)}`; }

const errors = [];
const warnings = [];
const E = (id, msg) => errors.push(`[ERROR] id=${id}: ${msg}`);
const W = (id, msg) => warnings.push(`[WARN ] id=${id}: ${msg}`);

// 대상 파일 로드
const { name, range: [idMin, idMax] } = LEVELS[level];
let list;
try {
  list = loadConst(vocabFile, name);
} catch (e) {
  console.error(`failed to load ${name} from ${vocabFile}: ${e.message}`);
  process.exit(2);
}
if (!list.length) { console.error(`${name} is empty or not found in ${vocabFile}`); process.exit(2); }

// 하위 레벨 중복 비교용 키
const lowerKeys = new Map(); // key -> id
for (const lv of ORDER) {
  if (lv === level) break;
  const arr = loadConst(LEVELS[lv].file, LEVELS[lv].name);
  for (const w of arr) lowerKeys.set(dedupKey(w.jpKana, w.jpKanji), w.id);
}

const seenIds = new Set();
const seenKeys = new Map(); // key -> id (파일 내 중복)

for (const w of list) {
  const id = w && w.id != null ? w.id : '?';

  // 스키마
  const keys = Object.keys(w);
  const missing = SCHEMA.filter((k) => !(k in w));
  const extra = keys.filter((k) => !SCHEMA.includes(k));
  if (missing.length) E(id, `missing fields: ${missing.join(', ')}`);
  if (extra.length) E(id, `unexpected fields: ${extra.join(', ')}`);

  // id 범위·중복
  if (typeof w.id !== 'number' || !Number.isInteger(w.id)) E(id, `id must be integer`);
  else {
    if (w.id < idMin || w.id > idMax) E(id, `id out of range ${idMin}~${idMax}`);
    if (seenIds.has(w.id)) E(id, `duplicate id within file`);
    seenIds.add(w.id);
  }

  // jpKana
  if (!w.jpKana || !String(w.jpKana).trim()) E(id, `jpKana is empty`);

  // krMeaning
  if (!w.krMeaning || !String(w.krMeaning).trim()) E(id, `krMeaning is empty`);

  // note (배포 전 비어야 함)
  if (w.note && String(w.note).trim()) W(id, `note not empty: "${w.note}"`);

  // 품사 일치: な형용사는 jpKana·jpKanji 둘 다 だ로 끝나는 형태로 저장된다(有名だ / ゆうめいだ).
  // 涙(なみだ)·肌(はだ)·管(くだ)·ただ 처럼 읽기만 だ로 끝나는 명사·부사를 오탐하지 않도록
  // 한자형도 함께 だ로 끝날 때만 품사 검사를 적용한다. (한자가 없는 가나 전용 な형용사는
  // 형태만으로 구분이 불가능하므로 이 기계 검사 대상에서 빠지고, Claude 교차검수가 담당한다.)
  const kanaDa = /だ$/u.test(String(w.jpKana || '').trim());
  const kanjiDa = /だ$/u.test(String(w.jpKanji || '').trim());
  if (kanaDa && kanjiDa && w.krMeaning && !DA_NOT_NA.has(String(w.jpKanji || '').trim())) {
    const senses = String(w.krMeaning).split('. ').map((s) => s.trim()).filter(Boolean);
    const bad = senses.filter((s) => !/다$/u.test(s));
    if (bad.length) E(id, `na-adjective(だ) but meaning not all "-다": ${bad.join(' / ')}`);
  }

  // example 마커·길이
  const ex = w.example != null ? String(w.example) : '';
  if (ex.trim()) {
    const open = (ex.match(/【/g) || []).length;
    const close = (ex.match(/】/g) || []).length;
    if (open !== 1 || close !== 1) {
      E(id, `example must have exactly one 【 】 pair (got 【×${open} 】×${close})`);
    } else if (ex.indexOf('【') > ex.indexOf('】')) {
      E(id, `example 】 appears before 【`);
    } else {
      const inner = ex.slice(ex.indexOf('【') + 1, ex.indexOf('】'));
      if (!inner.trim()) E(id, `example marker 【】 is empty`);
    }
    const visibleLen = ex.replace(/[【】]/g, '').length;
    if (visibleLen < 8 || visibleLen > 28) {
      W(id, `example length ${visibleLen} outside 10~20자 내외 ("${ex}")`);
    }
  }

  // 중복 (하위 레벨 + 파일 내)
  if (w.jpKana) {
    const key = dedupKey(w.jpKana, w.jpKanji);
    if (lowerKeys.has(key)) E(id, `duplicate of lower-level word (id=${lowerKeys.get(key)}): ${w.jpKana} ${w.jpKanji}`);
    if (seenKeys.has(key)) E(id, `duplicate within file (id=${seenKeys.get(key)}): ${w.jpKana} ${w.jpKanji}`);
    seenKeys.set(key, w.id);
  }
}

// 리포트
console.log(`validated ${list.length} ${name} entries from ${path.basename(vocabFile)} (level ${level})`);
console.log(`  errors: ${errors.length}, warnings: ${warnings.length}`);
for (const m of errors) console.log(m);
for (const m of warnings) console.log(m);
process.exit(errors.length ? 1 : 0);
