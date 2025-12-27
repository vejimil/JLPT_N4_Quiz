// game.js
const backBtn = document.getElementById("back-btn");
backBtn.addEventListener("click", () => {
  window.location.href = "./index.html";
});

document.querySelectorAll(".lang-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const lang = btn.dataset.lang; // ja | fr | es
    // 다음 단계에서 이 값을 가지고 게임 세션 시작
    console.log("Selected lang:", lang);

    // 임시: 선택 표시(나중에 디자인대로 바꿈)
    document.querySelectorAll(".lang-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
});
