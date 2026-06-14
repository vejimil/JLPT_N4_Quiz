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

## 접사·조수사(～) 제외

`prepare-source.mjs`는 표제어/읽기에 `~`/`〜`/`～`가 든 항목(접두사·접미사·조수사)을 자동 제외한다. 단독 단어가 아니라 단어→뜻 퀴즈에 부적합하기 때문(語形成 모드는 Phase 4 backlog). 출력의 `dropped (affix/counter ～)` 통계로 확인.

## 진행 기록 (2026-06)

**N3** — 소스 2,139행 → 중복·접사 제거 후 **2,058단어**(id 10001~12061, 결번 일부), 42청크.
- 생성: 파일럿 1청크 → 프롬프트 개선(동음이의어 주의·명사 vs な형용사 기본값·동사 마커 `【会い】ました` 스타일·です/ます체) → 재확인 5청크 → 전체.
- 검증 0 errors / 21 warnings(짧은 예문). 교차검수: 표본 102/103 정확, `至急` 오역 수정. 접사 3건은 사후 제거.

**N2** — 소스 1,747행 → 중복 27 + 접사 165 제거 후 **1,555단어**(id 20001~21556, `×` 1건 제거 결번), 32청크.
- 프롬프트 그대로 재사용(개선 불필요). 검증 0 errors / 3 warnings. 교차검수: 표본 거의 전부 정확, `田ぼ→田んぼ` 수정·`×`(깨진 가나) 제거.

**N1** — 소스 2,698행 → 중복 10 + 접사 36 제거 후 **2,653단어**(id 30001~32653, 결번 없음), 54청크.
- 프롬프트 그대로 재사용. 검증 0 errors / 10 warnings(짧은 예문). 교차검수: 동음이의 66그룹 전수(4중 동음이의 `施行/思考/志向/嗜好`까지 정확) + 무작위 표본 133개, `興業`(흥행→흥업·예문 교체)·`ガレージ`(영어 잔존) 2건 수정.
- だ送り仮名 부사 `未だ`·`甚だ`가 품사 검사 오탐 → `validate-vocab.js`에 `DA_NOT_NA` 예외 추가(회귀 0 errors).

**딸림 메모(계획 대비 차이)**: §2-3의 *Codex 자체 검수(3단계)*는 생략하고 **결정적 검증 스크립트 + Claude 전수 교차검수**로 품질 게이트를 대체(사용량 절약). 필요 시 `gen-codex` 패턴으로 자체 검수를 추가 가능.

## 토큰 사용량 (참고)

호출당 ~18k 토큰(50단어 청크). N3 43회 ≈ 78.6만, N2 39회 ≈ 비슷. 정확한 ChatGPT 플랜 잔여량은 계정에서 확인.
