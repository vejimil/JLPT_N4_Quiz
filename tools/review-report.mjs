// tools/review-report.mjs
//
// Phase 3 — 단계 4~5 보조: Claude 교차검수/사람 확인용 리포트 생성 (무료·결정적).
// 휴리스틱으로 의심 항목을 플래그하고, 무작위 표본을 뽑아 마크다운 표로 출력한다.
// 네이버 일본어사전 검색 링크를 함께 단다 (※ 링크 제공만, 자동 수집 금지 — §2-4).
//
// 플래그 종류:
//   MARKER   : example의 【】 안 텍스트가 jpKanji/jpKana와 한 글자도 안 겹침(엉뚱한 단어를 감쌌을 가능성)
//   ASCII    : krMeaning에 영문자 잔존(미번역 의심)
//   LONG     : krMeaning이 과도하게 김(>30자)
//   DUPMEAN  : 서로 다른 단어가 완전히 같은 krMeaning(혼동·중복 의심)
//   SHORTEX  : example 가시 길이 < 8 (억지/짧은 예문 의심)
//   NOEX     : example 빈 값 (文脈規定 출제 제외 대상 — 정보용)
//
// 사용법:  node tools/review-report.mjs <vocabFile> <level> [samplePct]
//   예) node tools/review-report.mjs tools/out/vocab-n3.candidate.js n3 5

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const [, , vocabFile, levelArg, samplePctArg] = process.argv;
if (!vocabFile || !levelArg) {
  console.error('usage: node tools/review-report.mjs <vocabFile> <level> [samplePct]');
  process.exit(1);
}
const level = levelArg.toLowerCase();
const CONST = `VOCAB_${level.toUpperCase()}`;
const samplePct = Number(samplePctArg || 5);

const src = fs.readFileSync(vocabFile, 'utf8');
const list = vm.runInNewContext(`${src}\n;${CONST};`, {}, { filename: vocabFile });

const naverLink = (w) => {
  // な형용사는 だ를 뗀 어간으로 검색(사전 표제어가 어간형)
  const q = (w.jpKanji || w.jpKana || '').replace(/だ$/u, '') || w.jpKana.replace(/だ$/u, '');
  return `https://ja.dict.naver.com/#/search?query=${encodeURIComponent(q)}`;
};

function markerInner(ex) {
  const m = String(ex || '').match(/【([^】]*)】/);
  return m ? m[1] : null;
}
function shareChar(a, b) {
  const setB = new Set([...String(b || '')]);
  for (const ch of String(a || '')) if (setB.has(ch)) return true;
  return false;
}

// 같은 krMeaning을 가진 단어 그룹
const meaningMap = new Map();
for (const w of list) {
  const k = String(w.krMeaning || '').trim();
  if (!meaningMap.has(k)) meaningMap.set(k, []);
  meaningMap.get(k).push(w.id);
}

const flags = []; // {id, reasons:[...]}
for (const w of list) {
  const reasons = [];
  const ex = String(w.example || '').trim();
  const inner = markerInner(ex);

  if (ex && inner != null) {
    const target = `${w.jpKanji || ''}${w.jpKana || ''}`.replace(/だ/gu, '');
    if (inner && !shareChar(inner, target)) reasons.push('MARKER');
  }
  if (/[A-Za-z]/.test(w.krMeaning || '')) reasons.push('ASCII');
  if ((w.krMeaning || '').length > 30) reasons.push('LONG');
  if (meaningMap.get(String(w.krMeaning || '').trim()).length > 1) reasons.push('DUPMEAN');
  if (ex) {
    const vis = ex.replace(/[【】]/g, '').length;
    if (vis < 8) reasons.push('SHORTEX');
  } else {
    reasons.push('NOEX');
  }
  if (reasons.length) flags.push({ w, reasons });
}

// 무작위 표본(결정적: id 기반 해시 정렬)
function hash(n) { let x = (n * 2654435761) >>> 0; x ^= x >>> 13; return x >>> 0; }
const sampleN = Math.max(10, Math.round((list.length * samplePct) / 100));
const sample = [...list].sort((a, b) => hash(a.id) - hash(b.id)).slice(0, sampleN);

// 리포트
const lines = [];
lines.push(`# ${level.toUpperCase()} 데이터 검수 리포트`);
lines.push('');
lines.push(`- 총 ${list.length}개 (id ${list[0].id}~${list[list.length - 1].id})`);
lines.push(`- 플래그: ${flags.length}개`);
const byReason = {};
for (const f of flags) for (const r of f.reasons) byReason[r] = (byReason[r] || 0) + 1;
lines.push(`- 플래그 내역: ${Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(', ') || '없음'}`);
lines.push('');
lines.push('> 네이버 사전 링크는 사람이 직접 대조용입니다. AI가 사전에 접속해 검증한 것이 아니며, 자동 수집(스크래핑)은 하지 않습니다.');
lines.push('');

lines.push('## 플래그 항목 (NOEX/SHORTEX/DUPMEAN 제외한 우선 검토)');
lines.push('');
lines.push('| id | 단어 | 뜻 | 예문 | 플래그 | 사전 |');
lines.push('|---|---|---|---|---|---|');
for (const { w, reasons } of flags) {
  const prio = reasons.filter((r) => r !== 'NOEX' && r !== 'SHORTEX' && r !== 'DUPMEAN');
  if (!prio.length) continue;
  lines.push(`| ${w.id} | ${w.jpKanji || ''}(${w.jpKana}) | ${w.krMeaning} | ${w.example || ''} | ${reasons.join(',')} | [🔎](${naverLink(w)}) |`);
}
lines.push('');

lines.push('## 짧은 예문 / 빈 예문 / 중복 뜻 (참고)');
lines.push('');
lines.push('| id | 단어 | 뜻 | 예문 | 플래그 |');
lines.push('|---|---|---|---|---|');
for (const { w, reasons } of flags) {
  const only = reasons.filter((r) => r === 'NOEX' || r === 'SHORTEX' || r === 'DUPMEAN');
  if (!only.length || reasons.some((r) => r !== 'NOEX' && r !== 'SHORTEX' && r !== 'DUPMEAN')) continue;
  lines.push(`| ${w.id} | ${w.jpKanji || ''}(${w.jpKana}) | ${w.krMeaning} | ${w.example || ''} | ${only.join(',')} |`);
}
lines.push('');

lines.push(`## 무작위 표본 (${sample.length}개, ${samplePct}%)`);
lines.push('');
lines.push('| id | 단어 | 뜻 | 예문 | 사전 |');
lines.push('|---|---|---|---|---|');
for (const w of sample) {
  lines.push(`| ${w.id} | ${w.jpKanji || ''}(${w.jpKana}) | ${w.krMeaning} | ${w.example || ''} | [🔎](${naverLink(w)}) |`);
}
lines.push('');

const outPath = path.join('tools', 'out', `${level}-review.md`);
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`flags: ${flags.length} (${Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(', ')})`);
console.log(`sample: ${sample.length}`);
console.log(`wrote ${outPath}`);
