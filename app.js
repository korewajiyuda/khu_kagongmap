/**
 * ☕ 경희대 카공맵 (단독 웹앱) - app.js
 * [5대 요구사항 완벽 반영 버전]
 * 1) 초기 진입 화면: 지도 뷰 우선 노출 (viewMode: 'map' 기본값 + 바텀시트/플로팅/탭에서 목록 뷰 전환)
 * 2) 사진 및 후기 영역 외부 링크 연동 (네이버 지도 사진/방문자 리뷰 & 카카오맵 후기 새 창 이동)
 * 3) 공유 숏링크 정규화 (제미나이 링크 제거 -> https://korewajiyuda.github.io/khu_kagongmap/?campus=...)
 * 4) 태그 다중 선택(Multi-select) AND 교집합 필터링 고도화 (이벤트 위임 및 정규화 비교)
 * 5) 장소 상세 메타데이터 추가 반영 (운영 날짜 days, 운영 시간 hours, 콘센트 유무/개수 outlets)
 */

// 1. 구글 시트 CSV 연동 상수 (실패 또는 추가 컬럼 누락 시 로컬 data.csv 메타데이터와 자동 병합/Fallback)
const GOOGLE_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1td87-lDak8Cj8abo_qKMiARD8rXJ14Mwr4g3rknZJLU/export?format=csv";
const LOCAL_CSV_URL = "./data.csv";

// 요구사항 3: 정규 공유 도메인 상수 (제미나이 링크 완전 제거)
const CANONICAL_SERVICE_URL = "https://korewajiyuda.github.io/khu_kagongmap/";

// 하단 고정 CTA용 공식 학생 혜택 URL
const GEMINI_BASE_URL =
  "https://gemini.google/students/?utm_source=student&utm_medium=social&utm_campaign=microsite_campus_kyunghee-ambassador";
const DEFAULT_RADIUS_METERS = 500;

// 2. 캠퍼스별 기준점 6곳 위·경도 좌표
const CAMPUS_ANCHORS = {
  seoul: [
    { key: "main_gate", label: "정문", lat: 37.5939, lng: 127.0530 },
    { key: "back_gate", label: "후문", lat: 37.5947, lng: 127.0578 },
    { key: "hoegi_stn", label: "회기역", lat: 37.5898, lng: 127.0579 },
  ],
  global: [
    { key: "main_gate", label: "정문", lat: 37.2460, lng: 127.0780 },
    { key: "sasaek_sq", label: "사색의광장", lat: 37.2415, lng: 127.0815 },
    { key: "yeongtong_stn", label: "영통역", lat: 37.2515, lng: 127.0713 },
  ],
};

// 3. 카공맵 전용 다중 선택 필터 칩 정의
const KAGONG_FILTER_TAGS = [
  "콘센트많음",
  "조용한",
  "밤늦게까지",
  "24시간",
  "교내카페",
  "1인석",
];

// 4. 애플리케이션 상태 (요구사항 1: 초기 진입 시 'map' 뷰 우선 노출)
const state = {
  places: [],
  campus: "seoul", // 'seoul' | 'global'
  mapType: "kagong",
  anchorKey: "main_gate",
  anchorCoord: { lat: 37.5939, lng: 127.0530, label: "정문" },
  radiusLimitEnabled: true,
  selectedTags: new Set(), // 다중 선택 태그 Set (AND 조건)
  viewMode: "map", // 기본값을 'list'가 아닌 'map'으로 변경!
  initialMarkerId: null,
};

let leafletMap = null;
let radiusCircle = null;
let anchorMarker = null;
let placeMarkersLayer = null;

// 5. GA4 이벤트 트래킹 래퍼 함수
function trackEvent(eventName, params = {}) {
  const payload = {
    campus: state.campus,
    map: "kagong",
    ...params,
  };
  console.log("[GA4]", eventName, payload);

  if (typeof window.gtag === "function") {
    window.gtag("event", eventName, payload);
  } else if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: eventName, ...payload });
  }
}

// 6. 하버사인(Haversine) 거리 계산 공식 (단위: m)
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

// 요구사항 5: 태그 기반 기본 메타데이터 추론 헬퍼 (구글 시트에 컬럼이 아직 없을 경우 자동 보완)
function inferDefaultMetadata(tags, name) {
  const tagSet = new Set(tags);
  let days = "매일 (연중무휴)";
  let hours = "09:00 ~ 22:00";
  let outlets = "창가 및 벽면 좌석 콘센트 구비";

  if (tagSet.has("교내카페")) {
    days = "평일 운영 (주말·공휴일 휴무)";
    hours = "08:00 ~ 19:00";
    outlets = "창가 바테이블 및 로비 벽면 일부 구비";
  } else if (tagSet.has("24시간")) {
    days = "매일 (연중무휴)";
    hours = "24시간 영업";
    outlets = "전 좌석 또는 카공석 1인 1콘센트 완비";
  } else if (tagSet.has("밤늦게까지")) {
    hours = "08:30 ~ 23:30";
  }

  if (tagSet.has("콘센트많음") && tagSet.has("1인석")) {
    outlets = "1인 카공석 및 테이블별 개별 콘센트 다수 완비";
  } else if (tagSet.has("콘센트많음")) {
    outlets = "카공존 및 벽면·바테이블 좌석당 콘센트 넉넉함";
  } else if (tagSet.has("1인석")) {
    outlets = "1인 집중석 및 벽면 좌석 콘센트 구비";
  }

  return { days, hours, outlets };
}

// 요구사항 2: 사진 및 후기 외부 리뷰 페이지 링크 생성 헬퍼
function buildExternalReviewLinks(place) {
  const baseSearchQuery = encodeURIComponent(
    `${place.campus === "seoul" ? "경희대 회기" : "경희대 국제캠 영통"} ${place.name}`
  );
  const naverMainUrl =
    place.link || `https://map.naver.com/p/search/${encodeURIComponent(place.name)}`;
  // 네이버 플레이스 사진/리뷰 검색 및 카카오맵 후기 페이지 연동
  const photoReviewUrl = naverMainUrl;
  const kakaoReviewUrl = `https://map.kakao.com/?q=${baseSearchQuery}`;

  return {
    naverMainUrl,
    photoReviewUrl,
    kakaoReviewUrl,
  };
}

// 7. 안전한 CSV 파서 & 메타데이터(days, hours, outlets) 파싱
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

function parseCSV(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines
    .slice(1)
    .map((line) => {
      const cols = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] ?? "";
      });

      const rawTags = obj.tags
        ? obj.tags
            .split(",")
            .map((t) => normalizeTag(t))
            .filter(Boolean)
        : [];

      const fallbackMeta = inferDefaultMetadata(rawTags, obj.name);

      return {
        id: Number(obj.id),
        campus: (obj.campus || "seoul").trim(),
        map: (obj.map || "kagong").trim(),
        name: (obj.name || "").trim(),
        lat: parseFloat(obj.lat),
        lng: parseFloat(obj.lng),
        summary: (obj.summary || "").trim(),
        tags: rawTags,
        link:
          (obj.link || "").trim() ||
          `https://map.naver.com/p/search/${encodeURIComponent(obj.name)}`,
        days: (obj.days || "").trim() || fallbackMeta.days,
        hours: (obj.hours || "").trim() || fallbackMeta.hours,
        outlets: (obj.outlets || "").trim() || fallbackMeta.outlets,
      };
    })
    .filter((item) => item.map === "kagong" && !Number.isNaN(item.lat));
}

async function loadPlacesData() {
  // 로컬 data.csv를 먼저 읽어 상세 메타데이터(days, hours, outlets) 사전 구축
  let localPlaces = [];
  try {
    const localRes = await fetch(LOCAL_CSV_URL);
    if (localRes.ok) {
      localPlaces = parseCSV(await localRes.text());
    }
  } catch (e) {
    console.warn("로컬 data.csv 로드 중 경고:", e);
  }

  const localMetaById = new Map(localPlaces.map((p) => [p.id, p]));

  if (GOOGLE_SHEET_CSV_URL && GOOGLE_SHEET_CSV_URL.trim().length > 0) {
    try {
      const sheetRes = await fetch(GOOGLE_SHEET_CSV_URL.trim());
      if (sheetRes.ok) {
        const sheetCsv = await sheetRes.text();
        const parsedSheet = parseCSV(sheetCsv);
        if (parsedSheet.length > 0) {
          // 구글 시트에 days/hours/outlets 컬럼이 비어 있으면 로컬 상세 메타데이터로 보강
          return parsedSheet.map((item) => {
            const localMatch = localMetaById.get(item.id);
            if (!localMatch) return item;
            return {
              ...item,
              days: item.days || localMatch.days,
              hours: item.hours || localMatch.hours,
              outlets: item.outlets || localMatch.outlets,
            };
          });
        }
      }
    } catch (sheetErr) {
      console.warn(
        "구글 시트 CSV 로드 실패, 로컬 data.csv로 Fallback 합니다:",
        sheetErr
      );
    }
  }

  return localPlaces;
}

// 8. URL 파라미터 초기화 및 동기화 (요구사항 1: 기본 뷰 모드는 항상 'map')
function syncStateFromURL() {
  const params = new URLSearchParams(window.location.search);
  const campusParam = params.get("campus");
  const anchorParam = params.get("anchor");
  const viewParam = params.get("view");
  const markerParam = params.get("marker");

  state.mapType = "kagong";

  if (campusParam === "seoul" || campusParam === "global") {
    state.campus = campusParam;
  }

  // URL에 ?view=list가 명시된 경우에만 목록 뷰, 그 외 모든 초기 진입은 'map' 우선 노출!
  if (viewParam === "list") {
    state.viewMode = "list";
  } else {
    state.viewMode = "map";
  }

  const anchors = CAMPUS_ANCHORS[state.campus];
  const matchedAnchor =
    anchors.find((a) => a.key === anchorParam) || anchors[0];
  state.anchorKey = matchedAnchor.key;
  state.anchorCoord = {
    lat: matchedAnchor.lat,
    lng: matchedAnchor.lng,
    label: matchedAnchor.label,
  };
  state.initialMarkerId = markerParam ? Number(markerParam) : null;
}

function updateURLParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete("map");
  url.searchParams.set("campus", state.campus);
  window.history.replaceState({}, "", url.toString());

  // 푸터 공유 링크 프리뷰도 현재 캠퍼스에 맞춰 갱신
  const previewEl = document.getElementById("shareUrlPreview");
  if (previewEl) {
    previewEl.textContent = `korewajiyuda.github.io/khu_kagongmap/?campus=${state.campus}`;
  }
}

// 요구사항 3: 정규 서비스 도메인 공유 링크 생성 함수 (제미나이 링크 완전 제거)
function getCanonicalShareUrl() {
  const shareUrl = new URL(CANONICAL_SERVICE_URL);
  shareUrl.searchParams.set("campus", state.campus);
  if (state.anchorKey && state.anchorKey !== "gps") {
    shareUrl.searchParams.set("anchor", state.anchorKey);
  }
  return shareUrl.toString();
}

// 9. 하단 고정 CTA 버튼 동적 UTM 업데이트
function updateFixedCTA() {
  const ctaEl = document.getElementById("geminiCtaLink");
  const badgeEl = document.getElementById("ctaUtmBadge");
  if (!ctaEl) return;

  const utmContent = `${state.campus}_kagong`;
  ctaEl.href = `${GEMINI_BASE_URL}&utm_content=${utmContent}`;

  if (badgeEl) {
    const campusLabel = state.campus === "seoul" ? "서울캠" : "국제캠";
    badgeEl.textContent = `${campusLabel} 전용`;
  }
}

// 10. 상단 헤더 렌더링
function renderHeader() {
  const titleEl = document.getElementById("headerTitle");
  if (titleEl) {
    titleEl.textContent = "☕ 경희대 카공맵";
  }

  document.querySelectorAll(".campus-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.campus === state.campus);
  });
}

// 11. 기준점 알약(Pill) 컨트롤 렌더링
function renderAnchorControls() {
  const container = document.getElementById("anchorButtonGroup");
  const labelEl = document.getElementById("currentAnchorLabel");
  const radiusBadgeEl = document.getElementById("radiusBadge");
  const toggleBtnEl = document.getElementById("btnToggleRadius");

  const campusName = state.campus === "seoul" ? "서울캠" : "국제캠";
  if (labelEl) {
    labelEl.innerHTML = `${campusName} · <strong>${state.anchorCoord.label}</strong>`;
  }

  if (radiusBadgeEl) {
    if (state.radiusLimitEnabled) {
      radiusBadgeEl.textContent = "500m 내";
      radiusBadgeEl.classList.remove("all-mode");
    } else {
      radiusBadgeEl.textContent = "캠퍼스 전체";
      radiusBadgeEl.classList.add("all-mode");
    }
  }

  if (toggleBtnEl) {
    toggleBtnEl.classList.toggle("active", !state.radiusLimitEnabled);
    toggleBtnEl.textContent = state.radiusLimitEnabled
      ? "전체 거리순"
      : "반경 500m만";
  }

  if (!container) return;
  const anchors = CAMPUS_ANCHORS[state.campus];

  let html = `
    <button type="button" class="anchor-btn ${state.anchorKey === "gps" ? "active" : ""}" data-anchor="gps">
      📍 내 위치
    </button>
  `;

  anchors.forEach((a) => {
    const isActive = state.anchorKey === a.key;
    html += `
      <button type="button" class="anchor-btn ${isActive ? "active" : ""}" data-anchor="${a.key}">
        ${a.label}
      </button>
    `;
  });

  container.innerHTML = html;
}

// 12. 내 위치(GPS) 요청 및 거절/인앱 차단 시 대체 처리
function requestUserGPS() {
  if (!navigator.geolocation) {
    showToast("위치 기능을 지원하지 않아 거점 기준으로 표시합니다.");
    return;
  }

  showToast("내 위치를 확인 중입니다...");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.anchorKey = "gps";
      state.anchorCoord = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: "내 위치",
      };
      showToast("내 위치 기준 반경 500m로 정렬했습니다.");
      renderAll();
    },
    () => {
      const fallback = CAMPUS_ANCHORS[state.campus][0];
      state.anchorKey = fallback.key;
      state.anchorCoord = {
        lat: fallback.lat,
        lng: fallback.lng,
        label: fallback.label,
      };
      showToast(`위치 권한이 제한되어 [${fallback.label}] 기준으로 안내합니다.`);
      renderAll();
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}

// 13. 요구사항 4: 다중 선택(Multi-select) 필터 칩 렌더링 (중복 클릭 및 선택 개수 표시)
function renderFilterChips() {
  const container = document.getElementById("filterChipContainer");
  if (!container) return;

  let html = "";

  if (state.selectedTags.size > 0) {
    html += `<button type="button" class="filter-reset-chip" data-action="reset-filters">초기화 (${state.selectedTags.size}) ✕</button>`;
  }

  KAGONG_FILTER_TAGS.forEach((tag) => {
    const normalized = normalizeTag(tag);
    const isActive = state.selectedTags.has(normalized);
    html += `
      <button
        type="button"
        class="filter-chip ${isActive ? "active" : ""}"
        data-tag="${normalized}"
        aria-pressed="${isActive}"
      >
        ${isActive ? '<span class="check-mark">✓</span>' : ""}#${normalized}
      </button>
    `;
  });

  container.innerHTML = html;
}

// 14. 요구사항 4: 다중 선택 태그 AND 조건 필터링 및 거리순 정렬
function getFilteredPlaces() {
  const { campus, anchorCoord, radiusLimitEnabled, selectedTags } = state;
  const activeTagArray = Array.from(selectedTags).map((t) => normalizeTag(t));

  const baseList = state.places
    .filter((p) => p.campus === campus && p.map === "kagong")
    .map((p) => {
      const distance = getDistanceMeters(
        anchorCoord.lat,
        anchorCoord.lng,
        p.lat,
        p.lng
      );
      return { ...p, distance };
    });

  // 선택한 모든 태그를 포함(every -> AND 교집합 조건)하는 장소만 필터링
  const tagFiltered = baseList.filter((place) => {
    if (activeTagArray.length === 0) return true;
    const placeTagSet = new Set((place.tags || []).map((t) => normalizeTag(t)));
    return activeTagArray.every((selectedTag) => placeTagSet.has(selectedTag));
  });

  tagFiltered.sort((a, b) => a.distance - b.distance);

  const withinRadius = tagFiltered.filter(
    (p) => p.distance <= DEFAULT_RADIUS_METERS
  );

  return {
    displayed: radiusLimitEnabled ? withinRadius : tagFiltered,
    totalInCampus: tagFiltered.length,
    withinRadiusCount: withinRadius.length,
  };
}

// 15. 요구사항 2 & 5: 장소 상세 카드 목록 렌더링 (메타데이터 그리드 + 사진/후기 외부 링크)
function renderPlaceList(filteredResult) {
  const listEl = document.getElementById("placeListContainer");
  const countEl = document.getElementById("placeCount");

  const { displayed, totalInCampus } = filteredResult;
  if (countEl) countEl.textContent = String(displayed.length);

  if (!listEl) return;

  if (displayed.length === 0) {
    const activeTagsText =
      state.selectedTags.size > 0
        ? `선택한 태그(${Array.from(state.selectedTags)
            .map((t) => "#" + t)
            .join(" + ")})를 모두 만족하는`
        : "반경 500m 내 조건에 맞는";

    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔭</div>
        <h3>${activeTagsText} 카페가 없어요</h3>
        <p>반경 제한을 해제하거나 태그 필터를 조정해 보세요! (캠퍼스 내 조건 일치 ${totalInCampus}곳)</p>
        <button type="button" class="empty-expand-btn" id="btnEmptyExpand">
          ${state.radiusLimitEnabled && totalInCampus > 0 ? `캠퍼스 전체 거리순 보기 (${totalInCampus}곳)` : "필터 초기화하고 전체 보기"}
        </button>
      </div>
    `;
    const expandBtn = document.getElementById("btnEmptyExpand");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => {
        if (state.radiusLimitEnabled && totalInCampus > 0) {
          state.radiusLimitEnabled = false;
        } else {
          state.selectedTags.clear();
          state.radiusLimitEnabled = false;
        }
        renderAll();
      });
    }
    return;
  }

  listEl.innerHTML = displayed
    .map((place) => {
      const distText =
        place.distance >= 1000
          ? `${(place.distance / 1000).toFixed(1)}km`
          : `${place.distance}m`;
      const distClass = place.distance <= DEFAULT_RADIUS_METERS ? "" : "far";

      const tagsHtml = place.tags
        .map((t) => {
          const isMatched = state.selectedTags.has(normalizeTag(t));
          return `<span class="tag-pill ${isMatched ? "matched" : ""}">#${t}</span>`;
        })
        .join("");

      const { naverMainUrl, photoReviewUrl, kakaoReviewUrl } =
        buildExternalReviewLinks(place);

      return `
        <article class="place-card" data-place-id="${place.id}" data-place-name="${place.name}">
          <div class="card-top">
            <div class="place-name-wrap">
              <a href="${naverMainUrl}" target="_blank" rel="noopener noreferrer" class="place-name-link">
                <h2 class="place-name">${place.name}</h2>
              </a>
            </div>
            <span class="distance-badge ${distClass}">${state.anchorCoord.label} ${distText}</span>
          </div>

          <!-- 요구사항 5: 운영 날짜 · 운영 시간 · 콘센트 유무/개수 메타데이터 영역 -->
          <div class="place-meta-grid">
            <div class="meta-item">
              <span class="meta-label">🗓️ 운영 날짜</span>
              <span class="meta-value">${place.days}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">⏰ 운영 시간</span>
              <span class="meta-value">${place.hours}</span>
            </div>
            <div class="meta-item outlet-full">
              <span class="meta-label">🔌 콘센트 유무 / 좌석 환경</span>
              <span class="meta-value">${place.outlets}</span>
            </div>
          </div>

          <div class="gemini-summary-box">
            <div class="gemini-badge-row">
              <span class="gemini-badge">✨ Gemini 요약</span>
              <span class="gemini-ai-hint">AI 카공 큐레이션</span>
            </div>
            <p class="gemini-summary-text">${place.summary}</p>
          </div>

          <div class="tag-list">${tagsHtml}</div>

          <!-- 요구사항 2: 사진 및 후기 영역 클릭 시 네이버/카카오 실제 리뷰 페이지 새 창 이동 -->
          <div class="review-action-row">
            <a
              href="${photoReviewUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="ext-action-btn photo-btn"
              data-ext-type="naver_photo_review"
            >
              📸 매장 사진·후기 ↗
            </a>
            <a
              href="${kakaoReviewUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="ext-action-btn review-btn"
              data-ext-type="kakao_review"
            >
              ⭐ 카카오맵 후기 ↗
            </a>
            <a
              href="${naverMainUrl}"
              target="_blank"
              rel="noopener noreferrer"
              class="ext-action-btn map-main-btn"
              data-ext-type="naver_map_route"
            >
              🗺️ 네이버 길찾기 ↗
            </a>
          </div>
        </article>
      `;
    })
    .join("");

  listEl.querySelectorAll("a[target='_blank']").forEach((linkEl) => {
    linkEl.addEventListener("click", () => {
      const card = linkEl.closest(".place-card");
      trackEvent("place_click", {
        place_id: card ? Number(card.dataset.placeId) : null,
        place_name: card ? card.dataset.placeName : "",
        link_type: linkEl.dataset.extType || "card_title",
        source: "list_card",
      });
    });
  });
}

// 16. 요구사항 1, 2, 5: 지도 뷰 & 마커 클릭 바텀시트 (메타데이터 + 사진/후기 외부 링크 + 목록 전환 동선)
function openMapOverlayCard(place) {
  const overlayCard = document.getElementById("mapSelectedCard");
  const floatingBtn = document.getElementById("btnFloatingViewToggle");
  if (!overlayCard || !place) return;

  const distText =
    place.distance >= 1000
      ? `${(place.distance / 1000).toFixed(1)}km`
      : `${place.distance}m`;
  const distClass = place.distance <= DEFAULT_RADIUS_METERS ? "" : "far";

  const tagsHtml = place.tags
    .map((t) => {
      const isMatched = state.selectedTags.has(normalizeTag(t));
      return `<span class="tag-pill ${isMatched ? "matched" : ""}">#${t}</span>`;
    })
    .join("");

  const { naverMainUrl, photoReviewUrl, kakaoReviewUrl } =
    buildExternalReviewLinks(place);

  overlayCard.innerHTML = `
    <div class="sheet-grab-bar"></div>
    <div class="card-top">
      <div class="place-name-wrap">
        <strong class="place-name">${place.name}</strong>
        <span class="distance-badge ${distClass}">${state.anchorCoord.label} ${distText}</span>
      </div>
      <div class="sheet-header-actions">
        <button type="button" class="sheet-switch-list-btn" id="btnSheetToList" title="전체 목록 뷰로 전환">
          📋 목록으로 보기
        </button>
        <button type="button" class="overlay-close-btn" id="btnCloseOverlayCard" aria-label="요약 카드 닫기">✕</button>
      </div>
    </div>

    <!-- 요구사항 5: 지도 핀업 카드에도 운영 날짜·운영 시간·콘센트 메타데이터 배치 -->
    <div class="place-meta-grid" style="margin-bottom:8px;">
      <div class="meta-item">
        <span class="meta-label">🗓️ 운영 날짜</span>
        <span class="meta-value">${place.days}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">⏰ 운영 시간</span>
        <span class="meta-value">${place.hours}</span>
      </div>
      <div class="meta-item outlet-full">
        <span class="meta-label">🔌 콘센트 유무 / 좌석 환경</span>
        <span class="meta-value">${place.outlets}</span>
      </div>
    </div>

    <div class="gemini-summary-box" style="margin-bottom:9px;padding:10px 12px;">
      <div class="gemini-badge-row">
        <span class="gemini-badge">✨ Gemini 요약</span>
        <span class="gemini-ai-hint">AI 카공 큐레이션</span>
      </div>
      <p class="gemini-summary-text">${place.summary}</p>
    </div>

    <div class="tag-list" style="margin-bottom:9px;">${tagsHtml}</div>

    <!-- 요구사항 2: 바텀시트 내 사진·후기 외부 링크 연동 -->
    <div class="review-action-row">
      <a
        href="${photoReviewUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="ext-action-btn photo-btn"
        data-ext-type="naver_photo_review"
      >
        📸 사진·후기 ↗
      </a>
      <a
        href="${kakaoReviewUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="ext-action-btn review-btn"
        data-ext-type="kakao_review"
      >
        ⭐ 카카오 후기 ↗
      </a>
      <a
        href="${naverMainUrl}"
        target="_blank"
        rel="noopener noreferrer"
        class="ext-action-btn map-main-btn"
        data-ext-type="naver_map_route"
      >
        🗺️ 네이버 지도 ↗
      </a>
    </div>
  `;

  overlayCard.classList.remove("hidden");
  if (floatingBtn) floatingBtn.classList.add("card-open");

  document.querySelectorAll(".khu-place-marker-pin").forEach((pinEl) => {
    pinEl.classList.toggle(
      "selected",
      Number(pinEl.dataset.placeId) === place.id
    );
  });

  // 바텀시트에서 [📋 목록으로 보기] 클릭 시 즉시 목록 뷰로 전환하고 해당 카드로 스크롤
  const sheetToListBtn = document.getElementById("btnSheetToList");
  if (sheetToListBtn) {
    sheetToListBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.viewMode = "list";
      trackEvent("view_toggle", {
        view_mode: "list",
        source: "map_bottom_sheet",
      });
      renderAll();
      setTimeout(() => {
        const targetCard = document.querySelector(
          `.place-card[data-place-id="${place.id}"]`
        );
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 80);
    });
  }

  const closeBtn = document.getElementById("btnCloseOverlayCard");
  if (closeBtn) {
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      overlayCard.classList.add("hidden");
      if (floatingBtn) floatingBtn.classList.remove("card-open");
      document.querySelectorAll(".khu-place-marker-pin").forEach((pinEl) => {
        pinEl.classList.remove("selected");
      });
    });
  }

  overlayCard.querySelectorAll("a[target='_blank']").forEach((extLink) => {
    extLink.addEventListener("click", () => {
      trackEvent("place_click", {
        place_id: place.id,
        place_name: place.name,
        link_type: extLink.dataset.extType || "sheet_external",
        source: "map_bottom_sheet",
      });
    });
  });
}

function renderMapView(filteredResult) {
  const mapWrap = document.getElementById("mapViewContainer");
  const listWrap = document.getElementById("placeListContainer");
  const overlayCard = document.getElementById("mapSelectedCard");
  const floatingBtn = document.getElementById("btnFloatingViewToggle");

  // 상단 [지도 / 목록] 탭 및 하단 플로팅 캡슐 버튼 텍스트 동기화
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.viewMode);
  });

  if (floatingBtn) {
    floatingBtn.innerHTML =
      state.viewMode === "map"
        ? `📋 카페 목록 보기 (${filteredResult.displayed.length}곳)`
        : "🗺️ 지도 화면 보기";
    floatingBtn.classList.remove("card-open");
  }

  if (!mapWrap || !listWrap) return;

  if (state.viewMode !== "map") {
    mapWrap.classList.add("hidden");
    listWrap.classList.remove("hidden");
    if (overlayCard) overlayCard.classList.add("hidden");
    return;
  }

  listWrap.classList.add("hidden");
  mapWrap.classList.remove("hidden");

  if (!leafletMap && typeof window.L !== "undefined") {
    leafletMap = L.map("leafletMap", {
      zoomControl: true,
    }).setView([state.anchorCoord.lat, state.anchorCoord.lng], 15);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(leafletMap);

    placeMarkersLayer = L.layerGroup().addTo(leafletMap);

    leafletMap.on("click", () => {
      if (overlayCard) overlayCard.classList.add("hidden");
      if (floatingBtn) floatingBtn.classList.remove("card-open");
      document.querySelectorAll(".khu-place-marker-pin").forEach((pinEl) => {
        pinEl.classList.remove("selected");
      });
    });
  }

  if (!leafletMap) return;

  if (radiusCircle) {
    leafletMap.removeLayer(radiusCircle);
  }
  if (anchorMarker) {
    leafletMap.removeLayer(anchorMarker);
  }
  placeMarkersLayer.clearLayers();
  if (overlayCard) overlayCard.classList.add("hidden");

  radiusCircle = L.circle([state.anchorCoord.lat, state.anchorCoord.lng], {
    radius: DEFAULT_RADIUS_METERS,
    color: "#4F46E5",
    weight: 2,
    dashArray: "6, 4",
    fillColor: "#6366F1",
    fillOpacity: 0.11,
  }).addTo(leafletMap);

  const anchorIcon = L.divIcon({
    className: "custom-anchor-icon",
    html: `<div class="khu-anchor-pin">📍 ${state.anchorCoord.label} 기준</div>`,
    iconSize: [96, 26],
    iconAnchor: [48, 13],
  });
  anchorMarker = L.marker([state.anchorCoord.lat, state.anchorCoord.lng], {
    icon: anchorIcon,
    zIndexOffset: 1000,
  }).addTo(leafletMap);

  const markersById = new Map();

  filteredResult.displayed.forEach((place) => {
    const shortName =
      place.name.length > 7 ? `${place.name.slice(0, 6)}…` : place.name;
    const placeIcon = L.divIcon({
      className: "custom-place-divicon",
      html: `<div class="khu-place-marker-pin" data-place-id="${place.id}"><span class="pin-emoji">☕</span><span>${shortName}</span></div>`,
      iconSize: [92, 24],
      iconAnchor: [46, 12],
    });

    const marker = L.marker([place.lat, place.lng], {
      icon: placeIcon,
    }).addTo(placeMarkersLayer);

    marker.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      openMapOverlayCard(place);
      leafletMap.panTo([place.lat, place.lng], { animate: true });
      trackEvent("place_click", {
        place_id: place.id,
        place_name: place.name,
        source: "map_marker",
      });
    });

    markersById.set(place.id, { marker, place });
  });

  setTimeout(() => {
    leafletMap.invalidateSize();
    if (radiusCircle) {
      leafletMap.fitBounds(radiusCircle.getBounds(), { padding: [14, 14] });
    } else {
      leafletMap.setView([state.anchorCoord.lat, state.anchorCoord.lng], 15);
    }

    if (state.initialMarkerId && markersById.has(state.initialMarkerId)) {
      const target = markersById.get(state.initialMarkerId);
      openMapOverlayCard(target.place);
      state.initialMarkerId = null;
    }
  }, 60);
}

// 17. 전체 UI 통합 렌더링
function renderAll() {
  updateURLParams();
  renderHeader();
  renderAnchorControls();
  renderFilterChips();
  updateFixedCTA();

  const filteredResult = getFilteredPlaces();
  renderPlaceList(filteredResult);
  renderMapView(filteredResult);
}

// 18. 요구사항 3: 정규 도메인(https://korewajiyuda.github.io/khu_kagongmap/) 공유 및 클립보드 복사
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

async function copyShareLink() {
  const targetUrl = getCanonicalShareUrl();
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
  showToast(`카공맵 주소가 복사되었어요! (${targetUrl})`);
}

// 19. 인앱 브라우저 감지 및 홈 화면 추가(A2HS) 바텀시트 팝업
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
      titleEl.textContent =
        "인스타·카톡에서는 위치 권한과 홈 화면 추가가 제한돼요!";
    }
    if (subtitleEl) {
      subtitleEl.textContent =
        "외부 브라우저(Safari·Chrome)로 열면 내 위치 500m 탐색과 홈 화면 바로가기를 쓸 수 있어요.";
    }
    bodyEl.innerHTML = `
      <ol class="a2hs-steps">
        <li>
          <span class="step-num">1</span>
          <span>화면 우측 상단 또는 하단의 <strong>[⋯] 메뉴 버튼</strong>을 눌러주세요.</span>
        </li>
        <li>
          <span class="step-num">2</span>
          <span><strong>[다른 브라우저로 열기]</strong> (Safari / Chrome)를 선택해 주세요.</span>
        </li>
        <li>
          <span class="step-num">3</span>
          <span>브라우저 메뉴에서 공유 후 <strong>[홈 화면에 추가]</strong>를 누르면 1초 만에 접속 끝!</span>
        </li>
      </ol>
    `;
  } else {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (titleEl) {
      titleEl.textContent = "경희대 카공맵을 홈 화면에 추가해 보세요!";
    }
    if (subtitleEl) {
      subtitleEl.textContent =
        "시험기간·공강 때마다 앱처럼 1초 만에 내 주변 카공 카페를 찾을 수 있어요.";
    }
    if (isIOS) {
      bodyEl.innerHTML = `
        <ol class="a2hs-steps">
          <li>
            <span class="step-num">1</span>
            <span>Safari 하단 바의 <strong>[공유 버튼 ⬆️]</strong>을 눌러주세요.</span>
          </li>
          <li>
            <span class="step-num">2</span>
            <span>메뉴에서 <strong>[홈 화면에 추가]</strong>를 누르면 바탕화면에 카공맵 아이콘이 생겨요!</span>
          </li>
        </ol>
      `;
    } else {
      bodyEl.innerHTML = `
        <ol class="a2hs-steps">
          <li>
            <span class="step-num">1</span>
            <span>Chrome 우측 상단 <strong>[⋮ 메뉴]</strong> 버튼을 눌러주세요.</span>
          </li>
          <li>
            <span class="step-num">2</span>
            <span><strong>[홈 화면에 추가]</strong> 또는 <strong>[앱 설치]</strong>를 선택하면 바로가기가 생성돼요!</span>
          </li>
        </ol>
      `;
    }
  }

  modal.classList.remove("hidden");
  trackEvent("a2hs_shown", {
    in_app: inApp,
    forced_test: Boolean(forceInAppMode),
  });
}

window.showA2HSPopup = showA2HSPopup;

function initA2HSTrigger() {
  const visitCount =
    Number(localStorage.getItem("khu_rescue_visits") || "0") + 1;
  localStorage.setItem("khu_rescue_visits", String(visitCount));
  const shownThisSession =
    sessionStorage.getItem("khu_a2hs_shown_session") === "1";

  if (shownThisSession) return;

  if (visitCount >= 2) {
    sessionStorage.setItem("khu_a2hs_shown_session", "1");
    setTimeout(() => {
      showA2HSPopup(false);
    }, 1000);
  } else {
    setTimeout(() => {
      if (sessionStorage.getItem("khu_a2hs_shown_session") !== "1") {
        sessionStorage.setItem("khu_a2hs_shown_session", "1");
        showA2HSPopup(false);
      }
    }, 30000);
  }
}

// 20. 이벤트 바인딩 (이벤트 위임으로 다중 태그 및 기준점 클릭 안정성 보장)
function bindEvents() {
  // 캠퍼스 세그먼트 컨트롤 전환 [서울캠 / 국제캠]
  document.querySelectorAll(".campus-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextCampus = btn.dataset.campus;
      if (nextCampus === state.campus) return;

      state.campus = nextCampus;
      const defaultAnchor = CAMPUS_ANCHORS[state.campus][0];
      state.anchorKey = defaultAnchor.key;
      state.anchorCoord = {
        lat: defaultAnchor.lat,
        lng: defaultAnchor.lng,
        label: defaultAnchor.label,
      };
      state.radiusLimitEnabled = true;

      trackEvent("campus_change", { campus: state.campus });
      renderAll();
    });
  });

  // 기준점 버튼 컨테이너 이벤트 위임
  const anchorContainer = document.getElementById("anchorButtonGroup");
  if (anchorContainer) {
    anchorContainer.addEventListener("click", (e) => {
      const btn = e.target.closest(".anchor-btn");
      if (!btn) return;
      const key = btn.dataset.anchor;
      if (key === "gps") {
        requestUserGPS();
      } else {
        const found = CAMPUS_ANCHORS[state.campus].find((x) => x.key === key);
        if (found) {
          state.anchorKey = found.key;
          state.anchorCoord = {
            lat: found.lat,
            lng: found.lng,
            label: found.label,
          };
          renderAll();
        }
      }
    });
  }

  // 요구사항 4: 다중 선택 필터 칩 컨테이너 이벤트 위임 (중복 클릭 시 Set에 추가/제거)
  const filterContainer = document.getElementById("filterChipContainer");
  if (filterContainer) {
    filterContainer.addEventListener("click", (e) => {
      const resetBtn = e.target.closest("[data-action='reset-filters']");
      if (resetBtn) {
        state.selectedTags.clear();
        renderAll();
        return;
      }

      const chip = e.target.closest(".filter-chip");
      if (!chip) return;

      const tag = normalizeTag(chip.dataset.tag);
      if (!tag) return;

      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
      } else {
        state.selectedTags.add(tag);
      }

      trackEvent("filter_click", {
        tag,
        active_tags: Array.from(state.selectedTags).join(","),
        active_count: state.selectedTags.size,
      });
      renderAll();
    });
  }

  // 반경 500m <-> 전체 거리순 보기 토글
  const radiusToggleBtn = document.getElementById("btnToggleRadius");
  if (radiusToggleBtn) {
    radiusToggleBtn.addEventListener("click", () => {
      state.radiusLimitEnabled = !state.radiusLimitEnabled;
      renderAll();
    });
  }

  // 상단 [지도 / 목록] 탭 전환
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nextView = btn.dataset.view;
      if (!nextView || nextView === state.viewMode) return;
      state.viewMode = nextView;
      trackEvent("view_toggle", {
        view_mode: state.viewMode,
        source: "toolbar_tab",
      });
      renderAll();
    });
  });

  // 하단 다크 캡슐 플로팅 버튼 [📋 카페 목록 보기 ↔ 🗺️ 지도 화면 보기]
  const floatingToggleBtn = document.getElementById("btnFloatingViewToggle");
  if (floatingToggleBtn) {
    floatingToggleBtn.addEventListener("click", () => {
      state.viewMode = state.viewMode === "map" ? "list" : "map";
      trackEvent("view_toggle", {
        view_mode: state.viewMode,
        source: "floating_capsule",
      });
      renderAll();
    });
  }

  // 요구사항 3: 정규 도메인 링크 복사/공유 버튼
  const btnShare = document.getElementById("btnShare");
  const btnFooterShare = document.getElementById("btnFooterShare");
  const btnA2HSCopyLink = document.getElementById("btnA2HSCopyLink");

  if (btnShare) btnShare.addEventListener("click", () => copyShareLink());
  if (btnFooterShare)
    btnFooterShare.addEventListener("click", () => copyShareLink());
  if (btnA2HSCopyLink) {
    btnA2HSCopyLink.addEventListener("click", () => copyShareLink());
  }

  // 하단 고정 CTA 버튼 클릭 -> 신청 & 오류 해결 가이드 3편 바텀시트 오픈
  const btnOpenOfferSheet = document.getElementById("btnOpenGeminiOfferSheet");
  const btnCloseOfferSheet = document.getElementById("btnCloseOfferSheet");
  const offerModal = document.getElementById("geminiOfferModal");
  const ctaLink = document.getElementById("geminiCtaLink");

  if (btnOpenOfferSheet && offerModal) {
    btnOpenOfferSheet.addEventListener("click", () => {
      offerModal.classList.remove("hidden");
      trackEvent("cta_click", {
        campus: state.campus,
        map: "kagong",
        utm_content: `${state.campus}_kagong`,
        action: "open_offer_sheet",
      });
    });
  }

  if (btnCloseOfferSheet && offerModal) {
    btnCloseOfferSheet.addEventListener("click", () => {
      offerModal.classList.add("hidden");
    });
    offerModal.addEventListener("click", (e) => {
      if (e.target === offerModal) {
        offerModal.classList.add("hidden");
      }
    });
  }

  if (ctaLink) {
    ctaLink.addEventListener("click", () => {
      trackEvent("cta_click", {
        campus: state.campus,
        map: "kagong",
        utm_content: `${state.campus}_kagong`,
        action: "proceed_to_gemini_offer",
      });
    });
  }

  document.querySelectorAll(".ts-guide-item").forEach((item) => {
    item.addEventListener("click", () => {
      trackEvent("cta_click", {
        campus: state.campus,
        map: "kagong",
        action: "troubleshooting_guide_click",
        guide_step: item.dataset.guide,
      });
    });
  });

  // A2HS 바텀시트 열기/닫기
  const btnOpenA2HS = document.getElementById("btnOpenA2HS");
  const btnCloseA2HS = document.getElementById("btnCloseA2HS");
  const a2hsModal = document.getElementById("a2hsModal");

  if (btnOpenA2HS) {
    btnOpenA2HS.addEventListener("click", () => showA2HSPopup(false));
  }
  if (btnCloseA2HS && a2hsModal) {
    btnCloseA2HS.addEventListener("click", () => {
      a2hsModal.classList.add("hidden");
    });
    a2hsModal.addEventListener("click", (e) => {
      if (e.target === a2hsModal) {
        a2hsModal.classList.add("hidden");
      }
    });
  }
}

async function initApp() {
  syncStateFromURL();
  bindEvents();

  try {
    state.places = await loadPlacesData();
  } catch (err) {
    console.error("카공 카페 데이터를 불러오는데 실패했습니다:", err);
  }

  renderAll();
  trackEvent("page_view", {
    campus: state.campus,
    map: "kagong",
    initial_view: state.viewMode,
  });
  initA2HSTrigger();
}

document.addEventListener("DOMContentLoaded", initApp);
