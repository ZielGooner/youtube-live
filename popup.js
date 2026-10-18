"use strict";

const toggle = document.getElementById("enabled");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const statusDot = document.getElementById("status-dot");
const errorLabel = document.getElementById("error");
let refreshGeneration = 0;

const reasons = {
  disabled: "기능을 껐어요. YouTube 기본 배치를 사용해요.",
  "landscape-theater": "가로 영화관 모드에서는 영상·채팅의 원래 배치를 유지하고 추천 영상을 채널 설명 아래에 모아요.",
  fullscreen: "플레이어 전체화면에서는 YouTube 기본 화면을 사용해요.",
  miniplayer: "미니플레이어에서는 YouTube 기본 배치를 사용해요.",
  "viewport-small": "화면 높이가 500px보다 작아 영상과 채팅 입력창을 함께 담기 어려워요. 창을 더 길게 늘리면 세로 배치를 적용해요.",
  "not-watch": "YouTube 라이브 영상 페이지에서 사용할 수 있어요.",
  "not-live": "현재 영상은 진행 중인 라이브 방송이 아니에요.",
  "no-chat": "열려 있는 라이브 채팅이 없어 기본 배치를 사용해요.",
  "chat-hidden": "숨긴 채팅은 자동으로 다시 열지 않아요.",
  loading: "영상과 채팅이 준비되면 자동으로 적용돼요.",
  unsupported: "현재 페이지 구조에서는 기본 배치를 유지해요.",
  normal: "채팅은 페이지 스크롤을 따라오고 하단에 작은 여백을 남겨요. 설명 아래 추천 영상은 가로 최대 4개, 세로 최대 2개로 표시해요.",
  "portrait-theater": "영상, 제목·채널·설명, 채팅 순서로 표시해요. 아래로 스크롤하면 추천 영상과 댓글을 볼 수 있어요.",
  active: "현재 보기 모드에 맞춰 라이브 화면을 개선해요."
};

function showStatus(title, detail, active = false) {
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  statusDot.classList.toggle("active", active);
}

async function refreshStatus() {
  const generation = ++refreshGeneration;
  try {
    const settings = await chrome.storage.local.get({ enabled: true });
    if (generation !== refreshGeneration) return;
    toggle.checked = settings.enabled !== false;
    if (!toggle.checked) {
      showStatus("기능 꺼짐", reasons.disabled);
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!Number.isInteger(tab?.id)) throw new Error("No active tab");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "ytlp:get-status" }, { frameId: 0 });
    if (generation !== refreshGeneration) return;
    if (!response || typeof response.active !== "boolean") throw new Error("No page status");
    const active = response.active;
    const reason = typeof response.reason === "string" ? response.reason : "";
    const detail = reasons[reason] || reason || (active ? reasons.active : reasons.loading);
    const titles = { normal: "기본 모드 개선 적용 중", "portrait-theater": "세로 영화관 배치 적용 중", "landscape-theater": "가로 영화관 추천 배치 적용 중" };
    showStatus(active ? (titles[reason] || titles[response.mode] || "라이브 화면 개선 적용 중") : "자동 적용 대기 중", detail, active);
  } catch (_) {
    if (generation !== refreshGeneration) return;
    showStatus("현재 탭에 연결되지 않았어요", "YouTube 라이브 페이지를 열어 주세요. 설치 전에 열어 둔 탭은 처음 한 번 새로고침이 필요해요.");
  }
}

toggle.addEventListener("change", async () => {
  const enabled = toggle.checked;
  toggle.disabled = true;
  errorLabel.hidden = true;
  try {
    await chrome.storage.local.set({ enabled });
    await refreshStatus();
  } catch (_) {
    toggle.checked = !enabled;
    errorLabel.textContent = "설정을 저장하지 못했어요. 팝업을 다시 열어 시도해 주세요.";
    errorLabel.hidden = false;
  } finally {
    toggle.disabled = false;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) void refreshStatus();
});

void refreshStatus();
setInterval(() => { if (!toggle.disabled) void refreshStatus(); }, 1200);
