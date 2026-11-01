/**
 * app.js — 경희대 카공맵 리디자인 메인 애플리케이션
 *
 * 핵심 아키텍처:
 * 1. 바닐라 JS + Leaflet 1.9.4 + hours.js (빌드 도구 없음)
 * 2. 구글 시트 CSV 우선 로드 + 로컬 data.csv 자동 보완/대체 (시트만 수정해도 즉시 반영)
 * 3. 상황 카드 8종(단일 선택, URL ?campus=...&mood=... 공유) + 세부 조건 5종(다중 AND + 남는 개수 미리보기)
 * 4. DOM 제자리 업데이트(class/aria/count 텍스트만 변경)로 클릭 시 레이아웃 이동 0px 보장
 * 5. CARTO Positron 밝은 지도 + 선택 마커만 라벨 표시 + 3단계 바텀시트(peek / half / full)
 */

// 1. 핵심 설정 상수
const GOOGLE_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1td87-lDak8Cj8abo_qKMiARD8rXJ14Mwr4g3rknZJLU/export?format=csv";
const LOCAL_CSV_URL = "./data.csv";
const CANONICAL_SERVICE_URL = "https://korewajiyuda.github.io/khu_kagongmap/";
const GEMINI_BASE_URL =
  "https://gemini.google/students/?utm_source=student&utm_medium=social&utm_campaign=microsite_campus_kyunghee-ambassador";

// 8절: GA4 측정 ID 상수화 (비어 있으면 gtag 외부 스크립트를 로드하지 않되, dataLayer에는 이벤트를 적재)
const GA_MEASUREMENT_ID = "";

// 3-3절: 정보 수정 제보 링크 상수화 (기본값으로 데이터 시트/제보 링크 활성화, 비어 있으면 제보 버튼 숨김)
const REPORT_FORM_URL =
  "https://docs.google.com/spreadsheets/d/1td87-lDak8Cj8abo_qKMiARD8rXJ14Mwr4g3rknZJLU/edit?usp=sharing";

// 2. 캠퍼스별 기준점 좌표
const CAMPUS_ANCHORS = {
  seoul: [
    { key: "main_gate", label: "정문", lat: 37.5939, lng: 127.053 },
    { key: "back_gate", label: "후문", lat: 37.5947, lng: 127.0578 },
    { key: "hoegi_stn", label: "회기역", lat: 37.5898, lng: 127.0579 },
  ],
  global: [
    { key: "main_gate", label: "정문", lat: 37.246, lng: 127.078 },
    { key: "sasaek_sq", label: "사색의광장", lat: 37.2415, lng: 127.0815 },
    { key: "yeongtong_stn", label: "영통역", lat: 37.2515, lng: 127.0713 },
  ],
};

// 3. 4-1절: 상황 카드 8종 정의 (문구 원문 유지, 밤늦게까지/24시간은 영업시간 데이터로 판정)
const MOOD_CARDS = [
  {
    id: "chatty_pretty",
    label: "적당히 떠들면서 예쁜 카페에서 공부하고 싶을 때",
    match: (place) =>
      place.tags.includes("대화가능") || place.tags.includes("분위기좋음"),
  },
  {
    id: "late_night",
    label: "진짜 밤늦게까지 집중해야 할 때",
    match: (place, refDate) =>
      window.HoursEngine.isLateNightByHours(place, refDate) &&
      place.tags.includes("콘센트많음"),
  },
  {
    id: "cram",
    label: "내일 시험인데 아직 1장도 안 봤을 때",
    match: (place) => window.HoursEngine.is24HoursPlace(place),
  },
  {
    id: "battery",
    label: "노트북 배터리가 간당간당할 때",
    match: (place) => place.tags.includes("콘센트많음"),
  },
  {
    id: "alone",
    label: "아무도 신경 안 쓰고 혼자 파고들고 싶을 때",
    match: (place) =>
      place.tags.includes("1인석") || place.tags.includes("조용한"),
  },
  {
    id: "gap_hour",
    label: "공강 1시간, 멀리 가기 귀찮을 때",
    match: (place) =>
      place.tags.includes("교내카페") || place.distance <= 300,
  },
  {
    id: "team",
    label: "팀플 회의해야 할 때",
    match: (place) => place.tags.includes("단체석"),
  },
  {
    id: "budget",
    label: "커피값도 아끼고 싶을 때",
    match: (place) => place.tags.includes("저가"),
  },
];

// 4. 4-2 & 4-3절: 세부 조건 5종 및 태그 표시용 라벨 매핑 ('#' 제거, 띄어쓰기 적용)
const DETAIL_CONDITIONS = [
  {
    key: "콘센트많음",
    label: "콘센트 많음",
    match: (place) => place.tags.includes("콘센트많음"),
  },
  {
    key: "조용한",
    label: "조용한",
    match: (place) => place.tags.includes("조용한"),
  },
  {
    key: "1인석",
    label: "1인석",
    match: (place) => place.tags.includes("1인석"),
  },
  {
    key: "교내카페",
    label: "교내 카페",
    match: (place) => place.tags.includes("교내카페"),
  },
  {
    key: "24시간",
    label: "24시간",
    match: (place) => window.HoursEngine.is24HoursPlace(place),
  },
];

const TAG_DISPLAY_LABELS = {
  콘센트많음: "콘센트 많음",
  조용한: "조용한",
  밤늦게까지: "밤늦게까지",
  "24시간": "24시간",
  교내카페: "교내 카페",
  "1인석": "1인석",
  대화가능: "대화 가능",
  분위기좋음: "분위기 좋음",
  단체석: "단체석",
  저가: "저가",
};

// 5. 애플리케이션 상태
const state = {
  places: [],
  campus: "seoul",
  anchorKey: "main_gate",
  anchorCoord: { lat: 37.5939, lng: 127.053, label: "정문" },
  radiusMeters: 500, // 300 | 500 | 1000 | 0(전체)
  selectedMood: null, // MOOD_CARDS id 또는 null
  selectedDetails: new Set(), // DETAIL_CONDITIONS key Set
  openNowOnly: true, // 기본 ON ("지금 영업 중만")
  visitTimeMode: "now", // 'now' | 'tonight22' | 'custom'
  customTimeValue: "23:00",
  selectedPlaceId: null,
  sheetState: "half", // 'peek' | 'half' | 'full'
  greetingDismissed: false,
  fairyCheerIndex: 0,
};

const FAIRY_CHEER_MESSAGES = [
  "오늘은 어디서 공부할까요?",
  "과제 폭탄도 요정 삼총사가 같이 응원할게요!",
  "배터리 걱정 없는 콘센트 명당부터 찾아볼까요?",
  "오늘 목표 분량 끝내면 맛있는 디저트 어때요?",
  "밤늦게까지 집중하는 경희인, 오늘도 파이팅이에요!",
  "공강 시간엔 정문·후문 300m 안쪽 카페가 딱이에요!",
];

function triggerFairySparkleAndHop(targetEl) {
  if (!targetEl) return;
  targetEl.classList.remove("fairy-hop");
  void targetEl.offsetWidth;
  targetEl.classList.add("fairy-hop");
  setTimeout(() => {
    targetEl.classList.remove("fairy-hop");
  }, 540);

  const rect = targetEl.getBoundingClientRect();
  if (!rect || rect.width === 0) return;

  const offsets = [-16, 0, 16];
  offsets.forEach((dx, idx) => {
    const sp = document.createElement("div");
    sp.className = "fairy-sparkle-particle";
    sp.style.left = `${rect.left + rect.width / 2 + dx * 0.5}px`;
    sp.style.top = `${rect.top + rect.height * 0.25}px`;
    sp.style.setProperty("--dx", `${dx}px`);
    sp.style.animationDelay = `${idx * 55}ms`;
    sp.innerHTML = `
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <defs>
          <linearGradient id="spGrad${Date.now()}_${idx}" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#F26B5E" />
            <stop offset="33%" stop-color="#F6C453" />
            <stop offset="67%" stop-color="#4D96FF" />
            <stop offset="100%" stop-color="#6BCB77" />
          </linearGradient>
        </defs>
        <path fill="url(#spGrad${Date.now()}_${idx})" d="M8 0L9.8 6.2L16 8L9.8 9.8L8 16L6.2 9.8L0 8L6.2 6.2Z" />
      </svg>
    `;
    document.body.appendChild(sp);
    setTimeout(() => sp.remove(), 820);
  });
}

function cycleFairyCheerMessage(sourceEl) {
  state.greetingDismissed = false;
  state.fairyCheerIndex = (state.fairyCheerIndex + 1) % FAIRY_CHEER_MESSAGES.length;
  const nextMsg = FAIRY_CHEER_MESSAGES[state.fairyCheerIndex];

  const greetingBar = document.getElementById("fairyGreetingBar");
  const greetingImg = document.getElementById("greetingFairyImg");
  const greetingText = document.getElementById("greetingText");

  if (greetingBar) greetingBar.classList.remove("hidden");
  if (greetingText) greetingText.textContent = nextMsg;
  if (greetingImg) {
    greetingImg.src = "./assets/fairy/fairy-trio.webp?v=20261102_3";
  }

  triggerFairySparkleAndHop(sourceEl || greetingImg);
  return nextMsg;
}

let leafletMap = null;
let radiusCircle = null;
let anchorMarker = null;
let placeMarkersLayer = null;
let markerElementsById = new Map();
let refreshTimerId = null;

// 6. GA4 초기화 및 이벤트 트래킹 (기존 이벤트 이름 유지 + 신규 이벤트 5종 지원)
function initGA4() {
  if (!GA_MEASUREMENT_ID || !GA_MEASUREMENT_ID.trim()) return;
  const id = GA_MEASUREMENT_ID.trim();
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", id);

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

function trackEvent(eventName, params = {}) {
  const payload = {
    campus: state.campus,
    map: "kagong",
    ...params,
  };
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function" && GA_MEASUREMENT_ID) {
    window.gtag("event", eventName, payload);
  } else {
    window.dataLayer.push({ event: eventName, ...payload });
  }
}

// 7. 하버사인 거리 계산 (단위: m)
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function formatDistanceLabel(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }
  return `${meters}m`;
}

// 8. 현재 선택된 방문 시각("지금" / "아침 9시" / "낮 2시" / "오늘 밤 10시" / "직접 선택")에 따른 기준 Date 반환
function getEffectiveReferenceDate() {
  const now = new Date();
  if (state.visitTimeMode === "morning09") {
    return window.HoursEngine.createUpcomingSeoulDateAtTime
      ? window.HoursEngine.createUpcomingSeoulDateAtTime(9, 0, now)
      : window.HoursEngine.createSeoulDateAtTime(9, 0, now);
  }
  if (state.visitTimeMode === "afternoon14") {
    return window.HoursEngine.createUpcomingSeoulDateAtTime
      ? window.HoursEngine.createUpcomingSeoulDateAtTime(14, 0, now)
      : window.HoursEngine.createSeoulDateAtTime(14, 0, now);
  }
  if (state.visitTimeMode === "tonight22") {
    return window.HoursEngine.createSeoulDateAtTime(22, 0, now);
  }
  if (state.visitTimeMode === "custom" && state.customTimeValue) {
    const parts = state.customTimeValue.split(":");
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1], 10);
    if (!Number.isNaN(hh) && !Number.isNaN(mm)) {
      return window.HoursEngine.createSeoulDateAtTime(hh, mm, now);
    }
  }
  return now;
}

// 9. CSV 파서 (따옴표 안의 쉼표 및 구글 시트 단일 셀 붙여넣기 행 완벽 처리)
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeTag(tagStr) {
  return String(tagStr || "")
    .replace(/^#+/, "")
    .trim();
}

function inferDefaultMetadata(tags) {
  const tagSet = new Set(tags);
  let days = "매일";
  let hours = "09:00 ~ 22:00";
  let outlets = "창가 및 벽면 좌석 콘센트 구비";

  if (tagSet.has("교내카페")) {
    days = "평일 (주말 휴무)";
    hours = "08:00 ~ 19:00";
    outlets = "창가 바테이블 및 로비 벽면 일부 구비";
  } else if (tagSet.has("24시간")) {
    days = "매일 (연중무휴)";
    hours = "24시간 영업";
    outlets = "전 좌석 콘센트 완비";
  } else if (tagSet.has("밤늦게까지")) {
    hours = "08:30 ~ 23:00";
  }

  return { days, hours, outlets };
}

function parseCSV(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const baseHeaders = parseCSVLine(lines[0]).map((h) => h.trim());
  const extendedOrder = [
    "id",
    "campus",
    "map",
    "name",
    "lat",
    "lng",
    "summary",
    "tags",
    "link",
    "days",
    "hours",
    "outlets",
    "status",
    "verified_at",
    "hours_detail",
    "break_time",
    "last_order",
    "closed_days",
    "note",
  ];

  const parsedItems = [];

  for (let idx = 1; idx < lines.length; idx++) {
    let cols = parseCSVLine(lines[idx]);

    // 구글 시트 A열 한 칸에 통째로 붙여넣어진 행("31,seoul,kagong,...") 자동 복원
    if (
      cols.length > 1 &&
      cols[0].includes(",") &&
      /^\d+\s*,\s*(seoul|global)\s*,\s*kagong\s*,/.test(cols[0]) &&
      cols.slice(1).every((c) => !c)
    ) {
      cols = parseCSVLine(cols[0]);
    }

    const obj = {};
    baseHeaders.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    // 만약 시트 헤더보다 더 많은 컬럼이 들어온 경우 extendedOrder 순서로 매핑
    if (cols.length > baseHeaders.length) {
      for (let i = baseHeaders.length; i < cols.length && i < extendedOrder.length; i++) {
        const key = extendedOrder[i];
        if (!obj[key]) obj[key] = cols[i] ?? "";
      }
    }

    const rawTags = obj.tags
      ? obj.tags
          .split(/[,·]/)
          .map((t) => normalizeTag(t))
          .filter(Boolean)
      : [];

    const fallbackMeta = inferDefaultMetadata(rawTags);
    const rawDays = (obj.days || "").trim();
    const rawHours = (obj.hours || "").trim();
    const rawOutlets = (obj.outlets || "").trim();

    const item = {
      id: Number(obj.id),
      campus: (obj.campus || "seoul").trim(),
      map: (obj.map || "kagong").trim(),
      name: (obj.name || "").trim(),
      lat: parseFloat(obj.lat),
      lng: parseFloat(obj.lng),
      summary: (obj.summary || "").trim(),
      tags: Array.from(new Set(rawTags)),
      link:
        (obj.link || "").trim() ||
        `https://map.naver.com/p/search/${encodeURIComponent(obj.name || "")}`,
      _rawDays: rawDays,
      _rawHours: rawHours,
      _rawOutlets: rawOutlets,
      days: rawDays || fallbackMeta.days,
      hours: rawHours || fallbackMeta.hours,
      outlets: rawOutlets || fallbackMeta.outlets,
      status: (obj.status || "운영").trim() || "운영",
      verified_at: (obj.verified_at || "").trim(),
      hours_detail: (obj.hours_detail || "").trim(),
      break_time: (obj.break_time || "").trim(),
      last_order: (obj.last_order || "").trim(),
      closed_days: (obj.closed_days || "").trim(),
      note: (obj.note || "").trim(),
    };

    if (item.map === "kagong" && item.name && !Number.isNaN(item.lat) && !Number.isNaN(item.lng)) {
      parsedItems.push(item);
    }
  }

  return parsedItems;
}

function normalizePlaceNameKey(campus, name) {
  return `${campus}::${String(name || "")
    .replace(/\s+/g, "")
    .toLowerCase()}`;
}

async function loadPlacesData() {
  let localPlaces = [];
  try {
    const localRes = await fetch(LOCAL_CSV_URL);
    if (localRes.ok) {
      localPlaces = parseCSV(await localRes.text());
    }
  } catch (err) {
    console.warn("로컬 data.csv 로드 실패:", err);
  }

  const localById = new Map(localPlaces.map((p) => [p.id, p]));
  const localByName = new Map(
    localPlaces.map((p) => [normalizePlaceNameKey(p.campus, p.name), p])
  );

  if (GOOGLE_SHEET_CSV_URL && GOOGLE_SHEET_CSV_URL.trim()) {
    try {
      const sheetRes = await fetch(GOOGLE_SHEET_CSV_URL.trim());
      if (sheetRes.ok) {
        const sheetPlaces = parseCSV(await sheetRes.text());
        if (sheetPlaces.length > 0) {
          // 시트 데이터와 로컬 확장 스키마 병합 및 이름 중복 통합
          const mergedMap = new Map();

          sheetPlaces.forEach((item) => {
            const nameKey = normalizePlaceNameKey(item.campus, item.name);
            const localMatch =
              localById.get(item.id) || localByName.get(nameKey);

            const mergedTags = Array.from(
              new Set([
                ...(localMatch ? localMatch.tags : []),
                ...item.tags,
              ])
            );

            const enriched = {
              ...item,
              tags: mergedTags,
              days: item._rawDays || (localMatch && localMatch._rawDays) || item.days,
              hours: item._rawHours || (localMatch && localMatch._rawHours) || item.hours,
              outlets:
                item._rawOutlets ||
                (localMatch && localMatch._rawOutlets) ||
                item.outlets,
              status:
                item.status !== "운영"
                  ? item.status
                  : (localMatch && localMatch.status) || "운영",
              verified_at:
                item.verified_at || (localMatch && localMatch.verified_at) || "",
              hours_detail:
                item.hours_detail || (localMatch && localMatch.hours_detail) || "",
              break_time:
                item.break_time || (localMatch && localMatch.break_time) || "",
              last_order:
                item.last_order || (localMatch && localMatch.last_order) || "",
              closed_days:
                item.closed_days || (localMatch && localMatch.closed_days) || "",
              note: item.note || (localMatch && localMatch.note) || "",
            };

            if (mergedMap.has(nameKey)) {
              const prev = mergedMap.get(nameKey);
              prev.tags = Array.from(new Set([...prev.tags, ...enriched.tags]));
              if (enriched._rawDays && !prev._rawDays) prev.days = enriched.days;
              if (enriched._rawHours && !prev._rawHours) prev.hours = enriched.hours;
              if (enriched._rawOutlets && !prev._rawOutlets)
                prev.outlets = enriched.outlets;
            } else {
              mergedMap.set(nameKey, enriched);
            }
          });

          return window.HoursEngine.filterActivePlaces(
            Array.from(mergedMap.values())
          );
        }
      }
    } catch (sheetErr) {
      console.warn("구글 시트 로드 실패, 로컬 data.csv를 사용합니다:", sheetErr);
    }
  }

  return window.HoursEngine.filterActivePlaces(localPlaces);
}

// 10. URL 파라미터 동기화 (?campus=seoul|global&anchor=...&mood=...)
function syncStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const campusParam = params.get("campus");
  const anchorParam = params.get("anchor");
  const moodParam = params.get("mood");
  const radiusParam = params.get("radius");

  if (campusParam === "seoul" || campusParam === "global") {
    state.campus = campusParam;
  }

  const anchors = CAMPUS_ANCHORS[state.campus];
  const matchedAnchor = anchors.find((a) => a.key === anchorParam) || anchors[0];
  state.anchorKey = matchedAnchor.key;
  state.anchorCoord = {
    lat: matchedAnchor.lat,
    lng: matchedAnchor.lng,
    label: matchedAnchor.label,
  };

  if (moodParam && MOOD_CARDS.some((m) => m.id === moodParam)) {
    state.selectedMood = moodParam;
  }

  if (radiusParam !== null && ["300", "500", "1000", "0"].includes(radiusParam)) {
    state.radiusMeters = Number(radiusParam);
  }
}

function updateURLParams() {
  const url = new URL(window.location.href);
  url.searchParams.set("campus", state.campus);
  url.searchParams.set("anchor", state.anchorKey);
  if (state.selectedMood) {
    url.searchParams.set("mood", state.selectedMood);
  } else {
    url.searchParams.delete("mood");
  }
  window.history.replaceState({}, "", url.toString());
}

function getCanonicalShareUrl(placeId = null) {
  const shareUrl = new URL(CANONICAL_SERVICE_URL);
  shareUrl.searchParams.set("campus", state.campus);
  shareUrl.searchParams.set("anchor", state.anchorKey);
  if (state.selectedMood) {
    shareUrl.searchParams.set("mood", state.selectedMood);
  }
  if (placeId) {
    shareUrl.searchParams.set("place", String(placeId));
  }
  return shareUrl.toString();
}

// 11. 필터링 및 거리·영업상태 계산 파이프라인
function getBaseFilteredPlaces(refDate) {
  const activePlaces = window.HoursEngine.filterActivePlaces(state.places);

  return activePlaces
    .filter((p) => p.campus === state.campus)
    .map((p) => {
      const distance = getDistanceMeters(
        state.anchorCoord.lat,
        state.anchorCoord.lng,
        p.lat,
        p.lng
      );
      const businessStatus = window.HoursEngine.getPlaceBusinessStatus(
        p,
        refDate
      );
      return {
        ...p,
        distance,
        businessStatus,
      };
    })
    .filter((p) => {
      // 반경 필터
      if (state.radiusMeters > 0 && p.distance > state.radiusMeters) {
        return false;
      }
      // 영업 중만 토글
      if (state.openNowOnly && !p.businessStatus.isOpen) {
        return false;
      }
      return true;
    });
}

function applyMoodAndDetails(places, moodId, detailsSet, refDate) {
  const moodObj = moodId ? MOOD_CARDS.find((m) => m.id === moodId) : null;
  const activeConds = DETAIL_CONDITIONS.filter((c) => detailsSet.has(c.key));

  return places.filter((p) => {
    if (moodObj && !moodObj.match(p, refDate)) {
      return false;
    }
    for (let i = 0; i < activeConds.length; i++) {
      if (!activeConds[i].match(p, refDate)) {
        return false;
      }
    }
    return true;
  });
}

function getSortedDisplayPlaces(refDate) {
  const base = getBaseFilteredPlaces(refDate);
  const filtered = applyMoodAndDetails(
    base,
    state.selectedMood,
    state.selectedDetails,
    refDate
  );

  // 5-3절: 기본 정렬은 영업 중 우선 → 거리순
  return filtered.sort((a, b) => {
    if (a.businessStatus.isOpen !== b.businessStatus.isOpen) {
      return a.businessStatus.isOpen ? -1 : 1;
    }
    return a.distance - b.distance;
  });
}

// 12. 선 아이콘(Lucide SVG, stroke-width 1.75) 생성 헬퍼 (이모지 완전 배제)
function getFeatureIconSvg(type) {
  if (type === "outlet") {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5"></path><path d="M9 8V2"></path><path d="M15 8V2"></path><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"></path></svg>`;
  }
  if (type === "solo") {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
  }
  if (type === "quiet") {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="22" y1="9" x2="16" y2="15"></line><line x1="16" y1="9" x2="22" y2="15"></line></svg>`;
  }
  if (type === "group") {
    return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
  }
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 1 1 0 8h-1"></path><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path></svg>`;
}

function buildPlaceFeatureIconsHtml(place) {
  const features = [];
  if (place.tags.includes("콘센트많음")) {
    features.push({ icon: getFeatureIconSvg("outlet"), label: "콘센트" });
  }
  if (place.tags.includes("1인석")) {
    features.push({ icon: getFeatureIconSvg("solo"), label: "1인석" });
  }
  if (place.tags.includes("조용한")) {
    features.push({ icon: getFeatureIconSvg("quiet"), label: "조용" });
  }
  if (features.length < 3 && place.tags.includes("단체석")) {
    features.push({ icon: getFeatureIconSvg("group"), label: "단체석" });
  }

  return features
    .slice(0, 3)
    .map(
      (f) =>
        `<span class="feature-icon-item" title="${f.label}">${f.icon}<span>${f.label}</span></span>`
    )
    .join("");
}

// 13. 상황 카드 및 세부 조건 DOM 초기화 (최초 1회 생성 후 클래스·텍스트만 제자리 업데이트)
function mountMoodCardsOnce() {
  const track = document.getElementById("moodCardsTrack");
  if (!track || track.children.length > 0) return;

  const sparkleSvg = `
    <svg class="mood-sparkle-dot" viewBox="0 0 16 16" aria-hidden="true">
      <defs>
        <linearGradient id="rainbowSparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#F26B5E" />
          <stop offset="33%" stop-color="#F6C453" />
          <stop offset="67%" stop-color="#4D96FF" />
          <stop offset="100%" stop-color="#6BCB77" />
        </linearGradient>
      </defs>
      <path fill="url(#rainbowSparkleGrad)" d="M8 0L9.8 6.2L16 8L9.8 9.8L8 16L6.2 9.8L0 8L6.2 6.2Z" />
    </svg>
  `;

  MOOD_CARDS.forEach((mood) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mood-card";
    btn.dataset.moodId = mood.id;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", "false");
    btn.setAttribute("aria-label", mood.label);
    btn.innerHTML = `
      <span class="mood-card-text">${mood.label}</span>
      <span class="mood-card-meta">
        ${sparkleSvg}
        <span class="mood-count-badge" data-mood-count="${mood.id}">0곳</span>
      </span>
    `;
    track.appendChild(btn);
  });
}

function updateMoodCardsInPlace(refDate) {
  mountMoodCardsOnce();
  const basePlaces = getBaseFilteredPlaces(refDate);

  MOOD_CARDS.forEach((mood) => {
    const matching = applyMoodAndDetails(
      basePlaces,
      mood.id,
      state.selectedDetails,
      refDate
    );
    const count = matching.length;
    const cardEl = document.querySelector(`.mood-card[data-mood-id="${mood.id}"]`);
    if (!cardEl) return;

    const isSelected = state.selectedMood === mood.id;
    cardEl.classList.toggle("is-selected", isSelected);
    cardEl.classList.toggle("is-empty", count === 0 && !isSelected);
    cardEl.setAttribute("aria-checked", isSelected ? "true" : "false");
    cardEl.dataset.currentCount = String(count);

    const countEl = cardEl.querySelector(`[data-mood-count="${mood.id}"]`);
    if (countEl) {
      countEl.textContent = `${count}곳`;
    }
  });

  // 세부 조건 버튼 숫자 배지 업데이트
  const detailBtn = document.getElementById("btnOpenDetailFilter");
  const detailLabel = document.getElementById("detailFilterBtnLabel");
  const activeDetailCount = state.selectedDetails.size;
  if (detailBtn && detailLabel) {
    detailBtn.classList.toggle("has-active", activeDetailCount > 0);
    detailLabel.textContent =
      activeDetailCount > 0 ? `세부 조건 ${activeDetailCount}` : "세부 조건";
  }
}

function mountDetailChipsOnce() {
  const grid = document.getElementById("detailChipGrid");
  if (!grid || grid.children.length > 0) return;

  DETAIL_CONDITIONS.forEach((cond) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "detail-cond-chip";
    btn.dataset.condKey = cond.key;
    btn.setAttribute("aria-pressed", "false");
    btn.setAttribute("aria-label", cond.label);
    btn.innerHTML = `
      <span>${cond.label}</span>
      <span class="cond-remain-count" data-cond-count="${cond.key}">0곳</span>
    `;
    grid.appendChild(btn);
  });
}

function updateDetailChipsInPlace(refDate) {
  mountDetailChipsOnce();
  const basePlaces = getBaseFilteredPlaces(refDate);

  DETAIL_CONDITIONS.forEach((cond) => {
    const chipEl = document.querySelector(
      `.detail-cond-chip[data-cond-key="${cond.key}"]`
    );
    if (!chipEl) return;

    const isSelected = state.selectedDetails.has(cond.key);
    const hypotheticalSet = new Set(state.selectedDetails);
    hypotheticalSet.add(cond.key);

    const remaining = applyMoodAndDetails(
      basePlaces,
      state.selectedMood,
      hypotheticalSet,
      refDate
    ).length;

    chipEl.classList.toggle("is-selected", isSelected);
    chipEl.classList.toggle("is-zero", remaining === 0 && !isSelected);
    chipEl.setAttribute("aria-pressed", isSelected ? "true" : "false");
    chipEl.dataset.remainCount = String(remaining);

    const countSpan = chipEl.querySelector(`[data-cond-count="${cond.key}"]`);
    if (countSpan) {
      countSpan.textContent = `${remaining}곳`;
    }
  });
}

// 14. 상단 헤더, 기준점 드롭다운, 요정 인사말 렌더링
function renderControlsAndGreeting(displayedPlaces, refDate) {
  // 캠퍼스 세그먼트
  document.querySelectorAll(".campus-btn").forEach((btn) => {
    const active = btn.dataset.campus === state.campus;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  // 기준점 드롭다운 옵션 동기화
  const selectAnchor = document.getElementById("selectAnchor");
  if (selectAnchor) {
    const anchors = CAMPUS_ANCHORS[state.campus];
    const desiredValues = ["gps", ...anchors.map((a) => a.key)];
    const currentValues = Array.from(selectAnchor.options).map((o) => o.value);
    if (desiredValues.join(",") !== currentValues.join(",")) {
      selectAnchor.innerHTML = [
        `<option value="gps">내 위치</option>`,
        ...anchors.map(
          (a) => `<option value="${a.key}">${a.label}</option>`
        ),
      ].join("");
    }
    selectAnchor.value = state.anchorKey;
  }

  // 반경 드롭다운 동기화
  const selectRadius = document.getElementById("selectRadius");
  if (selectRadius) {
    selectRadius.value = String(state.radiusMeters);
  }

  // 방문 예정 시각 드롭다운 동기화
  const selectVisitTime = document.getElementById("selectVisitTime");
  if (selectVisitTime) {
    selectVisitTime.value = state.visitTimeMode;
  }

  // 영업 중만 스위치 동기화
  const btnOpenNow = document.getElementById("btnToggleOpenNow");
  if (btnOpenNow) {
    btnOpenNow.classList.toggle("active", state.openNowOnly);
    btnOpenNow.setAttribute("aria-checked", state.openNowOnly ? "true" : "false");
  }

  // 결과 요약 (예: "영업 중 8곳" 또는 "아침 9시 영업 18곳")
  const summaryEl = document.getElementById("resultCountSummary");
  if (summaryEl) {
    const openCount = displayedPlaces.filter((p) => p.businessStatus.isOpen).length;
    if (state.visitTimeMode === "morning09") {
      summaryEl.textContent = `아침 9시 영업 ${openCount}곳`;
    } else if (state.visitTimeMode === "afternoon14") {
      summaryEl.textContent = `낮 2시 영업 ${openCount}곳`;
    } else if (state.visitTimeMode === "tonight22") {
      summaryEl.textContent = `밤 10시 영업 ${openCount}곳`;
    } else {
      summaryEl.textContent = `영업 중 ${openCount}곳`;
    }
  }

  // 7-3절: 새벽 시간대에도 항상 요정 삼총사(fairy-trio.webp)가 큼직하고 입체적으로 등장 + 시간대 빠른 선택 동기화
  const greetingBar = document.getElementById("fairyGreetingBar");
  const greetingImg = document.getElementById("greetingFairyImg");
  const greetingText = document.getElementById("greetingText");
  if (greetingBar && greetingImg && greetingText) {
    if (state.greetingDismissed) {
      greetingBar.classList.add("hidden");
    } else {
      greetingBar.classList.remove("hidden");
      greetingImg.src = "./assets/fairy/fairy-trio.webp?v=20261102_3";
      const realSeoulNow = window.HoursEngine.getSeoulTimeParts(new Date());
      if (!state._customGreetingLocked) {
        if (realSeoulNow.hour >= 0 && realSeoulNow.hour < 7 && state.visitTimeMode === "now") {
          greetingText.textContent =
            "새벽이네요! 내일 아침 갈 카페를 미리 찾아볼까요?";
        } else if (state.visitTimeMode === "morning09") {
          greetingText.textContent =
            "아침 9시에 활짝 열려 있는 카페들을 모았어요!";
        } else if (state.visitTimeMode === "afternoon14") {
          greetingText.textContent =
            "오후 2시에 여유롭게 공부하기 좋은 곳들이에요!";
        } else if (state.visitTimeMode === "tonight22") {
          greetingText.textContent =
            "밤 10시에도 열려 있는 야간 카공 카페들이에요!";
        } else {
          greetingText.textContent = FAIRY_CHEER_MESSAGES[state.fairyCheerIndex];
        }
      }
    }
  }

  // 요정 인사 바 안의 빠른 시간대 알약 활성화 상태 동기화
  const quickTimeRow = document.getElementById("fairyQuickTimeRow");
  if (quickTimeRow) {
    quickTimeRow.querySelectorAll("[data-quick-time]").forEach((btn) => {
      const mode = btn.dataset.quickTime;
      const isActive =
        mode === "all_places"
          ? !state.openNowOnly
          : state.openNowOnly && state.visitTimeMode === mode;
      btn.classList.toggle("is-active", isActive);
    });
  }

  // Google AI Pro 링크 캠퍼스 UTM 업데이트
  const ctaLink = document.getElementById("geminiCtaLink");
  if (ctaLink) {
    ctaLink.href = `${GEMINI_BASE_URL}&utm_content=${state.campus}_kagong`;
  }
}

// 15. 5-3절: 컴팩트 목록 카드 렌더링 (높이 96~110px, 3줄 구성)
function renderPlaceList(displayedPlaces) {
  const container = document.getElementById("placeListContainer");
  if (!container) return;

  if (displayedPlaces.length === 0) {
    const reasonText = state.openNowOnly
      ? "여긴 아직 비어 있어요. 반경을 넓히거나 영업 종료된 곳도 함께 볼까요?"
      : "여긴 아직 비어 있어요. 반경을 넓혀볼까요?";

    container.innerHTML = `
      <div class="empty-state-box">
        <img
          src="./assets/fairy/fairy-sleep.webp?v=20261102_3"
          alt="별을 베고 졸고 있는 요정"
          class="empty-fairy-img fairy-float"
          id="emptySleepFairyImg"
          width="136"
          height="106"
          loading="lazy"
        />
        <p class="empty-state-title">${reasonText}</p>
        <p class="empty-state-sub">${state.anchorCoord.label} 기준 조건에 맞는 카페가 없어요.</p>
        <div class="empty-action-row">
          ${
            state.visitTimeMode !== "morning09"
              ? `<button type="button" class="secondary-pill-btn" id="btnEmptyMorning09" aria-label="내일 아침 9시 영업 카페 보기">내일 아침 9시 카페 보기</button>`
              : ""
          }
          ${
            state.radiusMeters !== 0
              ? `<button type="button" class="secondary-pill-btn" id="btnEmptyExpandRadius" aria-label="탐색 반경 전체로 넓히기">반경 넓히기</button>`
              : ""
          }
          ${
            state.openNowOnly
              ? `<button type="button" class="secondary-pill-btn" id="btnEmptyShowClosed" aria-label="영업 종료된 카페도 함께 보기">닫은 곳도 보기</button>`
              : ""
          }
          ${
            state.selectedMood || state.selectedDetails.size > 0
              ? `<button type="button" class="secondary-pill-btn" id="btnEmptyResetFilters" aria-label="선택한 조건 초기화">조건 초기화</button>`
              : ""
          }
        </div>
      </div>
    `;

    const emptyFairyImg = document.getElementById("emptySleepFairyImg");
    if (emptyFairyImg) {
      emptyFairyImg.addEventListener("click", () => {
        triggerFairySparkleAndHop(emptyFairyImg);
        showToast("요정이 깨어났어요! 반경을 넓히거나 닫은 곳도 함께 볼까요?");
      });
    }
    const btnEmptyMorning09 = document.getElementById("btnEmptyMorning09");
    if (btnEmptyMorning09) {
      btnEmptyMorning09.addEventListener("click", () => {
        state.visitTimeMode = "morning09";
        state.openNowOnly = true;
        state._customGreetingLocked = false;
        trackEvent("change_visit_time", { mode: "morning09", source: "empty_state" });
        renderAll(false);
      });
    }
    const btnExpand = document.getElementById("btnEmptyExpandRadius");
    if (btnExpand) {
      btnExpand.addEventListener("click", () => {
        state.radiusMeters = state.radiusMeters === 300 ? 500 : state.radiusMeters === 500 ? 1000 : 0;
        renderAll();
      });
    }
    const btnShowClosed = document.getElementById("btnEmptyShowClosed");
    if (btnShowClosed) {
      btnShowClosed.addEventListener("click", () => {
        state.openNowOnly = false;
        trackEvent("toggle_open_now", { open_now_only: false, source: "empty_state" });
        renderAll();
      });
    }
    const btnReset = document.getElementById("btnEmptyResetFilters");
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        state.selectedMood = null;
        state.selectedDetails.clear();
        renderAll();
      });
    }
    return;
  }

  container.innerHTML = displayedPlaces
    .map((place) => {
      const st = place.businessStatus;
      const isClosedCard = !st.isOpen;
      const distText = `${state.anchorCoord.label} ${formatDistanceLabel(place.distance)}`;
      const featureIconsHtml = buildPlaceFeatureIconsHtml(place);

      const statusBadgeHtml =
        st.state === "temp_closed"
          ? `<span class="gray-badge">임시휴업</span>`
          : `<span class="status-text state-${st.state}">${st.label}</span>`;

      return `
        <article
          class="place-card ${isClosedCard ? "is-closed-card" : ""}"
          data-place-id="${place.id}"
          role="listitem"
          tabindex="0"
          aria-label="${place.name}, ${distText}, ${st.label}"
        >
          <div class="card-row-1">
            <div class="card-title-group">
              <h3 class="card-place-name">${place.name}</h3>
            </div>
            <span class="card-distance">${distText}</span>
          </div>
          <div class="card-row-2">
            ${statusBadgeHtml}
          </div>
          <div class="card-row-3">
            ${
              featureIconsHtml
                ? `<div class="feature-icons-group">${featureIconsHtml}</div>`
                : ""
            }
            <p class="card-summary-one-line">${place.summary}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

// 16. 5-3 & 3-3절: 카페 상세 시트 렌더링 (요일별 영업시간 표, 확인일/신뢰도 배지, 외부 링크, 제보 링크)
function openPlaceDetail(placeId, panMap = true) {
  const refDate = getEffectiveReferenceDate();
  const activePlaces = window.HoursEngine.filterActivePlaces(state.places);
  const rawPlace = activePlaces.find((p) => p.id === Number(placeId));
  if (!rawPlace) return;

  state.selectedPlaceId = rawPlace.id;

  const distance = getDistanceMeters(
    state.anchorCoord.lat,
    state.anchorCoord.lng,
    rawPlace.lat,
    rawPlace.lng
  );
  const st = window.HoursEngine.getPlaceBusinessStatus(rawPlace, refDate);
  const verifiedInfo = window.HoursEngine.evaluateVerifiedAt(
    rawPlace.verified_at,
    refDate
  );
  const weeklyRows = window.HoursEngine.getFormattedWeeklyHours(rawPlace);
  const seoulNow = window.HoursEngine.getSeoulTimeParts(refDate);

  const listView = document.getElementById("sheetListView");
  const detailView = document.getElementById("sheetDetailView");
  if (!listView || !detailView) return;

  const naverUrl =
    rawPlace.link ||
    `https://map.naver.com/p/search/${encodeURIComponent(rawPlace.name)}`;
  const kakaoQuery = encodeURIComponent(
    `${rawPlace.campus === "seoul" ? "경희대 회기" : "경희대 영통"} ${rawPlace.name}`
  );
  const kakaoUrl = `https://map.kakao.com/?q=${kakaoQuery}`;

  const tagsHtml = rawPlace.tags
    .map((t) => {
      const label = TAG_DISPLAY_LABELS[t] || t;
      return `<span class="detail-tag-pill">${label}</span>`;
    })
    .join("");

  const weeklyTableHtml = weeklyRows
    .map((r) => {
      const isToday = r.dayIndex === seoulNow.dayOfWeek;
      return `
        <tr class="${isToday ? "is-today" : ""} ${r.isClosed ? "is-closed-day" : ""}">
          <td class="day-col">${r.dayLabel}${isToday ? " (오늘)" : ""}</td>
          <td>${r.timeLabel}</td>
        </tr>
      `;
    })
    .join("");

  const extraMetaRows = [];
  if (rawPlace.break_time) {
    extraMetaRows.push(`브레이크타임 ${rawPlace.break_time}`);
  }
  if (rawPlace.last_order) {
    extraMetaRows.push(`라스트오더 ${rawPlace.last_order}`);
  }
  if (rawPlace.closed_days) {
    extraMetaRows.push(`정기휴무 ${rawPlace.closed_days}`);
  }

  detailView.innerHTML = `
    <div class="detail-top-bar">
      <button type="button" class="back-list-btn" id="btnBackToList" aria-label="목록으로 돌아가기">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"></line>
          <polyline points="12 19 5 12 12 5"></polyline>
        </svg>
        <span>목록으로</span>
      </button>
      <div class="detail-top-actions">
        <button type="button" class="icon-btn" id="btnDetailShare" aria-label="이 카페 공유 링크 복사">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3"></circle>
            <circle cx="6" cy="12" r="3"></circle>
            <circle cx="18" cy="19" r="3"></circle>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
          </svg>
        </button>
      </div>
    </div>

    <div class="detail-header-block">
      <div class="detail-title-row">
        <h2 class="detail-place-name">${rawPlace.name}</h2>
        <span class="detail-distance">${state.anchorCoord.label} ${formatDistanceLabel(distance)}</span>
      </div>

      <div class="detail-status-row">
        ${
          st.state === "temp_closed"
            ? `<span class="gray-badge">임시휴업</span>`
            : `<span class="status-text state-${st.state}">${st.label}</span>`
        }
        <span class="detail-verified-row">
          <span>· ${verifiedInfo.relativeLabel}</span>
          ${
            verifiedInfo.isStale
              ? `<span class="gray-badge">정보 확인 필요</span>`
              : ""
          }
        </span>
      </div>

      <p class="detail-summary-text">${rawPlace.summary}</p>
      ${tagsHtml ? `<div class="detail-tag-row">${tagsHtml}</div>` : ""}
    </div>

    <div class="detail-info-section">
      <div class="detail-info-item">
        <span class="detail-info-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22v-5"></path>
            <path d="M9 8V2"></path>
            <path d="M15 8V2"></path>
            <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"></path>
          </svg>
        </span>
        <div class="detail-info-content">
          <div class="detail-info-label">콘센트 및 좌석 환경</div>
          <div class="detail-info-value">${rawPlace.outlets}</div>
        </div>
      </div>

      <div class="detail-info-item">
        <span class="detail-info-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        </span>
        <div class="detail-info-content">
          <div class="detail-info-label">요일별 영업시간</div>
          <table class="weekly-hours-table" aria-label="요일별 영업시간">
            <tbody>${weeklyTableHtml}</tbody>
          </table>
          ${
            extraMetaRows.length > 0
              ? `<div class="detail-verified-row" style="margin-top:6px;">${extraMetaRows.join(" · ")}</div>`
              : ""
          }
        </div>
      </div>

      ${
        rawPlace.note
          ? `
      <div class="detail-info-item">
        <span class="detail-info-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        </span>
        <div class="detail-info-content">
          <div class="detail-info-label">참고 사항</div>
          <div class="detail-info-value">${rawPlace.note}</div>
        </div>
      </div>`
          : ""
      }
    </div>

    <div class="detail-ext-links">
      <a
        href="${naverUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="ext-link-btn"
        data-ext-type="naver_map"
        aria-label="네이버 지도에서 사진 및 방문자 후기 보기"
      >
        <span>네이버 지도·후기</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="7" y1="17" x2="17" y2="7"></line>
          <polyline points="7 7 17 7 17 17"></polyline>
        </svg>
      </a>
      <a
        href="${kakaoUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="ext-link-btn"
        data-ext-type="kakao_map"
        aria-label="카카오맵에서 후기 및 위치 보기"
      >
        <span>카카오맵 후기</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="7" y1="17" x2="17" y2="7"></line>
          <polyline points="7 7 17 7 17 17"></polyline>
        </svg>
      </a>
    </div>

    ${
      REPORT_FORM_URL && REPORT_FORM_URL.trim()
        ? `
    <div class="detail-report-row">
      <a
        href="${REPORT_FORM_URL.trim()}"
        target="_blank"
        rel="noopener noreferrer"
        class="report-link-btn"
        id="btnReportInfo"
        aria-label="영업시간이나 정보가 다른 경우 제보하기"
      >
        <span>정보가 달라요 (수정 제보)</span>
      </a>
    </div>`
        : ""
    }
  `;

  listView.classList.add("hidden");
  detailView.classList.remove("hidden");

  // 마커 클릭 시 시트를 절반(half) 이상으로 올림
  if (state.sheetState === "peek") {
    setBottomSheetState("half");
  }

  highlightSelectedMarkerOnMap(rawPlace.id);
  if (panMap && leafletMap) {
    leafletMap.panTo([rawPlace.lat, rawPlace.lng], { animate: true });
  }

  const btnBack = document.getElementById("btnBackToList");
  if (btnBack) {
    btnBack.addEventListener("click", () => {
      closePlaceDetail();
    });
  }

  const btnDetailShare = document.getElementById("btnDetailShare");
  if (btnDetailShare) {
    btnDetailShare.addEventListener("click", () => {
      copyShareLink(rawPlace.id);
    });
  }

  const btnReport = document.getElementById("btnReportInfo");
  if (btnReport) {
    btnReport.addEventListener("click", (e) => {
      e.preventDefault();
      trackEvent("click_report", {
        place_id: rawPlace.id,
        place_name: rawPlace.name,
      });
      openReportModal(rawPlace);
    });
  }

  detailView.querySelectorAll("a[data-ext-type]").forEach((a) => {
    a.addEventListener("click", () => {
      trackEvent("place_click", {
        place_id: rawPlace.id,
        place_name: rawPlace.name,
        link_type: a.dataset.extType,
      });
    });
  });
}

function closePlaceDetail() {
  state.selectedPlaceId = null;
  const listView = document.getElementById("sheetListView");
  const detailView = document.getElementById("sheetDetailView");
  if (listView && detailView) {
    detailView.classList.add("hidden");
    listView.classList.remove("hidden");
  }
  highlightSelectedMarkerOnMap(null);
}

// 17. 5-2절: 지도 렌더링 (CARTO Positron 타일, 요정 얼굴 기준점 핀, 선택 마커만 라벨)
function initLeafletMapIfNeeded() {
  if (leafletMap || typeof window.L === "undefined") return;

  leafletMap = L.map("leafletMap", {
    zoomControl: false,
  }).setView([state.anchorCoord.lat, state.anchorCoord.lng], 15);

  // 채도 낮은 밝은 지도 (OpenStreetMap + Positron 톤 저채도 필터로 API 키 워터마크 없이 깔끔하게 표현)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(leafletMap);

  placeMarkersLayer = L.layerGroup().addTo(leafletMap);

  leafletMap.on("click", () => {
    if (state.selectedPlaceId !== null) {
      closePlaceDetail();
    }
  });
}

function highlightSelectedMarkerOnMap(selectedId) {
  markerElementsById.forEach((wrapEl, id) => {
    wrapEl.classList.toggle("is-selected", id === selectedId);
  });
}

function renderMapView(displayedPlaces) {
  initLeafletMapIfNeeded();
  if (!leafletMap) return;

  if (radiusCircle) {
    leafletMap.removeLayer(radiusCircle);
    radiusCircle = null;
  }
  if (anchorMarker) {
    leafletMap.removeLayer(anchorMarker);
    anchorMarker = null;
  }
  placeMarkersLayer.clearLayers();
  markerElementsById.clear();

  // 반경 원: 얇고 연하게
  if (state.radiusMeters > 0) {
    radiusCircle = L.circle([state.anchorCoord.lat, state.anchorCoord.lng], {
      radius: state.radiusMeters,
      color: "#111111",
      weight: 1.2,
      opacity: 0.25,
      dashArray: "5, 5",
      fillColor: "#111111",
      fillOpacity: 0.03,
    }).addTo(leafletMap);
  }

  // 기준점 마커: 큼직한 3D 요정 얼굴 핀 (fairy-head-pin.webp, 64x64) + 클릭 인터랙션
  const anchorIcon = L.divIcon({
    className: "fairy-anchor-marker",
    html: `
      <div class="fairy-anchor-ring fairy-float" id="mapFairyAnchorRing" title="${state.anchorCoord.label} 기준점 (눌러서 중심 맞추기)">
        <div class="fairy-anchor-inner">
          <img src="./assets/fairy/fairy-head-pin.webp?v=20261102_3" alt="${state.anchorCoord.label} 기준점" width="55" height="55" />
        </div>
      </div>
    `,
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  });

  anchorMarker = L.marker([state.anchorCoord.lat, state.anchorCoord.lng], {
    icon: anchorIcon,
    zIndexOffset: 900,
  }).addTo(leafletMap);

  anchorMarker.on("click", (e) => {
    L.DomEvent.stopPropagation(e);
    const ringEl = document.getElementById("mapFairyAnchorRing");
    triggerFairySparkleAndHop(ringEl);
    if (leafletMap) {
      leafletMap.panTo([state.anchorCoord.lat, state.anchorCoord.lng], {
        animate: true,
      });
    }
    const cheerMsg = cycleFairyCheerMessage(ringEl);
    showToast(`${state.anchorCoord.label} 요정: "${cheerMsg}"`);
  });

  const cupSvg = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h1a4 4 0 1 1 0 8h-1"></path><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"></path></svg>`;

  displayedPlaces.forEach((place) => {
    const st = place.businessStatus;
    const isSelected = place.id === state.selectedPlaceId;
    const isClosedPin = !st.isOpen;
    const isClosingSoon = st.state === "closing_soon";

    const markerHtml = `
      <div class="cafe-map-pin-wrap ${isSelected ? "is-selected" : ""}" data-marker-id="${place.id}">
        <span class="cafe-pin-label">${place.name}</span>
        <div class="cafe-map-pin ${isClosedPin ? "pin-closed" : ""}">
          ${cupSvg}
          ${isClosingSoon ? `<span class="pin-closing-dot" title="곧 마감"></span>` : ""}
        </div>
      </div>
    `;

    const icon = L.divIcon({
      className: "custom-cafe-pin-container",
      html: markerHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    const marker = L.marker([place.lat, place.lng], {
      icon,
      zIndexOffset: isSelected ? 800 : st.isOpen ? 400 : 100,
    }).addTo(placeMarkersLayer);

    marker.on("add", () => {
      const el = marker.getElement();
      if (el) {
        const wrap = el.querySelector(".cafe-map-pin-wrap");
        if (wrap) markerElementsById.set(place.id, wrap);
      }
    });

    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      trackEvent("place_click", {
        place_id: place.id,
        place_name: place.name,
        source: "map_marker",
      });
      openPlaceDetail(place.id, true);
    });
  });
}

// 18. 3단계 바텀시트 제어 (peek / half / full)
function setBottomSheetState(nextState) {
  const sheet = document.getElementById("mainBottomSheet");
  if (!sheet) return;

  state.sheetState = nextState;
  sheet.dataset.sheetState = nextState;
  sheet.classList.remove("sheet-peek", "sheet-half", "sheet-full");
  sheet.classList.add(`sheet-${nextState}`);

  trackEvent("view_toggle", {
    view_mode: nextState,
    source: "bottom_sheet",
  });
}

function initBottomSheetDrag() {
  const dragZone = document.getElementById("sheetDragZone");
  const sheet = document.getElementById("mainBottomSheet");
  if (!dragZone || !sheet) return;

  let startY = null;
  let startHeight = 0;
  let moved = false;

  const onPointerDown = (clientY) => {
    startY = clientY;
    startHeight = sheet.getBoundingClientRect().height;
    moved = false;
  };

  const onPointerMove = (clientY) => {
    if (startY === null) return;
    const deltaY = startY - clientY;
    if (Math.abs(deltaY) > 6) moved = true;
  };

  const onPointerUp = (clientY) => {
    if (startY === null) return;
    const deltaY = startY - clientY;
    startY = null;

    if (!moved) {
      // 탭/클릭 시 단계 순환: peek -> half -> full -> half
      if (state.sheetState === "peek") setBottomSheetState("half");
      else if (state.sheetState === "half") setBottomSheetState("full");
      else setBottomSheetState("peek");
      return;
    }

    if (deltaY > 45) {
      if (state.sheetState === "peek") setBottomSheetState("half");
      else setBottomSheetState("full");
    } else if (deltaY < -45) {
      if (state.sheetState === "full") setBottomSheetState("half");
      else setBottomSheetState("peek");
    }
  };

  dragZone.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 1) onPointerDown(e.touches[0].clientY);
    },
    { passive: true }
  );
  dragZone.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length === 1) onPointerMove(e.touches[0].clientY);
    },
    { passive: true }
  );
  dragZone.addEventListener("touchend", (e) => {
    const touch = e.changedTouches[0];
    onPointerUp(touch ? touch.clientY : startY);
  });

  dragZone.addEventListener("mousedown", (e) => onPointerDown(e.clientY));
  window.addEventListener("mousemove", (e) => onPointerMove(e.clientY));
  window.addEventListener("mouseup", (e) => onPointerUp(e.clientY));

  dragZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (state.sheetState === "peek") setBottomSheetState("half");
      else if (state.sheetState === "half") setBottomSheetState("full");
      else setBottomSheetState("peek");
    }
  });
}

// 19. 내 위치(GPS) 요청 및 로딩 표시 (fairy-fly.webp)
function setLoadingState(visible, message = "자리 알아보는 중…") {
  const pill = document.getElementById("loadingIndicator");
  const textEl = document.getElementById("loadingText");
  if (!pill) return;
  if (textEl) textEl.textContent = message;
  pill.classList.toggle("hidden", !visible);
}

function requestUserGPS() {
  if (!navigator.geolocation) {
    showToast("이 브라우저에서는 위치 기능을 지원하지 않아요.");
    return;
  }

  setLoadingState(true, "자리 알아보는 중…");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLoadingState(false);
      state.anchorKey = "gps";
      state.anchorCoord = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: "내 위치",
      };
      renderAll(true);
    },
    () => {
      setLoadingState(false);
      const fallback = CAMPUS_ANCHORS[state.campus][0];
      state.anchorKey = fallback.key;
      state.anchorCoord = {
        lat: fallback.lat,
        lng: fallback.lng,
        label: fallback.label,
      };
      showToast("위치 권한이 꺼져 있어 정문 기준으로 보여드려요.");
      renderAll(true);
    },
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

// 20. 공유 링크 복사 및 인앱/A2HS 안내 시트
function showToast(msg) {
  const toastEl = document.getElementById("toastPopup");
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2400);
}

async function copyShareLink(placeId = null) {
  const targetUrl = getCanonicalShareUrl(placeId);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(targetUrl);
    } else {
      throw new Error("clipboard fallback");
    }
  } catch {
    const tempInput = document.createElement("input");
    tempInput.value = targetUrl;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  }
  showToast("카공맵 링크가 복사되었어요.");
}

function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Instagram|KAKAOTALK|everytime|NAVER|Line|FBAN|FBAV/i.test(ua);
}

function showA2HSPopup(forceInAppMode = false) {
  const modal = document.getElementById("a2hsModal");
  const titleEl = document.getElementById("a2hsTitle");
  const subtitleEl = document.getElementById("a2hsSubtitle");
  const bodyEl = document.getElementById("a2hsInstructionBody");
  if (!modal || !bodyEl) return;

  const inApp = forceInAppMode === true || isInAppBrowser();
  if (inApp) {
    if (titleEl) {
      titleEl.textContent = "외부 브라우저로 열면 더 편해요";
    }
    if (subtitleEl) {
      subtitleEl.textContent =
        "인스타그램·카카오톡 인앱 브라우저에서는 내 위치 탐색과 홈 화면 추가가 제한될 수 있어요.";
    }
    bodyEl.innerHTML = `
      <ol class="a2hs-steps">
        <li><span class="step-num">1</span><span>우측 상단 또는 하단의 <strong>메뉴(⋯)</strong> 버튼을 눌러주세요.</span></li>
        <li><span class="step-num">2</span><span><strong>다른 브라우저로 열기(Safari / Chrome)</strong>를 선택해 주세요.</span></li>
        <li><span class="step-num">3</span><span>브라우저 공유 메뉴에서 <strong>홈 화면에 추가</strong>를 누르면 바로가기가 만들어져요.</span></li>
      </ol>
    `;
  } else {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (titleEl) {
      titleEl.textContent = "홈 화면에 카공맵 추가하기";
    }
    if (subtitleEl) {
      subtitleEl.textContent =
        "시험기간·공강 때마다 앱처럼 바로 열어 내 주변 카공 카페를 확인할 수 있어요.";
    }
    bodyEl.innerHTML = isIOS
      ? `
      <ol class="a2hs-steps">
        <li><span class="step-num">1</span><span>Safari 하단 바의 <strong>공유 버튼</strong>을 눌러주세요.</span></li>
        <li><span class="step-num">2</span><span>메뉴에서 <strong>홈 화면에 추가</strong>를 선택하면 완료돼요.</span></li>
      </ol>`
      : `
      <ol class="a2hs-steps">
        <li><span class="step-num">1</span><span>브라우저 우측 상단 <strong>메뉴(⋮)</strong> 버튼을 눌러주세요.</span></li>
        <li><span class="step-num">2</span><span><strong>홈 화면에 추가</strong> 또는 <strong>앱 설치</strong>를 선택하면 완료돼요.</span></li>
      </ol>`;
  }

  modal.classList.remove("hidden");
  trackEvent("a2hs_shown", { in_app: inApp });
}

window.showA2HSPopup = showA2HSPopup;

// 20-2. 3-3절: "정보가 달라요" 수정 제보 시트 열기 및 클립보드 복사 연동
let currentReportPlace = null;
let selectedReportType = "영업시간·휴무일이 달라요";

function openReportModal(place) {
  currentReportPlace = place;
  const modal = document.getElementById("reportModal");
  const titleEl = document.getElementById("reportModalTitle");
  const noteInput = document.getElementById("reportNoteInput");
  if (!modal) {
    if (REPORT_FORM_URL && REPORT_FORM_URL.trim()) {
      window.open(REPORT_FORM_URL.trim(), "_blank", "noopener,noreferrer");
    }
    return;
  }

  if (titleEl && place) {
    titleEl.textContent = `${place.name} · 정보가 달라요`;
  }
  if (noteInput) {
    noteInput.value = "";
  }
  modal.classList.remove("hidden");
}

// 21. 전체 UI 통합 렌더링
function renderAll(recenterMap = false) {
  updateURLParams();
  const refDate = getEffectiveReferenceDate();
  const displayedPlaces = getSortedDisplayPlaces(refDate);

  renderControlsAndGreeting(displayedPlaces, refDate);
  updateMoodCardsInPlace(refDate);
  updateDetailChipsInPlace(refDate);
  renderPlaceList(displayedPlaces);
  renderMapView(displayedPlaces);

  if (state.selectedPlaceId !== null) {
    openPlaceDetail(state.selectedPlaceId, false);
  }

  if (recenterMap && leafletMap) {
    setTimeout(() => {
      leafletMap.invalidateSize();
      if (radiusCircle) {
        leafletMap.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });
      } else {
        leafletMap.setView([state.anchorCoord.lat, state.anchorCoord.lng], 15);
      }
    }, 50);
  }
}

// 22. 이벤트 바인딩
function bindEvents() {
  // 캠퍼스 세그먼트 전환
  document.querySelectorAll(".campus-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextCampus = btn.dataset.campus;
      if (!nextCampus || nextCampus === state.campus) return;
      state.campus = nextCampus;
      const defaultAnchor = CAMPUS_ANCHORS[state.campus][0];
      state.anchorKey = defaultAnchor.key;
      state.anchorCoord = {
        lat: defaultAnchor.lat,
        lng: defaultAnchor.lng,
        label: defaultAnchor.label,
      };
      closePlaceDetail();
      trackEvent("campus_change", { campus: state.campus });
      renderAll(true);
    });
  });

  // 상단 메뉴 버튼 & 드롭다운
  const btnHeaderMenu = document.getElementById("btnHeaderMenu");
  const menuDropdown = document.getElementById("headerMenuDropdown");
  if (btnHeaderMenu && menuDropdown) {
    btnHeaderMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      const isHidden = menuDropdown.classList.toggle("hidden");
      btnHeaderMenu.setAttribute("aria-expanded", !isHidden ? "true" : "false");
    });
    document.addEventListener("click", () => {
      menuDropdown.classList.add("hidden");
      btnHeaderMenu.setAttribute("aria-expanded", "false");
    });
  }

  // 메뉴 항목: 공유 / 홈 화면 추가 / Google AI Pro 혜택
  const btnMenuShare = document.getElementById("btnMenuShare");
  if (btnMenuShare) {
    btnMenuShare.addEventListener("click", () => copyShareLink());
  }

  const btnMenuA2HS = document.getElementById("btnMenuA2HS");
  if (btnMenuA2HS) {
    btnMenuA2HS.addEventListener("click", () => showA2HSPopup(false));
  }

  const offerModal = document.getElementById("geminiOfferModal");
  const openOfferModal = (source) => {
    if (!offerModal) return;
    offerModal.classList.remove("hidden");
    trackEvent("cta_click", {
      campus: state.campus,
      utm_content: `${state.campus}_kagong`,
      source,
    });
  };

  const btnMenuOffer = document.getElementById("btnMenuOffer");
  if (btnMenuOffer) {
    btnMenuOffer.addEventListener("click", () => openOfferModal("header_menu"));
  }

  const btnOpenOfferFromList = document.getElementById("btnOpenOfferFromList");
  if (btnOpenOfferFromList) {
    btnOpenOfferFromList.addEventListener("click", () =>
      openOfferModal("sheet_subtle_banner")
    );
  }

  const btnCloseOfferSheet = document.getElementById("btnCloseOfferSheet");
  if (btnCloseOfferSheet && offerModal) {
    btnCloseOfferSheet.addEventListener("click", () =>
      offerModal.classList.add("hidden")
    );
    offerModal.addEventListener("click", (e) => {
      if (e.target === offerModal) offerModal.classList.add("hidden");
    });
  }

  // 요정 인사말 닫기 및 요정 클릭 인터랙션 (헤더 로고 요정 + 바텀시트 삼총사 요정)
  const btnDismissGreeting = document.getElementById("btnDismissGreeting");
  if (btnDismissGreeting) {
    btnDismissGreeting.addEventListener("click", () => {
      state.greetingDismissed = true;
      const bar = document.getElementById("fairyGreetingBar");
      if (bar) bar.classList.add("hidden");
    });
  }

  const brandFairyTrigger = document.getElementById("brandFairyTrigger");
  const headerFairyImg = document.getElementById("headerFairyImg");
  if (brandFairyTrigger) {
    brandFairyTrigger.addEventListener("click", () => {
      const msg = cycleFairyCheerMessage(headerFairyImg || brandFairyTrigger);
      const greetingImg = document.getElementById("greetingFairyImg");
      if (greetingImg) triggerFairySparkleAndHop(greetingImg);
      showToast(msg);
    });
  }

  const btnFairyCheer = document.getElementById("btnFairyCheer");
  const greetingTextTrigger = document.getElementById("greetingTextTrigger");
  const onGreetingFairyClick = () => {
    state._customGreetingLocked = true;
    const greetingImg = document.getElementById("greetingFairyImg");
    cycleFairyCheerMessage(greetingImg);
  };
  if (btnFairyCheer) {
    btnFairyCheer.addEventListener("click", onGreetingFairyClick);
  }
  if (greetingTextTrigger) {
    greetingTextTrigger.addEventListener("click", onGreetingFairyClick);
  }

  // 요정 인사 바 안의 1탭 빠른 시간대 선택 알약 (지금 / 내일 아침 9시 / 낮 2시 / 밤 10시 / 닫은 곳도 보기)
  const quickTimeRow = document.getElementById("fairyQuickTimeRow");
  if (quickTimeRow) {
    quickTimeRow.addEventListener("click", (e) => {
      const pill = e.target.closest("[data-quick-time]");
      if (!pill) return;
      const mode = pill.dataset.quickTime;
      const greetingImg = document.getElementById("greetingFairyImg");
      triggerFairySparkleAndHop(greetingImg);
      state._customGreetingLocked = false;

      if (mode === "all_places") {
        state.openNowOnly = !state.openNowOnly;
        trackEvent("toggle_open_now", {
          open_now_only: state.openNowOnly,
          source: "fairy_quick_pill",
        });
        showToast(
          state.openNowOnly
            ? "영업 중인 카페만 모아서 보여드려요."
            : "영업 종료된 카페도 모두 함께 보여드려요!"
        );
      } else {
        state.visitTimeMode = mode;
        state.openNowOnly = true;
        const customTimeInput = document.getElementById("customTimeInput");
        if (customTimeInput) customTimeInput.classList.add("hidden");
        trackEvent("change_visit_time", {
          mode,
          source: "fairy_quick_pill",
        });
        const labelMap = {
          now: "지금 열려 있는 카페 기준으로 보여드려요!",
          morning09: "내일 아침 9시에 문 여는 카페들을 찾았어요!",
          afternoon14: "낮 2시에 영업 중인 카페들을 찾았어요!",
          tonight22: "밤 10시에도 열려 있는 카페들을 찾았어요!",
        };
        if (labelMap[mode]) showToast(labelMap[mode]);
      }

      renderAll(false);
    });
  }

  // 4-1절: 상황 카드 클릭 (한 번에 하나만 선택, 다시 누르면 해제, 0곳 카드는 안내만 표시)
  const moodTrack = document.getElementById("moodCardsTrack");
  if (moodTrack) {
    moodTrack.addEventListener("click", (e) => {
      const card = e.target.closest(".mood-card");
      if (!card) return;

      const moodId = card.dataset.moodId;
      const count = Number(card.dataset.currentCount || "0");

      if (state.selectedMood === moodId) {
        state.selectedMood = null;
        trackEvent("select_mood", { mood: "none" });
        renderAll(false);
        return;
      }

      if (count === 0) {
        showToast("아직 등록된 곳이 없어요");
        trackEvent("select_mood", { mood: moodId, empty: true });
        return;
      }

      state.selectedMood = moodId;
      closePlaceDetail();
      trackEvent("select_mood", { mood: moodId, count });
      renderAll(false);
    });
  }

  // 4-2절: 세부 조건 모달 열기/닫기/선택/초기화
  const detailModal = document.getElementById("detailFilterModal");
  const btnOpenDetail = document.getElementById("btnOpenDetailFilter");
  const btnCloseDetail = document.getElementById("btnCloseDetailFilter");
  const btnApplyDetail = document.getElementById("btnApplyDetailFilter");
  const btnResetDetail = document.getElementById("btnResetDetailFilters");
  const detailGrid = document.getElementById("detailChipGrid");

  if (btnOpenDetail && detailModal) {
    btnOpenDetail.addEventListener("click", () => {
      updateDetailChipsInPlace(getEffectiveReferenceDate());
      detailModal.classList.remove("hidden");
      trackEvent("open_detail_filters", {
        active_count: state.selectedDetails.size,
      });
    });
  }

  if (btnCloseDetail && detailModal) {
    btnCloseDetail.addEventListener("click", () =>
      detailModal.classList.add("hidden")
    );
    detailModal.addEventListener("click", (e) => {
      if (e.target === detailModal) detailModal.classList.add("hidden");
    });
  }

  if (btnApplyDetail && detailModal) {
    btnApplyDetail.addEventListener("click", () =>
      detailModal.classList.add("hidden")
    );
  }

  if (btnResetDetail) {
    btnResetDetail.addEventListener("click", () => {
      state.selectedDetails.clear();
      trackEvent("filter_click", { action: "reset_detail_filters" });
      renderAll(false);
    });
  }

  if (detailGrid) {
    detailGrid.addEventListener("click", (e) => {
      const chip = e.target.closest(".detail-cond-chip");
      if (!chip) return;
      const key = chip.dataset.condKey;
      const remainCount = Number(chip.dataset.remainCount || "0");

      if (state.selectedDetails.has(key)) {
        state.selectedDetails.delete(key);
      } else {
        if (remainCount === 0) {
          showToast("선택 시 조건에 맞는 카페가 0곳이 돼요.");
          return;
        }
        state.selectedDetails.add(key);
      }

      trackEvent("filter_click", {
        tag: key,
        active_tags: Array.from(state.selectedDetails).join(","),
        active_count: state.selectedDetails.size,
      });
      renderAll(false);
    });
  }

  // 기준점 드롭다운 변경
  const selectAnchor = document.getElementById("selectAnchor");
  if (selectAnchor) {
    selectAnchor.addEventListener("change", () => {
      const val = selectAnchor.value;
      if (val === "gps") {
        requestUserGPS();
      } else {
        const found = CAMPUS_ANCHORS[state.campus].find((a) => a.key === val);
        if (found) {
          state.anchorKey = found.key;
          state.anchorCoord = {
            lat: found.lat,
            lng: found.lng,
            label: found.label,
          };
          closePlaceDetail();
          renderAll(true);
        }
      }
    });
  }

  // 반경 드롭다운 변경 (300m / 500m / 1km / 전체)
  const selectRadius = document.getElementById("selectRadius");
  if (selectRadius) {
    selectRadius.addEventListener("change", () => {
      state.radiusMeters = Number(selectRadius.value);
      closePlaceDetail();
      renderAll(true);
    });
  }

  // 언제 갈 거예요? 시간 선택 변경
  const selectVisitTime = document.getElementById("selectVisitTime");
  const customTimeInput = document.getElementById("customTimeInput");
  if (selectVisitTime) {
    selectVisitTime.addEventListener("change", () => {
      state.visitTimeMode = selectVisitTime.value;
      if (customTimeInput) {
        customTimeInput.classList.toggle(
          "hidden",
          state.visitTimeMode !== "custom"
        );
      }
      trackEvent("change_visit_time", {
        mode: state.visitTimeMode,
        custom_time: state.customTimeValue,
      });
      renderAll(false);
    });
  }

  if (customTimeInput) {
    customTimeInput.addEventListener("change", () => {
      state.customTimeValue = customTimeInput.value || "23:00";
      trackEvent("change_visit_time", {
        mode: "custom",
        custom_time: state.customTimeValue,
      });
      renderAll(false);
    });
  }

  // 지금 영업 중만 토글
  const btnToggleOpenNow = document.getElementById("btnToggleOpenNow");
  if (btnToggleOpenNow) {
    btnToggleOpenNow.addEventListener("click", () => {
      state.openNowOnly = !state.openNowOnly;
      trackEvent("toggle_open_now", { open_now_only: state.openNowOnly });
      renderAll(false);
    });
  }

  // 목록 카드 클릭 -> 상세 시트 오픈
  const listContainer = document.getElementById("placeListContainer");
  if (listContainer) {
    listContainer.addEventListener("click", (e) => {
      const card = e.target.closest(".place-card");
      if (!card) return;
      const id = Number(card.dataset.placeId);
      trackEvent("place_click", {
        place_id: id,
        source: "sheet_list_card",
      });
      openPlaceDetail(id, true);
    });

    listContainer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        const card = e.target.closest(".place-card");
        if (!card) return;
        e.preventDefault();
        openPlaceDetail(Number(card.dataset.placeId), true);
      }
    });
  }

  // 지도 우측 하단 커스텀 버튼 (내 위치 / 확대 / 축소)
  const btnMyLoc = document.getElementById("btnMapMyLocation");
  if (btnMyLoc) {
    btnMyLoc.addEventListener("click", () => requestUserGPS());
  }
  const btnZoomIn = document.getElementById("btnMapZoomIn");
  if (btnZoomIn) {
    btnZoomIn.addEventListener("click", () => {
      if (leafletMap) leafletMap.zoomIn();
    });
  }
  const btnZoomOut = document.getElementById("btnMapZoomOut");
  if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
      if (leafletMap) leafletMap.zoomOut();
    });
  }

  // A2HS 모달 닫기 및 복사
  const a2hsModal = document.getElementById("a2hsModal");
  const btnCloseA2HS = document.getElementById("btnCloseA2HS");
  const btnA2HSCopyLink = document.getElementById("btnA2HSCopyLink");
  if (btnCloseA2HS && a2hsModal) {
    btnCloseA2HS.addEventListener("click", () =>
      a2hsModal.classList.add("hidden")
    );
    a2hsModal.addEventListener("click", (e) => {
      if (e.target === a2hsModal) a2hsModal.classList.add("hidden");
    });
  }
  if (btnA2HSCopyLink) {
    btnA2HSCopyLink.addEventListener("click", () => copyShareLink());
  }

  // 3-3절: 정보가 달라요 (제보 모달) 이벤트 바인딩
  const reportModal = document.getElementById("reportModal");
  const btnCloseReportModal = document.getElementById("btnCloseReportModal");
  const reportTypeGrid = document.getElementById("reportTypeGrid");
  const btnSubmitReportSheet = document.getElementById("btnSubmitReportSheet");
  const reportNoteInput = document.getElementById("reportNoteInput");

  if (btnCloseReportModal && reportModal) {
    btnCloseReportModal.addEventListener("click", () =>
      reportModal.classList.add("hidden")
    );
    reportModal.addEventListener("click", (e) => {
      if (e.target === reportModal) reportModal.classList.add("hidden");
    });
  }

  if (reportTypeGrid) {
    reportTypeGrid.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-report-type]");
      if (!chip) return;
      selectedReportType = chip.dataset.reportType;
      reportTypeGrid.querySelectorAll("[data-report-type]").forEach((el) => {
        el.classList.toggle("is-selected", el === chip);
      });
    });
  }

  if (btnSubmitReportSheet) {
    btnSubmitReportSheet.addEventListener("click", async () => {
      const placeName = currentReportPlace ? currentReportPlace.name : "카페";
      const campusLabel =
        currentReportPlace && currentReportPlace.campus === "global"
          ? "국제캠"
          : "서울캠";
      const noteText = reportNoteInput ? reportNoteInput.value.trim() : "";
      const summaryLine = `[카공맵 정보 수정 제보] (${campusLabel}) ${placeName} - ${selectedReportType}${
        noteText ? ` : ${noteText}` : ""
      }`;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(summaryLine);
        }
      } catch {
        // clipboard fallback 생략 가능
      }

      showToast("제보 내용이 복사되었어요. 시트 또는 폼에 붙여넣어 주세요!");
      if (reportModal) reportModal.classList.add("hidden");

      if (REPORT_FORM_URL && REPORT_FORM_URL.trim()) {
        window.open(REPORT_FORM_URL.trim(), "_blank", "noopener,noreferrer");
      }
    });
  }
}

// 23. 앱 초기화 및 1분 주기 영업시간 상태 갱신
async function initApp() {
  initGA4();
  syncStateFromURL();
  mountMoodCardsOnce();
  mountDetailChipsOnce();
  initBottomSheetDrag();
  bindEvents();

  setLoadingState(true, "자리 알아보는 중…");
  try {
    state.places = await loadPlacesData();
  } catch (err) {
    console.error("데이터 로드 오류:", err);
  } finally {
    setLoadingState(false);
  }

  renderAll(true);

  const params = new URLSearchParams(window.location.search);
  const initialPlaceId = Number(params.get("place"));
  if (initialPlaceId) {
    openPlaceDetail(initialPlaceId, true);
  }

  trackEvent("page_view", {
    campus: state.campus,
    mood: state.selectedMood || "none",
  });

  // 3-2절: 상태는 1분마다 다시 계산 (페이지를 켜둔 채 시간이 지나도 정확히 반영)
  if (refreshTimerId) clearInterval(refreshTimerId);
  refreshTimerId = setInterval(() => {
    renderAll(false);
  }, 60000);
}

document.addEventListener("DOMContentLoaded", initApp);
