// ===== 상태 =====
let tracks = []; // { id, file, url, name, currentBpm, targetBpm }
let isPlayingAll = false;
let playAllIndex = 0;

const trackListEl = document.getElementById("trackList");
const addRowButton = document.getElementById("addRowButton");
const convertAllButton = document.getElementById("convertAllButton");

const globalTargetBpmInput = document.getElementById("globalTargetBpm");
const playAllButton = document.getElementById("playAllButton");
const pauseButton = document.getElementById("pauseButton");
const stopButton = document.getElementById("stopButton");

const audio = document.getElementById("audioPlayer");

// ===== iOS pitch 유지 옵션 최대 적용 =====
function applyPitchPreserve(a) {
  // 표준/사파리/크롬 iOS 계열에서 최대한 켜기
  try { a.preservesPitch = true; } catch (e) {}
  try { a.mozPreservesPitch = true; } catch (e) {}
  try { a.webkitPreservesPitch = true; } catch (e) {}
}
applyPitchPreserve(audio);

// ===== 유틸 =====
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function toNumber(v, fallback = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampRate(r) {
  // iOS Safari에서 극단 배속은 불안정할 수 있어 안전범위
  // 필요하면 넓혀도 되지만, 기본은 0.5~2.5
  return Math.max(0.5, Math.min(2.5, r));
}

function computeRate(currentBpm, targetBpm) {
  const c = toNumber(currentBpm, 0);
  const t = toNumber(targetBpm, 0);
  if (c <= 0 || t <= 0) return 1;
  return clampRate(t / c);
}

function setActiveRow(id) {
  document.querySelectorAll(".track-row.active").forEach(el => el.classList.remove("active"));
  const row = document.querySelector(`.track-row[data-id="${id}"]`);
  if (row) row.classList.add("active");
}

// ===== 행 추가 =====
function addEmptyRow(presetTargetBpm = null) {
  const id = uid();
  const globalTarget = toNumber(globalTargetBpmInput.value, 180);

  tracks.push({
    id,
    file: null,
    url: "",
    name: "",
    currentBpm: "",
    targetBpm: presetTargetBpm != null ? String(presetTargetBpm) : String(globalTarget),
  });

  render();
}

addRowButton.addEventListener("click", () => {
  addEmptyRow(null);
});

// 최초 1행
addEmptyRow(null);

// ===== 렌더 =====
function render() {
  trackListEl.innerHTML = "";

  tracks.forEach((t, index) => {
    const row = document.createElement("div");
    row.className = "track-row";
    row.dataset.id = t.id;

    const grid = document.createElement("div");
    grid.className = "track-grid";

    // 파일 input
    const fileWrap = document.createElement("div");
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    // iOS에서 accept 필터가 “회색 비활성화”를 유발하는 케이스가 있어, 우선 제거/완화 권장
    // 필요하면 ".mp3,.m4a,.wav,.aac"처럼 확장자 나열을 권장
    // fileInput.accept = "audio/*";

    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;

      // 기존 url 정리
      if (t.url) {
        try { URL.revokeObjectURL(t.url); } catch (e) {}
      }

      t.file = f;
      t.url = URL.createObjectURL(f);
      t.name = f.name || "audio";
      render(); // 파일명 표시 업데이트
    });

    fileWrap.appendChild(fileInput);

    const fileName = document.createElement("div");
    fileName.className = "file-name";
    fileName.textContent = t.name ? `파일: ${t.name}` : "파일을 선택하세요.";
    fileWrap.appendChild(fileName);

    // 현재 BPM
    const currentInput = document.createElement("input");
    currentInput.type = "number";
    currentInput.min = "1";
    currentInput.placeholder = "현재 BPM";
    currentInput.value = t.currentBpm;
    currentInput.addEventListener("input", () => {
      t.currentBpm = currentInput.value;
    });

    // 목표 BPM
    const targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.min = "1";
    targetInput.placeholder = "변경 BPM";
    targetInput.value = t.targetBpm;
    targetInput.addEventListener("input", () => {
      t.targetBpm = targetInput.value;
    });

    grid.appendChild(fileWrap);
    grid.appendChild(currentInput);
    grid.appendChild(targetInput);

    row.appendChild(grid);

    // 액션 버튼
    const actions = document.createElement("div");
    actions.className = "track-actions";

    const playBtn = document.createElement("button");
    playBtn.className = "secondary small";
    playBtn.textContent = "▶";
    playBtn.addEventListener("click", async () => {
      if (!t.url) {
        alert("먼저 파일을 업로드해주세요.");
        return;
      }
      const rate = computeRate(t.currentBpm, t.targetBpm);
      setActiveRow(t.id);
      await playOneTrack(t, rate);
    });

    const removeBtn = document.createElement("button");
    removeBtn.className = "danger small";
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", () => {
      if (t.url) {
        try { URL.revokeObjectURL(t.url); } catch (e) {}
      }
      // 재생 중인 트랙을 지우는 경우 정지
      if (audio.src && audio.src === t.url) {
        stopPlayback();
      }
      tracks = tracks.filter(x => x.id !== t.id);
      render();
    });

    const upBtn = document.createElement("button");
    upBtn.className = "secondary small";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      if (index <= 0) return;
      const tmp = tracks[index - 1];
      tracks[index - 1] = tracks[index];
      tracks[index] = tmp;
      render();
    });

    const downBtn = document.createElement("button");
    downBtn.className = "secondary small";
    downBtn.textContent = "↓";
    downBtn.disabled = index === tracks.length - 1;
    downBtn.addEventListener("click", () => {
      if (index >= tracks.length - 1) return;
      const tmp = tracks[index + 1];
      tracks[index + 1] = tracks[index];
      tracks[index] = tmp;
      render();
    });

    const rateInfo = document.createElement("div");
    rateInfo.className = "file-name";
    const r = computeRate(t.currentBpm, t.targetBpm);
    rateInfo.textContent = `배속: ${r.toFixed(3)}x (=${t.targetBpm || "?"}/${t.currentBpm || "?"})`;

    actions.appendChild(playBtn);
    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    row.appendChild(rateInfo);

    trackListEl.appendChild(row);
  });

  // 전체 재생 버튼 비활성/활성
  playAllButton.disabled = isPlayingAll;
}

// ===== 단일 트랙 재생 =====
async function playOneTrack(t, rate) {
  isPlayingAll = false;
  playAllButton.disabled = false;

  // iOS에서 같은 src 재할당 이슈를 줄이기 위해 항상 새로 지정
  audio.pause();
  audio.currentTime = 0;
  audio.src = t.url;

  applyPitchPreserve(audio);
  audio.playbackRate = rate;

  try {
    await audio.play();
    pauseButton.textContent = "일시정지";
  } catch (e) {
    console.error(e);
    alert("재생이 차단되었습니다. iPhone에서는 버튼 클릭 직후 재생만 허용되는 경우가 있습니다.");
  }
}

// ===== 전체 변환: 목표 BPM을 전부 globalTarget으로 채우는 편의 기능 =====
convertAllButton.addEventListener("click", () => {
  const target = toNumber(globalTargetBpmInput.value, 180);
  tracks.forEach(t => {
    // 파일이 있든 없든 목표 bpm을 맞춰두는 용도
    t.targetBpm = String(target);
  });
  render();
});

// ===== 전체 재생 =====
playAllButton.addEventListener("click", async () => {
  if (isPlayingAll) return;

  // 재생 가능한 트랙만
  const playable = tracks.filter(t => t.url);
  if (playable.length === 0) {
    alert("먼저 파일을 업로드해주세요.");
    return;
  }

  // 목표 BPM이 입력된 경우, 그걸 우선 사용 (각 행의 targetBpm도 그대로 존중)
  // 사용자가 “전체 목표 BPM”을 180으로 둔 상태에서 "전체 변환"을 안 눌러도
  // 전체 재생은 글로벌 목표를 강제할지/행별 목표를 존중할지 선택이 필요합니다.
  // 여기서는: 행별 targetBpm이 비어있으면 globalTarget을 사용
  const globalTarget = toNumber(globalTargetBpmInput.value, 180);

  isPlayingAll = true;
  playAllButton.disabled = true;
  playAllIndex = 0;

  pauseButton.textContent = "일시정지";

  // ended 이벤트로 다음 곡
  audio.onended = async () => {
    if (!isPlayingAll) return;
    playAllIndex += 1;
    if (playAllIndex >= playable.length) {
      // 끝
      isPlayingAll = false;
      playAllButton.disabled = false;
      setActiveRow(""); // 해제
      return;
    }
    await playAllAtIndex(playable, playAllIndex, globalTarget);
  };

  await playAllAtIndex(playable, playAllIndex, globalTarget);
});

async function playAllAtIndex(playable, index, globalTarget) {
  const t = playable[index];
  const target = t.targetBpm ? toNumber(t.targetBpm, globalTarget) : globalTarget;
  const rate = computeRate(t.currentBpm, target);

  setActiveRow(t.id);

  audio.pause();
  audio.currentTime = 0;
  audio.src = t.url;

  applyPitchPreserve(audio);
  audio.playbackRate = rate;

  try {
    await audio.play();
  } catch (e) {
    console.error(e);
    alert("재생이 차단되었습니다. iPhone에서는 버튼 클릭 직후 재생만 허용되는 경우가 있습니다.");
    stopPlayback();
  }
}

// ===== 일시정지 =====
pauseButton.addEventListener("click", async () => {
  if (!audio.src) return;

  if (audio.paused) {
    try {
      await audio.play();
      pauseButton.textContent = "일시정지";
    } catch (e) {
      console.error(e);
    }
  } else {
    audio.pause();
    pauseButton.textContent = "다시 재생";
  }
});

// ===== 정지 =====
stopButton.addEventListener("click", () => {
  stopPlayback();
});

function stopPlayback() {
  isPlayingAll = false;
  playAllButton.disabled = false;

  audio.onended = null;
  audio.pause();
  audio.currentTime = 0;

  document.querySelectorAll(".track-row.active").forEach(el => el.classList.remove("active"));
  pauseButton.textContent = "일시정지";
}
