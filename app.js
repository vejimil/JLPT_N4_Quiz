// app.js

// ===== 상수 & 상태 =====
const STORAGE_KEY = "nihongorae-jlpt-n4-v1";

let state = {
  mode: "krToJp", // 이제 실제 출제는 랜덤 모드지만, 상태값은 남겨둠
  questionCount: 50,
  questions: [],
  currentIndex: 0,
  score: 0,
  selectedChoiceIndex: null,
  currentCorrectIndex: null,
  thisExamWrong: [],
};

let globalStats = {
  totalQuestions: 0,
  totalCorrect: 0,
  wrongWordIds: [], // 전체 오답 단어 id 모음
};

// ===== 로컬스토리지 =====
function loadGlobalStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      globalStats = {
        ...globalStats,
        ...parsed,
      };
    }
  } catch (e) {
    console.error("load stats error", e);
  }
}

function saveGlobalStats() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(globalStats));
  } catch (e) {
    console.error("save stats error", e);
  }
}

// ===== 니혼고래 레벨 계산 =====
// 예시: 100문제 맞출 때마다 레벨 +1
function calcLevel(totalCorrect) {
  return Math.floor(totalCorrect / 100) + 1;
}

// 경험치 바: 다음 레벨까지 비율
function calcXpRatio(totalCorrect) {
  const within = totalCorrect % 100;
  return within / 100;
}

function updateWhalePanel() {
  const levelSpan = document.getElementById("whale-level");
  const xpFill = document.getElementById("xp-fill");
  const msgEl = document.getElementById("whale-message");

  const level = calcLevel(globalStats.totalCorrect);
  const ratio = calcXpRatio(globalStats.totalCorrect);

  levelSpan.textContent = level;
  xpFill.style.width = `${Math.round(ratio * 100)}%`;

  if (level === 1) {
    msgEl.textContent = "기초 단어부터 천천히 같이 가보자!";
  } else if (level <= 3) {
    msgEl.textContent = "꽤 열심히 하고 있네? 더 깊은 일본어 바다로~";
  } else if (level <= 6) {
    msgEl.textContent = "니혼고래가 진화했다! JLPT가 보여!";
  } else {
    msgEl.textContent = "전설의 고래… 일본어 바다의 지배자?!";
  }
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
  const set = new Set(globalStats.wrongWordIds);
  return VOCAB.filter((w) => set.has(w.id));
}

function getWordById(id) {
  return VOCAB.find((w) => w.id === id);
}

// 정답 체크 후, 각 보기 버튼에 추가 정보(한자/히라가나/뜻)를 붙이기 위한 함수
function buildChoiceLabelAfterAnswer(word, mode, baseText) {
  if (!word) return baseText;

  const hasKanji = word.jpKanji && word.jpKanji !== "(한자 없음)";
  const kana = word.jpKana;
  const kr = word.krMeaning;

  const extraParts = [];

  switch (mode) {
    case "krToJp":
      // 보기에는 이미 일본어(한자+히라가나)가 나왔으니, 한국어 뜻만 추가
      if (kr) extraParts.push(`뜻: ${kr}`);
      break;

    case "jpToKr":
      // 보기에는 한국어 뜻만 나왔으니, 일본어(한자+히라가나)를 추가
      if (hasKanji && kana) {
        extraParts.push(`${word.jpKanji}（${kana}）`);
      } else if (kana) {
        extraParts.push(`(${kana})`);
      }
      break;

    case "kanjiToKana":
      // 보기에는 히라가나만 나왔으니, 한자와 한국어 뜻을 추가
      if (hasKanji) extraParts.push(`한자: ${word.jpKanji}`);
      if (kr) extraParts.push(`뜻: ${kr}`);
      break;

    case "kanaToKanji":
      // 보기에는 한자만 나왔으니, 히라가나와 한국어 뜻을 추가
      if (kana) extraParts.push(`읽기: ${kana}`);
      if (kr) extraParts.push(`뜻: ${kr}`);
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
  updateWhalePanel();
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
    resultCommentEl.textContent = "완벽해! JLPT N4는 식은 죽 먹기인가?";
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
    uniqueIds.forEach((id) => {
      const w = VOCAB.find((v) => v.id === id);
      if (!w) return;
      const div = document.createElement("div");
      div.className = "wrong-item";
      div.textContent = `(${w.id}) ${w.jpKanji || w.jpKana}（${
        w.jpKana
      }） - ${w.krMeaning}`;
      wrongListEl.appendChild(div);
    });
  }
}

// ===== 시험 시작 함수 =====
function startNewExam(fromWrongOnly = false) {
  state.mode = "mixed"; // 이제는 랜덤 출제 모드
  const countInput = document.getElementById("question-count");
  const desiredCount = parseInt(countInput.value, 10) || 50;

  let pool = VOCAB;
  if (fromWrongOnly) {
    const wrongWords = getUniqueWrongWords();
    if (wrongWords.length === 0) {
      alert("지금까지 저장된 오답이 없어요!");
      return;
    }
    pool = wrongWords;
  }

  if (pool.length < 5) {
    alert(
      `보기 5개를 만들려면 최소 5개의 단어가 필요해.\n현재 단어 수: ${pool.length}\n단어 목록을 더 추가한 뒤 다시 시도해 주세요.`
    );
    return;
  }

  state.questions = generateExamQuestions(null, desiredCount, pool);
  state.currentIndex = 0;
  state.score = 0;
  state.selectedChoiceIndex = null;
  state.thisExamWrong = [];

  showPanel("quiz-panel");
  renderQuestion();
}

// ===== 초기화 =====
document.addEventListener("DOMContentLoaded", () => {
  loadGlobalStats();
  updateWhalePanel();

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
