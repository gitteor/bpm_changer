// =======================================================
// BPM Match Player - script.js (FULL)
// 기능:
// - 행 추가(+)
// - 각 행: 파일 업로드, 현재 BPM, 변경 BPM
// - 각 행: ▶ 재생, TAP(16회), ↑↓ 순서변경, 삭제
// - 전체 변환: 모든 행의 변경 BPM을 "전체 목표 BPM"으로 채움
// - 전체 재생: 업로드된 곡들 순서대로 재생
// - 일시정지/정지
// - 현재 재생 중 행 하이라이트
// - TAP은 "해당 곡이 재생 중일 때만" 활성화, 16회 탭 후 자동 현재BPM 입력 및 비활성
// =======================================================

// ===== DOM =====
const trackListEl = document.getElementById("trackList");
const addRowButton = document.getElementById("addRowButton");
const convertAllButton = document.getElementById("convertAllButton");

const globalTargetBpmInput = document.getElementById("globalTargetBpm");
const playAllButton = document.getElementById("playAllButton");
const pauseButton = document.getElementById("pauseButton");
const stopButton = document.getElementById("stopButton");

const audio = document.getElementById("audioPlayer");

// ===== 상태 =====
let tracks = []; // { id, file, url, name, currentBpm, targetBpm }
let isPlayingAll = false;
let playAllQueue = []; // 전체 재생 대상(업로드된 곡만)
let playAllIndex = 0;

// 탭 템포 상태: trackId -> { times: number[], done: boolean }
const tapState = new Map();
const TAP_COUNT = 16;

// ===== iOS pitch 유지 옵션 최대 적용 =====
function applyPitchPreserve(a) {
  // iOS Safari / iOS Chrome 모두 WebKit 기반: 아래 속성 중 되는 것만 적용
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
  // 모바일 안정성을 위해 안전 범위 제한
  return Math.max(0.5, Math.min(2.5, r));
}

function computeRate(currentBpm, targetBpm) {
  const c = toNumber(currentBpm, 0);
  const t = toNumber(targetBpm, 0);
  if (c <= 0 || t <= 0) return 1;
  return clampRate(t / c);
}

function resetTapForTrack(trackId) {
  tapState.set(trackId, { times: [], done: false });
}

function computeBpmFromTaps(times) {
  // 16번 탭이면 interval은 15개
  if (!times || times.length < 2) return null;

  const intervals = [];
  for (let i = 1; i < times.length; i++) {
    intervals.push(times[i] - times[i - 1]);
  }

  // 러닝 BPM 범위를 고려한 간격 필터(너무 빠르거나 느린 탭 제거)
  // interval(ms) = 60000/BPM
  // BPM 60 => 1000ms, BPM 220 => 273ms
  const filtered = intervals.filter(ms => ms >= 250 && ms <= 1200);
  if (filtered.length < 3) return null;

  // 중앙값(median)으로 안정화
  filtered.sort((a, b) => a - b);
  const mid = Math.floor(filtered.length / 2);
  const median = (filtered.length % 2 === 0)
    ? (filtered[mid - 1] + filtered[mid]) / 2
    : filtered[mid];

  let bpm = 60000 / median;

  // 흔한 2배/절반 혼동 보정 (러닝에서 160~190을 자주 목표로 함)
  if (bpm < 95) bpm *= 2;
  if (bpm > 220) bpm /= 2;

  return bpm;
}

function setActiveRow(id) {
  document.querySelectorAll(".track-row.active").forEach(el => el.classList.remove("active"));
  if (!id) return;
  const row = document.querySelector(`.track-row[data-id="${id}"]`);
  if (row) row.classList.add("active");
}

function stopPlayback() {
  isPlayingAll = false;
  playAllQueue = [];
  playAllIndex = 0;

  audio.onended = null;
  audio.pause();
  audio.currentTime = 0;

  setActiveRow("");
  pauseButton.textContent = "일시정지";
  playAllButton.disabled = false;

  render(); // 재생 상태 UI 반영
}

// ===== 행 추가 =====
function addEmptyRow() {
  const id = uid();
  const globalTarget = toNumber(globalTargetBpmInput.value, 180);

  tracks.push({
    id,
    file: null,
    url: "",
    name: "",
    currentBpm: "",
    targetBpm: String(globalTarget),
  });

  resetTapForTrack(id);
  render();
}

addRowButton.addEventListener("click", () => addEmptyRow());

// 최초 1행
addEmptyRow();

// ===== 렌더 =====
function render() {
  trackListEl.innerHTML = "";

  tracks.forEach((t, index) => {
    const row = document.createElement("div");
    row.className = "track-row";
    row.dataset.id = t.id;

    // 상단 그리드(파일/현재BPM/변경BPM)
    const grid = document.createElement("div");
    grid.className = "track-grid";

    // 1) 파일 input
    const fileWrap = document.createElement("div");

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    // iOS에서 accept="audio/*"가 파일 선택을 회색 비활성화시키는 케이스가 있어 기본은 비워둠
    // 필요하면 아래처럼 확장자 나열 권장:
    // fileInput.accept = ".mp3,.m4a,.wav,.aac";

    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;

      // 기존 URL 해제
      if (t.url) {
        try { URL.revokeObjectURL(t.url); } catch (e) {}
      }

      t.file = f;
      t.url = URL.createObjectURL(f);
      t.name = f.name || "audio";

      // 새 파일이 들어오면 탭 추정 상태는 초기화
      resetTapForTrack(t.id);

      render();
    });

    fileWrap.appendChild(fileInput);

    const fileName = document.createElement("div");
    fileName.className = "file-name";
    fileName.textContent = t.name ? `파일: ${t.name}` : "파일을 선택하세요.";
    fileWrap.appendChild(fileName);

    // 2) 현재 BPM
    const currentInput = document.createElement("input");
    currentInput.type = "number";
    currentInput.min = "1";
    currentInput.placeholder = "현재 BPM";
    currentInput.value = t.currentBpm;

    currentInput.addEventListener("input", () => {
      t.currentBpm = currentInput.value;
      // 배속 안내 갱신용
      renderRateInfoOnly(t.id);
    });

    // 3) 변경 BPM
    const targetInput = document.createElement("input");
    targetInput.type = "number";
    targetInput.min = "1";
    targetInput.placeholder = "변경 BPM";
    targetInput.value = t.targetBpm;

    targetInput.addEventListener("input", () => {
      t.targetBpm = targetInput.value;
      renderRateInfoOnly(t.id);
    });

    grid.appendChild(fileWrap);
    grid.appendChild(currentInput);
    grid.appendChild(targetInput);

    row.appendChild(grid);

    // 액션 버튼들
    const actions = document.createElement("div");
    actions.className = "track-actions";

    // ▶ 재생
    const playBtn = document.createElement("button");
    playBtn.className = "secondary small";
    playBtn.textContent = "▶";
    playBtn.addEventListener("click", async () => {
      if (!t.url) {
        alert("먼저 파일을 업로드해주세요.");
        return;
      }
      // 개별 재생으로 전환
      isPlayingAll = false;
      playAllButton.disabled = false;
      audio.onended = null;

      const rate = computeRate(t.currentBpm, t.targetBpm);
      setActiveRow(t.id);

      await playTrackUrl(t.url, rate);
      render(); // TAP 버튼 활성화 상태 갱신
    });

    // TAP 버튼
    const tapBtn = document.createElement("button");
    tapBtn.className = "tap small";
    tapBtn.textContent = "TAP";

    // 현재 상태 읽기
    const st = tapState.get(t.id) || { times: [], done: false };

    // 이 행이 재생 중인지 판단
    const isThisTrackPlaying = (!audio.paused && audio.src && t.url && audio.src === t.url);

    if (st.done) {
      tapBtn.disabled = true;
      tapBtn.textContent = "TAP 완료";
    } else {
      tapBtn.textContent = `TAP (${st.times.length}/${TAP_COUNT})`;
      // 재생 중일 때만 활성화
      tapBtn.disabled = !isThisTrackPlaying;
    }

    tapBtn.addEventListener("click", () => {
      const state = tapState.get(t.id) || { times: [], done: false };
      if (state.done) return;

      // 재생 중인 곡이 아니면 무시
      if (audio.paused || !audio.src || !t.url || audio.src !== t.url) return;

      state.times.push(performance.now());
      tapState.set(t.id, state);

      // 16회 도달
      if (state.times.length >= TAP_COUNT) {
        const bpm = computeBpmFromTaps(state.times);
        if (bpm) {
          t.currentBpm = String(Math.round(bpm));
          state.done = true;
          tapState.set(t.id, state);
          render();
        } else {
          alert("탭 간격이 불규칙해서 BPM 추정에 실패했습니다. 다시 시도해 주세요.");
          resetTapForTrack(t.id);
          render();
        }
        return;
      }

      // 진행 표기 업데이트
      tapBtn.textContent = `TAP (${state.times.length}/${TAP_COUNT})`;
    });

    // ↑ 순서 위로
    const upBtn = document.createElement("button");
    upBtn.className = "secondary small";
    upBtn.textContent = "↑";
    upBtn.disabled = (index === 0);
    upBtn.addEventListener("click", () => {
      if (index <= 0) return;
      const tmp = tracks[index - 1];
      tracks[index - 1] = tracks[index];
      tracks[index] = tmp;
      render();
    });

    // ↓ 순서 아래로
    const downBtn = document.createElement("button");
    downBtn.className = "secondary small";
    downBtn.textContent = "↓";
    downBtn.disabled = (index === tracks.length - 1);
    downBtn.addEventListener("click", () => {
      if (index >= tracks.length - 1) return;
      const tmp = tracks[index + 1];
      tracks[index + 1] = tracks[index];
      tracks[index] = tmp;
      render();
    });

    // 삭제
    const removeBtn = document.createElement("button");
    removeBtn.className = "danger small";
    removeBtn.textContent = "삭제";
    removeBtn.addEventListener("click", () => {
      // 재생 중인 트랙이면 정지
      if (t.url && audio.src === t.url) {
        stopPlayback();
      }

      if (t.url) {
        try { URL.revokeObjectURL(t.url); } catch (e) {}
      }
      tapState.delete(t.id);

      tracks = tracks.filter(x => x.id !== t.id);
      if (tracks.length === 0) {
        addEmptyRow(); // 비워지면 1행 유지
        return;
      }
      render();
    });

    actions.appendChild(playBtn);
    actions.appendChild(tapBtn);
    actions.appendChild(upBtn);
    actions.appendChild(downBtn);
    actions.appendChild(removeBtn);

    row.appendChild(actions);

    // 배속 안내
    const rateInfo = document.createElement("div");
    rateInfo.className = "file-name";
    rateInfo.dataset.rateInfoFor = t.id;
    const r = computeRate(t.currentBpm, t.targetBpm);
    rateInfo.textContent = `배속: ${r.toFixed(3)}x (=${t.targetBpm || "?"}/${t.currentBpm || "?"})`;
    row.appendChild(rateInfo);

    trackListEl.appendChild(row);
  });

  // 전체 재생 버튼: 재생 중이면 비활성
  playAllButton.disabled = isPlayingAll;
}

function renderRateInfoOnly(trackId) {
  const t = tracks.find(x => x.id === trackId);
  if (!t) return;
  const el = document.querySelector(`[data-rate-info-for="${trackId}"]`);
  if (!el) return;
  const r = computeRate(t.currentBpm, t.targetBpm);
  el.textContent = `배속: ${r.toFixed(3)}x (=${t.targetBpm || "?"}/${t.currentBpm || "?"})`;
}

// ===== 재생 공통 함수 =====
async function playTrackUrl(url, rate) {
  audio.pause();
  audio.currentTime = 0;
  audio.src = url;

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

// ===== 전체 변환(모든 행의 변경 BPM을 globalTarget으로) =====
convertAllButton.addEventListener("click", () => {
  const target = toNumber(globalTargetBpmInput.value, 180);
  tracks.forEach(t => {
    t.targetBpm = String(target);
  });
  render();
});

// ===== 전체 재생 =====
playAllButton.addEventListener("click", async () => {
  if (isPlayingAll) return;

  const playable = tracks.filter(t => t.url);
  if (playable.length === 0) {
    alert("먼저 파일을 업로드해주세요.");
    return;
  }

  // 전체 재생 큐 생성
  playAllQueue = playable.slice();
  playAllIndex = 0;
  isPlayingAll = true;
  playAllButton.disabled = true;

  // ended 이벤트로 다음 곡 재생
  audio.onended = async () => {
    if (!isPlayingAll) return;

    playAllIndex += 1;
    if (playAllIndex >= playAllQueue.length) {
      // 끝
      isPlayingAll = false;
      playAllButton.disabled = false;
      audio.onended = null;
      setActiveRow("");
      render();
      return;
    }

    await playAllAtIndex(playAllIndex);
  };

  await playAllAtIndex(playAllIndex);
  render();
});

async function playAllAtIndex(idx) {
  const t = playAllQueue[idx];
  const globalTarget = toNumber(globalTargetBpmInput.value, 180);

  // 행의 targetBpm이 비어있으면 globalTarget 사용
  const target = (t.targetBpm && toNumber(t.targetBpm, 0) > 0) ? toNumber(t.targetBpm, globalTarget) : globalTarget;
  const rate = computeRate(t.currentBpm, target);

  setActiveRow(t.id);

  await playTrackUrl(t.url, rate);
  render(); // TAP 버튼 활성 상태 갱신
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

  render(); // TAP 버튼 활성/비활성 갱신
});

// ===== 정지 =====
stopButton.addEventListener("click", () => {
  stopPlayback();
});

// 최초 렌더
render();
