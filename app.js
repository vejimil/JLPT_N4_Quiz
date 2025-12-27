// app.js

// ===== 언어 설정 =====
const LANGS = {
  ja: {
    code: "ja",
    title: "JLPT N4 일본어 단어 퀴즈",
    characterName: "니혼고래 🐋",
    initialMessage: "일본어 바다로 떠나볼까?",
    storageKey: "nihongorae-jlpt-n4-v1",
  },
  fr: {
    code: "fr",
    title: "프랑스어 단어 퀴즈",
    characterName: "프랑새 🐦",
    initialMessage: "프랑스어 숲으로 날아가볼까?",
    storageKey: "prangsae-fr-v1",
  },
  es: {
    code: "es",
    title: "스페인어 단어 퀴즈",
    characterName: "에스파냐옹 🐱",
    initialMessage: "스페인어 산으로 뛰어가볼까?",
    storageKey: "espanyao-es-v1",
  },
};

// 현재 선택된 언어 (기본값: 일본어)
let currentLang = "ja";

// ===== 상태 =====
let state = {
  language: "ja",          // ★ 추가
  mode: "krToJp",          // 이제 실제 출제는 랜덤 모드지만, 상태값은 남겨둠
  questionCount: 50,
  questions: [],
  currentIndex: 0,
  score: 0,
  selectedChoiceIndex: null,
  currentCorrectIndex: null,
  thisExamWrong: [],
};

// ===== 헬퍼: 현재 언어의 저장 키 =====
function getStorageKey() {
  const cfg = LANGS[currentLang] || LANGS.ja;
  return cfg.storageKey;
}

// ===== 헬퍼: 현재 언어의 단어 리스트 =====
function getCurrentVocab() {
  // 프랑스어 모드
  if (currentLang === "fr") {
    if (typeof VOCAB_FR !== "undefined" && Array.isArray(VOCAB_FR)) {
      return VOCAB_FR;
    }
    return [];
  }

  // 스페인어 모드
  if (currentLang === "es") {
    if (typeof VOCAB_ES !== "undefined" && Array.isArray(VOCAB_ES)) {
      return VOCAB_ES;
    }
    return [];
  }

  // 기본: 일본어 VOCAB 사용
  if (typeof VOCAB !== "undefined" && Array.isArray(VOCAB)) {
    return VOCAB;
  }
  return [];
}


let globalStats = {
  totalQuestions: 0,
  totalCorrect: 0,
  wrongWordIds: [], // 전체 오답 단어 id 모음
};

// ===== 로컬스토리지 =====
function loadGlobalStats() {
  try {
    const key = getStorageKey();
    const raw = localStorage.getItem(key);

    const base = {
      totalQuestions: 0,
      totalCorrect: 0,
      wrongWordIds: [],
    };

    if (!raw) {
      // 저장된 기록이 없으면 기본값으로 초기화
      globalStats = base;
      return;
    }

    const parsed = JSON.parse(raw);

    globalStats = {
      ...base,
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      wrongWordIds:
        parsed && Array.isArray(parsed.wrongWordIds)
          ? parsed.wrongWordIds
          : [],
    };
  } catch (e) {
    console.error("통계 불러오기 오류", e);
    globalStats = {
      totalQuestions: 0,
      totalCorrect: 0,
      wrongWordIds: [],
    };
  }
}


function saveGlobalStats() {
  try {
    const key = getStorageKey();            // ★ 수정
    localStorage.setItem(key, JSON.stringify(globalStats));
  } catch (e) {
    console.error("save stats error", e);
  }
}

// ===== 니혼고래 레벨 계산 =====
// 예시: 50문제 맞출 때마다 레벨 +1
function calcLevel(totalCorrect) {
  return Math.floor(totalCorrect / 50) + 1;
}

// 경험치 바: 다음 레벨까지 비율
function calcXpRatio(totalCorrect) {
  const within = totalCorrect % 100;
  return within / 100;
}

// ===== 언어별 레벨 메시지 =====
const LEVEL_MESSAGES = {
  ja: {
    1: "기초 단어부터 천천히 같이 가보자!",
    3: "꽤 열심히 하고 있네? 더 깊은 일본어 바다로~",
    6: "니혼고래가 진화했다! JLPT가 보여!",
    max: "전설의 고래… 일본어 바다의 지배자?!"
  },
  fr: {
    1: "기초부터 차근차근! 프랑새와 함께 날아보자!",
    3: "점점 더 높이 나는 중! 발음도 감 잡혔어!",
    6: "프랑새가 진화했다! 불어 숲의 정복자?",
    max: "전설의 조류… 프랑스어 왕!"
  },
  es: {
    1: "Hola! 기초부터 천천히 시작해볼까?",
    3: "단어력이 꽤 올랐어! 에스파냐옹도 신났어!",
    6: "¡Increíble! 스페인어가 입에 붙기 시작했어!",
    max: "전설의 고양이… 스페인어 산의 지배자!"
  }
};


function updateCharacterPanel() {
  const levelSpan = document.getElementById("whale-level");
  const xpFill = document.getElementById("xp-fill");
  const msgEl = document.getElementById("whale-message");

  const level = calcLevel(globalStats.totalCorrect);
  const ratio = calcXpRatio(globalStats.totalCorrect);

  levelSpan.textContent = level;
  xpFill.style.width = `${Math.round(ratio * 100)}%`;

  const msgPack = LEVEL_MESSAGES[currentLang];

  if (!msgPack) {
    msgEl.textContent = "";
    return;
  }

  if (level === 1) msgEl.textContent = msgPack[1];
  else if (level <= 3) msgEl.textContent = msgPack[3];
  else if (level <= 6) msgEl.textContent = msgPack[6];
  else msgEl.textContent = msgPack.max;
}

// ===== 유틸 =====
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getUniqueWrongWords() {
  const vocab = getCurrentVocab(); // ★ 현재 언어의 단어 목록
  const set = new Set(globalStats.wrongWordIds);
  return vocab.filter((w) => set.has(w.id));
}

function getWordById(id) {
  const vocab = getCurrentVocab();
  return vocab.find((w) => w.id === id);
}

// 정답 체크 후, 각 보기 버튼에 추가 정보를 붙이기 위한 함수
function buildChoiceLabelAfterAnswer(word, mode, baseText) {
  if (!word) return baseText;

  const hasKanji = word.jpKanji && word.jpKanji !== "(한자 없음)";
  const kana = word.jpKana;
  const kr = word.krMeaning;

  const extraParts = [];

  switch (mode) {
    // ===== 일본어 모드들 =====
    case "krToJp":
      if (kr) extraParts.push(`뜻: ${kr}`);
      break;

    case "jpToKr":
      if (hasKanji && kana) {
        extraParts.push(`${word.jpKanji}（${kana}）`);
      } else if (kana) {
        extraParts.push(`(${kana})`);
      }
      break;

    case "kanjiToKana":
      if (hasKanji) extraParts.push(`한자: ${word.jpKanji}`);
      if (kr) extraParts.push(`뜻: ${kr}`);
      break;

    case "kanaToKanji":
      if (kana) extraParts.push(`읽기: ${kana}`);
      if (kr) extraParts.push(`뜻: ${kr}`);
      break;

    // ===== 프랑스어 모드들 =====
    // - 영어 → 프랑스(enToFr): 각 보기의 영어 뜻만 추가
    // - 프랑스 → 영어(frToEn): 각 보기의 프랑스어만 추가
    case "enToFr":
      if (word.en) extraParts.push(`뜻: ${word.en}`);
      break;

    case "frToEn":
      if (word.fr) extraParts.push(`뜻: ${word.fr}`);
      break;

    // ===== 스페인어 모드들 =====
    // - 영어 → 스페인어(enToEs): 각 보기의 영어 뜻만 추가
    // - 스페인어 → 영어(esToEn): 각 보기의 스페인어만 추가
    case "enToEs":
      if (word.en) extraParts.push(`뜻: ${word.en}`);
      break;

    case "esToEn":
      if (word.es) extraParts.push(`뜻: ${word.es}`);
      break;

    default:
      break;
  }

  if (!extraParts.length) return baseText;
  return `${baseText} ｜ ${extraParts.join(" / ")}`;
}


// ===== 문제 생성 =====
function buildQuestionForWord(word, mode) {
  // mode에 따라 질문 / 정답 필드 결정
  let questionText = "";
  let answerText = "";
  let poolType = ""; // 보기로 뿌릴 필드

  switch (mode) {
    case "krToJp":
      // 한국어 → 일본어 (漢字＋かな) 문제
      questionText = `「${word.krMeaning}」에 해당하는 일본어는?`;
      answerText = `${word.jpKanji || word.jpKana}（${word.jpKana}）`;
      poolType = "jp"; // 일본어 표현들
      break;

    case "jpToKr":
      // 일본어 → 한국어 뜻
      questionText = `「${word.jpKanji || word.jpKana}（${word.jpKana}）」의 한국어 뜻은?`;
      answerText = word.krMeaning;
      poolType = "kr";
      break;

    case "kanjiToKana":
      // 한자 읽기 (한자가 없는 애는 애초에 이 mode로 안 들어옴)
      questionText = `한자를 히라가나로 읽으면? 「${word.jpKanji}」`;
      answerText = word.jpKana;
      poolType = "kana";
      break;

    case "kanaToKanji":
      // 히라가나 → 한자 (한자가 없는 애는 애초에 이 mode로 안 들어옴)
      questionText = `히라가나를 한자로 쓰면? 「${word.jpKana}」`;
      answerText = word.jpKanji; // "(한자 없음)" 사용 안 함
      poolType = "kanji";
      break;
  }

  // --- 오답 보기 생성용 풀 만들기 ---
  let others = VOCAB.filter((w) => w.id !== word.id);

  // 1) 한자 보기일 때는, jpKanji 가 있는 애들만 보기 후보로 사용 (한자 없음 제거)
  if (poolType === "kanji") {
    others = others.filter(
      (w) => w.jpKanji && w.jpKanji !== "(한자 없음)"
    );
  }


  // 2) jp / kana 보기일 때는,
  //    끝 히라가나(어미)가 같은 단어들을 우선적으로 보기로 사용해서
  //    '어형은 비슷한데 의미만 다른' 전문 문제 느낌 나게 만들기
  if (poolType === "jp" || poolType === "kana") {
    const targetKana = word.jpKana;
    if (targetKana && targetKana.length > 0) {
      const lastChar = targetKana[targetKana.length - 1];

      // 끝 히라가나가 같은 단어들만 모으기
      const sameTail = others.filter(
        (w) => w.jpKana && w.jpKana[w.jpKana.length - 1] === lastChar
      );

      if (sameTail.length >= 4) {
        // 4개 이상 있으면, 그냥 이 애들끼리만 보기 구성
        others = sameTail;
      } else if (sameTail.length > 0) {
        // 1~3개면, 얘네를 우선 섞은 뒤 나머지는 다른 애들로 채우기
        const extra = others.filter((w) => !sameTail.includes(w));
        others = shuffleArray(sameTail).concat(shuffleArray(extra));
      }
      // 하나도 없으면(끝 어미 같은 친구가 없으면) others 를 그냥 그대로 사용
    }
  }

  // 최종 보기 4개 뽑기
  const shuffledOthers = shuffleArray(others).slice(0, 4);

  // 각 보기별로 (표시 텍스트 + 단어 id)를 함께 기억
  const choiceItems = shuffledOthers.map((w) => {
    let text = "";
    switch (poolType) {
      case "jp":
        // 한자+히라가나
        text = `${w.jpKanji || w.jpKana}（${w.jpKana}）`;
        break;
      case "kr":
        // 한국어 뜻
        text = w.krMeaning;
        break;
      case "kana":
        // 히라가나
        text = w.jpKana;
        break;
      case "kanji":
        // 한자 (한자 없는 애는 아예 후보에서 제거했기 때문에 안전)
        text = w.jpKanji;
        break;
      default:
        text = "";
    }
    return { wordId: w.id, text };
  });

  // 정답 선택지도 (현재 단어) 추가
  choiceItems.push({
    wordId: word.id,
    text: answerText,
  });

  // 인덱스를 섞어서 최종 보기/wordId 배열 만들기
  const indices = shuffleArray([0, 1, 2, 3, 4]);
  const finalChoices = [];
  const finalChoiceWordIds = [];

  indices.forEach((idx) => {
    const item = choiceItems[idx];
    if (!item) return;
    finalChoices.push(item.text);
    finalChoiceWordIds.push(item.wordId);
  });

  // 정답 인덱스는 word.id 기준으로 결정
  const correctIndex = finalChoiceWordIds.indexOf(word.id);

  return {
    wordId: word.id,
    questionText,
    choices: finalChoices,
    choiceWordIds: finalChoiceWordIds, // ★ 추가됨
    correctIndex,
    mode,
    answerText,
  };
}

// ===== 프랑스어 문제 생성 =====
function buildQuestionForWordFr(word) {
  // mode: frToEn or enToFr
  const mode = Math.random() < 0.5 ? "frToEn" : "enToFr";

  let questionText = "";
  let answerText = "";
  let poolType = "";

  if (mode === "frToEn") {
    questionText = `프랑스어 「${word.fr}」의 영어 뜻은?`;
    answerText = word.en;
    poolType = "en";
  } else {
    questionText = `영어 「${word.en}」을(를) 프랑스어로 하면?`;
    answerText = word.fr;
    poolType = "fr";
  }

  // --- 오답 후보 ---
  let others = VOCAB_FR.filter((w) => w.id !== word.id);

  // 보기 4개 뽑기
  const shuffled = shuffleArray(others).slice(0, 4);

  const choiceItems = shuffled.map((w) => {
    if (poolType === "en") return { wordId: w.id, text: w.en };
    if (poolType === "fr") return { wordId: w.id, text: w.fr };
  });

  // 정답 포함
  choiceItems.push({
    wordId: word.id,
    text: answerText,
  });

  // 보기 순서 섞기
  const idxs = shuffleArray([0, 1, 2, 3, 4]);
  const finalChoices = [];
  const finalChoiceWordIds = [];

  idxs.forEach((i) => {
    const item = choiceItems[i];
    if (!item) return;
    finalChoices.push(item.text);
    finalChoiceWordIds.push(item.wordId);
  });

  const correctIndex = finalChoiceWordIds.indexOf(word.id);

  return {
    wordId: word.id,
    questionText,
    choices: finalChoices,
    choiceWordIds: finalChoiceWordIds,
    correctIndex,
    mode,
    answerText,
  };
}

// ===== 스페인어 문제 생성 =====
function buildQuestionForWordEs(word) {
  // mode: esToEn or enToEs (프랑스어와 동일한 구조)
  const mode = Math.random() < 0.5 ? "esToEn" : "enToEs";

  let questionText = "";
  let answerText = "";
  let poolType = "";

  if (mode === "esToEn") {
    questionText = `스페인어 「${word.es}」의 영어 뜻은?`;
    answerText = word.en;
    poolType = "en";
  } else {
    questionText = `영어 「${word.en}」을(를) 스페인어로 하면?`;
    answerText = word.es;
    poolType = "es";
  }

  // --- 오답 후보 (전체 스페인어 단어장에서 가져오기) ---
  let others = [];
  if (typeof VOCAB_ES !== "undefined" && Array.isArray(VOCAB_ES)) {
    others = VOCAB_ES.filter((w) => w.id !== word.id);
  }

  // 보기 4개 뽑기
  const shuffled = shuffleArray(others).slice(0, 4);

  const choiceItems = shuffled
    .map((w) => {
      if (poolType === "en") return { wordId: w.id, text: w.en };
      if (poolType === "es") return { wordId: w.id, text: w.es };
      return null;
    })
    .filter(Boolean);

  // 정답 포함
  choiceItems.push({
    wordId: word.id,
    text: answerText,
  });

  // 보기 순서 섞기
  const idxs = shuffleArray([0, 1, 2, 3, 4]);
  const finalChoices = [];
  const finalChoiceWordIds = [];

  idxs.forEach((i) => {
    const item = choiceItems[i];
    if (!item) return;
    finalChoices.push(item.text);
    finalChoiceWordIds.push(item.wordId);
  });

  const correctIndex = finalChoiceWordIds.indexOf(word.id);

  return {
    wordId: word.id,
    questionText,
    choices: finalChoices,
    choiceWordIds: finalChoiceWordIds,
    correctIndex,
    mode,
    answerText,
  };
}

// 스페인어 전용
function generateExamQuestionsEs(count, pool) {
  const vocab = pool || VOCAB_ES;
  const shuffled = shuffleArray(vocab);
  const limited = shuffled.slice(0, Math.min(count, shuffled.length));
  return limited.map((w) => buildQuestionForWordEs(w));
}


// 프랑스어 전용
function generateExamQuestionsFr(count, pool) {
  const vocab = pool || VOCAB_FR;
  const shuffled = shuffleArray(vocab);
  const limited = shuffled.slice(0, Math.min(count, shuffled.length));
  return limited.map((w) => buildQuestionForWordFr(w));
}


function generateExamQuestions(_modeIgnored, count, wordPool) {
  const pool = wordPool || VOCAB;
  const shuffled = shuffleArray(pool);
  const limited = shuffled.slice(0, Math.min(count, shuffled.length));

  return limited.map((w) => {
    // 이 단어에 대해 허용되는 문제 유형 목록 만들기
    const modesForThis = [];

    // 의미 ↔ 일본어 문제는 항상 가능
    modesForThis.push("krToJp", "jpToKr");

    // 한자가 있는 단어만, 한자 관련 문제(kanjiToKana / kanaToKanji) 출제
    // "(한자 없음)" 같은 표시 문자열도 한자가 없는 것으로 취급
    if (w.jpKanji && w.jpKanji !== "(한자 없음)") {
      modesForThis.push("kanjiToKana", "kanaToKanji");
    }


    const randomMode =
      modesForThis[Math.floor(Math.random() * modesForThis.length)];

    return buildQuestionForWord(w, randomMode);
  });
}

// ===== UI 관련 =====
function showPanel(panelId) {
  document.getElementById("setup-panel").hidden = true;
  document.getElementById("quiz-panel").hidden = true;
  document.getElementById("result-panel").hidden = true;

  document.getElementById(panelId).hidden = false;
}

// ===== 언어 변경 =====
function setLanguage(lang) {
  if (!LANGS[lang]) lang = "ja";

  currentLang = lang;
  state.language = lang;

  const cfg = LANGS[lang];

  // 헤더 텍스트 변경
  const titleEl = document.getElementById("app-title");
  const nameEl = document.getElementById("character-name");
  const msgEl = document.getElementById("whale-message");

  if (titleEl) titleEl.textContent = cfg.title;
  if (nameEl) nameEl.textContent = cfg.characterName;
  if (msgEl) msgEl.textContent = cfg.initialMessage;

  // TODO: 나중 단계에서 언어별 통계/오답 불러오기 등을 여기서 처리할 수 있음
}

// ===== 언어별 시험 생성기 매핑 =====
// 나중에 언어를 더 추가하면 여기만 1줄씩 늘리면 됨
const EXAM_GENERATORS = {
  ja: (count, pool) => generateExamQuestions(null, count, pool),
  fr: (count, pool) => generateExamQuestionsFr(count, pool),
  es: (count, pool) => generateExamQuestionsEs(count, pool),
  // 예: kr: (count, pool) => generateExamQuestionsKr(count, pool),
};



function renderQuestion() {
  const q = state.questions[state.currentIndex];
  const questionTextEl = document.getElementById("question-text");
  const choicesContainer = document.getElementById("choices-container");
  const feedbackEl = document.getElementById("feedback");
  const currentNumEl = document.getElementById("current-number");
  const totalNumEl = document.getElementById("total-number");

  if (!q) return;

  currentNumEl.textContent = state.currentIndex + 1;
  totalNumEl.textContent = state.questions.length;
  questionTextEl.textContent = q.questionText;

  choicesContainer.innerHTML = "";
  q.choices.forEach((text, idx) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = text;
    btn.addEventListener("click", () => {
      state.selectedChoiceIndex = idx;
      updateChoiceSelection();
    });
    choicesContainer.appendChild(btn);
  });

  state.selectedChoiceIndex = null;
  state.currentCorrectIndex = q.correctIndex;

  feedbackEl.textContent = "";
  feedbackEl.classList.remove("correct", "wrong");
  document.getElementById("check-answer-btn").disabled = false;
  document.getElementById("next-question-btn").disabled = true;
  updateChoiceSelection();
  updateScoreDisplay();
}

function updateChoiceSelection() {
  const buttons = document.querySelectorAll(".choice-btn");
  buttons.forEach((btn, idx) => {
    btn.classList.remove("selected");
    if (idx === state.selectedChoiceIndex) {
      btn.classList.add("selected");
    }
  });
}

function updateScoreDisplay() {
  document.getElementById("current-score").textContent = state.score;
}

function checkAnswer() {
  if (state.selectedChoiceIndex == null) {
    alert("먼저 보기를 선택해줘!");
    return;
  }

  const feedbackEl = document.getElementById("feedback");
  const buttons = document.querySelectorAll(".choice-btn");
  const q = state.questions[state.currentIndex];

  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === q.correctIndex) {
      btn.classList.add("correct");
    }
    if (idx === state.selectedChoiceIndex && idx !== q.correctIndex) {
      btn.classList.add("wrong");
    }
  });

  globalStats.totalQuestions += 1;

  if (state.selectedChoiceIndex === q.correctIndex) {
    state.score += 1;
    globalStats.totalCorrect += 1;
    feedbackEl.textContent = "정답! 잘했어 👏";
    feedbackEl.classList.remove("wrong");
    feedbackEl.classList.add("correct");
  } else {
    feedbackEl.textContent = `아쉽다! 정답은: ${q.answerText}`;
    feedbackEl.classList.remove("correct");
    feedbackEl.classList.add("wrong");
    state.thisExamWrong.push(q.wordId);
    globalStats.wrongWordIds.push(q.wordId);
  }

  // --- 정답 확인 후, 각 보기 옆에 나머지 정보(한자/히라가나/뜻) 표시 ---
  if (q.choiceWordIds && Array.isArray(q.choiceWordIds)) {
    buttons.forEach((btn, idx) => {
      const wordId = q.choiceWordIds[idx];
      const word = getWordById(wordId);
      if (!word) return;

      const newLabel = buildChoiceLabelAfterAnswer(
        word,
        q.mode,
        btn.textContent
      );
      btn.textContent = newLabel;
    });
  }

  document.getElementById("check-answer-btn").disabled = true;
  document.getElementById("next-question-btn").disabled = false;
  saveGlobalStats();
  updateCharacterPanel();
  updateScoreDisplay();
}

function goNextQuestion() {
  if (state.currentIndex + 1 >= state.questions.length) {
    showResult();
  } else {
    state.currentIndex += 1;
    renderQuestion();
  }
}

function showResult() {
  showPanel("result-panel");

  const finalScoreEl = document.getElementById("final-score");
  const finalTotalEl = document.getElementById("final-total");
  const resultCommentEl = document.getElementById("result-comment");
  const wrongListEl = document.getElementById("wrong-list");

  finalScoreEl.textContent = state.score;
  finalTotalEl.textContent = state.questions.length;

  const ratio = state.score / state.questions.length;
  if (ratio === 1) {
    resultCommentEl.textContent = "완벽해! 식은 죽 먹기인가?";
  } else if (ratio >= 0.8) {
    resultCommentEl.textContent = "꽤 잘하고 있어! 오답만 한 번 더 복습해보자.";
  } else if (ratio >= 0.5) {
    resultCommentEl.textContent = "나쁘지 않아. 꾸준히 하면 금방 늘 거야!";
  } else {
    resultCommentEl.textContent = "처음부터 완벽할 필요는 없어. 기초를 다시 다져보자!";
  }

  wrongListEl.innerHTML = "";
  if (state.thisExamWrong.length === 0) {
    wrongListEl.textContent = "이번 시험에서는 틀린 단어가 없어요 🎉";
  } else {
    const uniqueIds = [...new Set(state.thisExamWrong)];
    const vocab = getCurrentVocab(); // ✅ 현재 언어 단어장 사용

    uniqueIds.forEach((id) => {
      const w = vocab.find((v) => v.id === id);
      if (!w) return;

      const div = document.createElement("div");
      div.className = "wrong-item";

      // ✅ 언어별 표시 포맷
      if (currentLang === "ja") {
        div.textContent = `(${w.id}) ${w.jpKanji || w.jpKana}（${w.jpKana}） - ${w.krMeaning}`;
      } else if (currentLang === "fr") {
        div.textContent = `(${w.id}) ${w.fr} - ${w.en}`;
      } else if (currentLang === "es") {
        div.textContent = `(${w.id}) ${w.es} - ${w.en}`;
      } else {
        // 혹시 모를 fallback
        div.textContent = `(${w.id})`;
      }
      wrongListEl.appendChild(div);
    });
  }
}

// ===== 시험 시작 함수 =====
function startNewExam(fromWrongOnly = false) {
  state.mode = "mixed";
  const countInput = document.getElementById("question-count");
  const desiredCount = parseInt(countInput.value, 10) || 50;

  let pool;
  if (fromWrongOnly) {
    const wrongWords = getUniqueWrongWords();
    if (wrongWords.length === 0) {
      alert("지금까지 저장된 오답이 없어요!");
      return;
    }
    pool = wrongWords;
  } else {
    pool = getCurrentVocab(); // ★ 현재 언어의 전체 단어
  }

  if (!pool || pool.length < 5) {
    alert(
      `보기 5개를 만들려면 최소 5개의 단어가 필요해.\n현재 단어 수: ${pool ? pool.length : 0}\n단어 목록을 더 추가한 뒤 다시 시도해 주세요.`
    );
    return;
  }

  // 🔥 언어별 시험 생성기 선택
  const generator =
    EXAM_GENERATORS[currentLang] || EXAM_GENERATORS.ja; // fallback: 일본어

  state.questions = generator(desiredCount, pool);

  state.currentIndex = 0;
  state.score = 0;
  state.selectedChoiceIndex = null;
  state.thisExamWrong = [];

  showPanel("quiz-panel");
  renderQuestion();
}

// ===== 초기화 =====
document.addEventListener("DOMContentLoaded", () => {
  // ===== 언어 버튼 연결 =====
  const langButtons = document.querySelectorAll(".lang-btn");

  langButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const lang = btn.dataset.lang;

      // 버튼 active 토글
      langButtons.forEach((b) => {
        b.classList.toggle("active", b === btn);
      });

      // 언어 상태 변경
      setLanguage(lang);

      // ⭐ 언어 바뀌면 그 언어의 오답/통계 다시 불러오기
      loadGlobalStats();

      // ⭐ 말풍선 패널 업데이트
      updateCharacterPanel();
    });
  });


  // 초기 언어 세팅 (기본: 일본어)
  setLanguage("ja");
  loadGlobalStats();
  updateCharacterPanel();

  const startExamBtn = document.getElementById("start-exam-btn");
  const startWrongBtn = document.getElementById("start-wrong-btn");
  const checkAnswerBtn = document.getElementById("check-answer-btn");
  const nextQuestionBtn = document.getElementById("next-question-btn");
  const retryBtn = document.getElementById("retry-btn");
  const reviewWrongBtn = document.getElementById("review-wrong-btn");
  const endBtn = document.getElementById("end-btn");

  startExamBtn.addEventListener("click", () => {
    startNewExam(false);
  });

  startWrongBtn.addEventListener("click", () => {
    startNewExam(true);
  });

  checkAnswerBtn.addEventListener("click", checkAnswer);
  nextQuestionBtn.addEventListener("click", goNextQuestion);

  retryBtn.addEventListener("click", () => {
    showPanel("setup-panel");
  });

  reviewWrongBtn.addEventListener("click", () => {
    startNewExam(true);
  });

  endBtn.addEventListener("click", () => {
    showPanel("setup-panel");
  });
});
