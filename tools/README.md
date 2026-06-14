# tools/ — N3·N2·N1 데이터 생성·검수 파이프라인

update.md §2-3·§2-4의 5단계 파이프라인을 구현한 스크립트 모음. 순수 정적 사이트 본체와 분리된 **데이터 준비 도구**다(브라우저에 로드되지 않음).

> ⚠️ `gen-codex.mjs`는 `codex exec`를 호출해 **사용자 ChatGPT 사용량을 소모**한다. 실행 전 반드시 확인.

## 데이터 소스

- elzup/jlpt-word-list (공개 JLPT 어휘, 영어 뜻 CSV)
  - N3: `https://raw.githubusercontent.com/elzup/jlpt-word-list/master/src/n3.csv`
  - 형식: `expression,reading,meaning,tags`
  - ※ な형용사는 어간형으로 실려 있고 영어 뜻도 명사형 → 품사 판별은 생성 프롬프트가 담당(§2-3).

## 단계별 실행 (예: N3)

```bash
# 0) 소스 정제: CSV → 중복 제거(하위 레벨 대비) → id 부여 → 50개 청크   [무료]
curl -sL <n3.csv URL> -o /tmp/n3.csv
node tools/prepare-source.mjs /tmp/n3.csv n3 10001
#   → tools/out/n3-source.json, tools/out/chunks/n3-NN.json

# 1) Codex 생성: krMeaning + example + pos               [⚠️ ChatGPT 사용량]
node tools/gen-codex.mjs n3 --from 1 --to 1   # 파일럿 1청크 먼저 권장
node tools/gen-codex.mjs n3                    # 전체(이미 생성된 청크는 건너뜀)
#   → tools/out/gen/n3-NN.json

# 2) 병합: 최종 스키마로 합침(na형용사 だ 보강)            [무료]
node tools/merge-gen.mjs n3 vocab-n3.js
#   생략 시 tools/out/vocab-n3.candidate.js 로 출력

# 3) 형식 검증(§8-3): 스키마·id·마커·길이·품사·중복         [무료·머지 게이트]
node tools/validate-vocab.js vocab-n3.js n3

# 4) 검수 리포트: 휴리스틱 플래그 + 무작위 표본 + 네이버 링크  [무료]
node tools/review-report.mjs vocab-n3.js n3 5
#   → tools/out/n3-review.md  (사람 확인용)
```

## 프롬프트

- `prompts/gen.md` — 생성 프롬프트(§8-1 규칙 인코딩). `{{LEVEL_UPPER}}`가 런타임에 치환됨.
- `prompts/gen-schema.json` — `codex exec --output-schema`용 구조화 출력 스키마.

## N3 진행 기록 (2026-06)

- 소스 2,139행 → 중복 제거 후 **2,061단어**(id 10001~12061), 50개씩 42청크.
- 생성: 파일럿 1청크 → 프롬프트 개선(동음이의어 주의·명사 vs な형용사 기본값·동사 마커 `【会い】ました` 스타일·です/ます체) → 재확인 5청크 → 전체 42청크.
- 검증: 0 errors / 21 warnings(짧은 예문). Claude 교차검수: 표본 102/103 정확, `至急` 오역 1건 수정.
- **딸림 메모(계획 대비 차이)**: §2-3의 *Codex 자체 검수(3단계)*는 이번에 생략하고, **결정적 검증 스크립트 + Claude 전수 교차검수**로 품질 게이트를 대체했다(사용량 절약). 필요 시 `gen-codex` 패턴으로 자체 검수 단계를 추가할 수 있다.
