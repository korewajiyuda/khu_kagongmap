/**
 * ☕ 경희대 카공맵 (단독 웹앱) - app.js
 * Toss·Catchtable 스타일 UI + Google Gemini Ambassador 감성
 * 순수 Vanilla JS (데이터: 구글 시트 CSV URL / 로컬 data.csv Fallback, 지도: Leaflet.js CDN)
 */

// 1. 구글 시트 CSV 연동 상수 (값이 있으면 우선 fetch, 비어 있거나 실패 시 로컬 data.csv Fallback)
const GOOGLE_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1td87-lDak8Cj8abo_qKMiARD8rXJ14Mwr4g3rknZJLU/export?format=csv";
const LOCAL_CSV_URL = "./data.csv";

// GA4 측정 ID 및 공식 링크 상수
const GA_MEASUREMENT_ID = window.GA_MEASUREMENT_ID || "G-XXXXXXXXXX";
const SHORT_SHARE_URL = "https://goo.gle/kyunghee";
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

// 3. 카공맵 전용 다중 선택 필터 칩 정의 (거지맵 완전 제거)
const KAGONG_FILTER_TAGS = [
  "콘센트많음",
  "조용한",
  "밤늦게까지",
  "24시간",
  "교내카페",
  "1인석",
];

// 4. 애플리케이션 상태 (카공맵 단일화)
const state = {
  places: [],
  campus: "seoul", // 'seoul' | 'global'
  mapType: "kagong", // 항상 'kagong' 고정
  anchorKey: "main_gate", // 'gps' | 각 캠퍼스 거점 key
  anchorCoord: { lat: 37.5939, lng: 127.0530, label: "정문" },
  radiusLimitEnabled: true, // true: 반경 500m 이내, false: 캠퍼스 전체 거리순
  selectedTags: new Set(),
  viewMode: "list", // 'list' | 'map'
  initialMarkerId: null,
};

// Leaflet 지도 인스턴스 및 레이어
let leafletMap = null;
let radiusCircle = null;
let anchorMarker = null;
let placeMarkersLayer = null;
let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

// 5. GA4 이벤트 트래킹 래퍼 함수 (7개 필수 이벤트 연동 + console.log('[GA4]', ...) 동시 출력)
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

// 7. 안전한 CSV 파서 & 구글 시트 CSV URL + 로컬 data.csv Fallback 로더 (geoji 데이터는 원천 제외)
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

function parseCSV(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  return lines
    .slice(1)
    .map((line) => {
      const cols = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cols[idx] ?? "";
      });
      return {
        id: Number(obj.id),
        campus: obj.campus,
        map: obj.map || "kagong",
        name: obj.name,
        lat: parseFloat(obj.lat),
        lng: parseFloat(obj.lng),
        summary: obj.summary,
        tags: obj.tags
          ? obj.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        link:
          obj.link ||
          `https://map.naver.com/p/search/${encodeURIComponent(obj.name)}`,
      };
    })
    .filter((item) => item.map === "kagong"); // 거지맵(geoji) 데이터 원천 차단
}

async function loadPlacesData() {
  if (GOOGLE_SHEET_CSV_URL && GOOGLE_SHEET_CSV_URL.trim().length > 0) {
    try {
      const sheetRes = await fetch(GOOGLE_SHEET_CSV_URL.trim());
      if (sheetRes.ok) {
        const sheetCsv = await sheetRes.text();
        const parsed = parseCSV(sheetCsv);
        if (parsed.length > 0) {
          return parsed;
        }
      }
    } catch (sheetErr) {
      console.warn(
        "구글 시트 CSV 로드 실패, 로컬 data.csv로 Fallback 합니다:",
        sheetErr
      );
    }
  }

  const localRes = await fetch(LOCAL_CSV_URL);
  const localCsv = await localRes.text();
  return parseCSV(localCsv);
}

// 8. URL 파라미터 초기화 및 동기화
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

  if (viewParam === "map" || viewParam === "list") {
    state.viewMode = viewParam;
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
}

// 9. 하단 고정 CTA 버튼 동적 UTM 업데이트 (&utm_content={campus}_kagong)
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

// 10. 상단 헤더 타이틀("☕ 경희대 카공맵" 고정) & 캠퍼스 세그먼트 토글 업데이트
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

  container.querySelectorAll(".anchor-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
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
  });
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

// 13. 카공 전용 다중 선택 필터 칩 렌더링
function renderFilterChips() {
  const container = document.getElementById("filterChipContainer");
  if (!container) return;

  let html = "";

  if (state.selectedTags.size > 0) {
    html += `<button type="button" class="filter-reset-chip" id="btnResetFilters">초기화 ✕</button>`;
  }

  KAGONG_FILTER_TAGS.forEach((tag) => {
    const isActive = state.selectedTags.has(tag);
    html += `
      <button type="button" class="filter-chip ${isActive ? "active" : ""}" data-tag="${tag}">
        #${tag}
      </button>
    `;
  });

  container.innerHTML = html;

  const resetBtn = document.getElementById("btnResetFilters");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      state.selectedTags.clear();
      renderAll();
    });
  }

  container.querySelectorAll(".filter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const tag = chip.dataset.tag;
      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
      } else {
        state.selectedTags.add(tag);
      }
      trackEvent("filter_click", {
        tag,
        active_tags: Array.from(state.selectedTags).join(","),
      });
      renderAll();
    });
  });
}

// 14. 카공 카페 필터링 및 거리순 정렬
function getFilteredPlaces() {
  const { campus, anchorCoord, radiusLimitEnabled, selectedTags } = state;

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

  const tagFiltered = baseList.filter((p) => {
    if (selectedTags.size === 0) return true;
    for (const t of selectedTags) {
      if (!p.tags.includes(t)) return false;
    }
    return true;
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

// 15. 장소 카드 목록 렌더링
function renderPlaceList(filteredResult) {
  const listEl = document.getElementById("placeListContainer");
  const countEl = document.getElementById("placeCount");

  const { displayed, totalInCampus } = filteredResult;
  if (countEl) countEl.textContent = String(displayed.length);

  if (!listEl) return;

  if (displayed.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔭</div>
        <h3>반경 500m 내 조건에 맞는 카공 카페가 없어요</h3>
        <p>다른 거점을 선택하거나 캠퍼스 전체 거리순으로 넓혀보세요! (전체 ${totalInCampus}곳)</p>
        <button type="button" class="empty-expand-btn" id="btnEmptyExpand">
          캠퍼스 전체 거리순 보기 (${totalInCampus}곳)
        </button>
      </div>
    `;
    const expandBtn = document.getElementById("btnEmptyExpand");
    if (expandBtn) {
      expandBtn.addEventListener("click", () => {
        state.radiusLimitEnabled = false;
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
          const isMatched = state.selectedTags.has(t);
          return `<span class="tag-pill ${isMatched ? "matched" : ""}">#${t}</span>`;
        })
        .join("");

      return `
        <a
          href="${place.link}"
          target="_blank"
          rel="noopener noreferrer"
          class="place-card"
          data-place-id="${place.id}"
          data-place-name="${place.name}"
        >
          <div class="card-top">
            <div class="place-name-wrap">
              <h2 class="place-name">${place.name}</h2>
            </div>
            <span class="distance-badge ${distClass}">${distText}</span>
          </div>

          <div class="gemini-summary-box">
            <div class="gemini-badge-row">
              <span class="gemini-badge">✨ Gemini 요약</span>
              <span class="gemini-ai-hint">AI 카공 큐레이션</span>
            </div>
            <p class="gemini-summary-text">${place.summary}</p>
          </div>

          <div class="card-bottom">
            <div class="tag-list">${tagsHtml}</div>
            <span class="naver-link-label">네이버 지도 ↗</span>
          </div>
        </a>
      `;
    })
    .join("");

  listEl.querySelectorAll(".place-card").forEach((card) => {
    card.addEventListener("click", () => {
      trackEvent("place_click", {
        place_id: Number(card.dataset.placeId),
        place_name: card.dataset.placeName,
        source: "list_card",
      });
    });
  });
}

// 16. 지도 뷰 & 바텀시트 스타일 마커 요약 카드
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
      const isMatched = state.selectedTags.has(t);
      return `<span class="tag-pill ${isMatched ? "matched" : ""}">#${t}</span>`;
    })
    .join("");

  overlayCard.innerHTML = `
    <div class="sheet-grab-bar"></div>
    <div class="card-top">
      <div class="place-name-wrap">
        <strong class="place-name">${place.name}</strong>
        <span class="distance-badge ${distClass}">${state.anchorCoord.label}에서 ${distText}</span>
      </div>
      <button type="button" class="overlay-close-btn" id="btnCloseOverlayCard" aria-label="요약 카드 닫기">✕</button>
    </div>
    <div class="gemini-summary-box" style="margin-bottom:10px;">
      <div class="gemini-badge-row">
        <span class="gemini-badge">✨ Gemini 요약</span>
        <span class="gemini-ai-hint">AI 카공 큐레이션</span>
      </div>
      <p class="gemini-summary-text">${place.summary}</p>
    </div>
    <div class="card-bottom">
      <div class="tag-list">${tagsHtml}</div>
      <a
        href="${place.link}"
        target="_blank"
        rel="noopener noreferrer"
        class="overlay-naver-btn"
        data-place-id="${place.id}"
        data-place-name="${place.name}"
      >
        네이버 지도 길찾기 ↗
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

  const naverLink = overlayCard.querySelector(".overlay-naver-btn");
  if (naverLink) {
    naverLink.addEventListener("click", () => {
      trackEvent("place_click", {
        place_id: place.id,
        place_name: place.name,
        source: "map_bottom_sheet",
      });
    });
  }
}

function renderMapView(filteredResult) {
  const mapWrap = document.getElementById("mapViewContainer");
  const listWrap = document.getElementById("placeListContainer");
  const overlayCard = document.getElementById("mapSelectedCard");
  const floatingBtn = document.getElementById("btnFloatingViewToggle");

  if (floatingBtn) {
    floatingBtn.innerHTML =
      state.viewMode === "map" ? "📋 목록 보기" : "🗺️ 지도 보기";
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

  // 1) 반경 500m 원 (Gemini 인디고·로열블루 톤)
  radiusCircle = L.circle([state.anchorCoord.lat, state.anchorCoord.lng], {
    radius: DEFAULT_RADIUS_METERS,
    color: "#4F46E5",
    weight: 2,
    dashArray: "6, 4",
    fillColor: "#6366F1",
    fillOpacity: 0.11,
  }).addTo(leafletMap);

  // 2) 기준점 마커
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

  // 3) 필터링된 카공 카페 마커
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

// 18. 클립보드 공유 및 토스트 메시지
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

async function copyShareLink(customUrl = SHORT_SHARE_URL) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(customUrl);
    } else {
      throw new Error("clipboard fallback");
    }
  } catch {
    const tempInput = document.createElement("input");
    tempInput.value = customUrl;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
  }
  showToast("카공맵 링크(goo.gle/kyunghee)가 복사되었어요! ✨");
}

// 19. 인앱 브라우저 감지 및 홈 화면 추가(A2HS) 바텀시트 팝업 (showA2HSPopup 전역 지원)
function isInAppBrowser() {
  const ua = navigator.userAgent || "";
  return /Instagram|KAKAOTALK|everytime|NAVER|Line|FBAN|FBAV/i.test(ua);
}

/**
 * 홈 화면 추가(A2HS) 바텀시트 팝업 노출 함수
 * @param {boolean} forceInAppMode - true 전달 시 인앱 브라우저 안내 UI를 강제 노출
 */
function showA2HSPopup(forceInAppMode = false) {
  const modal = document.getElementById("a2hsModal");
  const titleEl = document.getElementById("a2hsTitle");
  const subtitleEl = document.getElementById("a2hsSubtitle");
  const bodyEl = document.getElementById("a2hsInstructionBody");
  const actionGroup = document.getElementById("a2hsActionGroup");
  const copyBtn = document.getElementById("btnA2HSCopyLink");

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
    if (actionGroup) actionGroup.classList.remove("single-col");
    if (copyBtn) copyBtn.classList.remove("hidden");
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
    if (actionGroup) actionGroup.classList.remove("single-col");
    if (copyBtn) copyBtn.classList.remove("hidden");
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

// 20. 이벤트 바인딩 및 초기 실행
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

  // 반경 500m <-> 전체 거리순 보기 토글
  const radiusToggleBtn = document.getElementById("btnToggleRadius");
  if (radiusToggleBtn) {
    radiusToggleBtn.addEventListener("click", () => {
      state.radiusLimitEnabled = !state.radiusLimitEnabled;
      renderAll();
    });
  }

  // 하단 다크 캡슐 플로팅 버튼 [🗺️ 지도 보기 / 📋 목록 보기]
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

  // 링크 복사/공유 버튼
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

  // A2HS 바텀시트 열기/닫기 (디버그용 강제 인앱 호출은 콘솔 window.showA2HSPopup(true) 전용으로 유지)
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
  });
  initA2HSTrigger();
}

document.addEventListener("DOMContentLoaded", initApp);
