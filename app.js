// app.js

// ===== 상수 & 상태 =====
const STORAGE_KEY = "nihongorae-jlpt-n4-v1";

let state = {
  mode: "krToJp", // krToJp | jpToKr | kanjiToKana | kanaToKanji
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

// ===== 문제 생성 =====
function buildQuestionForWord(word, mode) {
  // mode에 따라 질문 / 정답 필드 결정
  let questionText = "";
  let answerText = "";
  let poolType = ""; // 보기로 뿌릴 필드

  switch (mode) {
    case "krToJp":
      questionText = `「${word.krMeaning}」에 해당하는 일본어는?`;
      answerText = `${word.jpKanji || word.jpKana}（${word.jpKana}）`;
      poolType = "jp"; // 일본어 표현들
      break;
    case "jpToKr":
      questionText = `「${word.jpKanji || word.jpKana}（${word.jpKana}）」의 한국어 뜻은?`;
      answerText = word.krMeaning;
      poolType = "kr";
      break;
    case "kanjiToKana":
      questionText = `한자를 히라가나로 읽으면? 「${word.jpKanji || word.jpKana}」`;
      answerText = word.jpKana;
      poolType = "kana";
      break;
    case "kanaToKanji":
      questionText = `히라가나를 한자로 쓰면? 「${word.jpKana}」`;
      answerText = word.jpKanji || "(한자 없음)";
      poolType = "kanji";
      break;
  }

  // 오답 보기 생성
  const others = VOCAB.filter((w) => w.id !== word.id);
  const shuffledOthers = shuffleArray(others).slice(0, 4);
  const choiceTexts = shuffledOthers.map((w) => {
    switch (poolType) {
      case "jp":
        return `${w.jpKanji || w.jpKana}（${w.jpKana}）`;
      case "kr":
        return w.krMeaning;
      case "kana":
        return w.jpKana;
      case "kanji":
        return w.jpKanji || "(한자 없음)";
      default:
        return "";
    }
  });

  choiceTexts.push(answerText);
  const indices = shuffleArray([0, 1, 2, 3, 4]);
  const finalChoices = indices.map((idx) => choiceTexts[idx]);
  const correctIndex = finalChoices.indexOf(answerText);

  return {
    wordId: word.id,
    questionText,
    choices: finalChoices,
    correctIndex,
    mode,
    answerText,
  };
}

function generateExamQuestions(_modeIgnored, count, wordPool) {
  const pool = wordPool || VOCAB;
  const shuffled = shuffleArray(pool);
  const limited = shuffled.slice(0, Math.min(count, shuffled.length));

  // 네 가지 문제 유형 중에서 랜덤으로 고르기
  const modes = ["krToJp", "jpToKr", "kanjiToKana", "kanaToKanji"];

  return limited.map((w) => {
    const randomMode = modes[Math.floor(Math.random() * modes.length)];
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

// ===== 시험 시작 함수들 =====
function startNewExam(mode, fromWrongOnly = false) {
  state.mode = mode;
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
      `보기 5개를 만들려면 최소 5개의 단어가 필요해.\n현재 단어 수: ${pool.length}\n먼저 vocab.js에 단어를 더 넣어줘!`
    );
    return;
  }

  state.questions = generateExamQuestions(mode, desiredCount, pool);
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

  const modeSelect = document.getElementById("mode-select");
  const startExamBtn = document.getElementById("start-exam-btn");
  const startWrongBtn = document.getElementById("start-wrong-btn");
  const checkAnswerBtn = document.getElementById("check-answer-btn");
  const nextQuestionBtn = document.getElementById("next-question-btn");
  const retryBtn = document.getElementById("retry-btn");
  const reviewWrongBtn = document.getElementById("review-wrong-btn");
  const endBtn = document.getElementById("end-btn");

  startExamBtn.addEventListener("click", () => {
    const mode = modeSelect.value;
    startNewExam(mode, false);
  });

  startWrongBtn.addEventListener("click", () => {
    const mode = modeSelect.value;
    startNewExam(mode, true);
  });

  checkAnswerBtn.addEventListener("click", checkAnswer);
  nextQuestionBtn.addEventListener("click", goNextQuestion);

  retryBtn.addEventListener("click", () => {
    showPanel("setup-panel");
  });

  reviewWrongBtn.addEventListener("click", () => {
    const mode = modeSelect.value;
    startNewExam(mode, true);
  });

  endBtn.addEventListener("click", () => {
    showPanel("setup-panel");
  });
});
