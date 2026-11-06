/**
 * hours.js — 경희대 카공맵 영업시간 및 운영 상태 엔진
 *
 * 규칙 요약:
 * 1. 모든 시각 계산은 기기 시간대와 무관하게 Asia/Seoul(KST) 기준 (Intl.DateTimeFormat 사용)
 * 2. 지원 형식:
 *    - hours_detail: "월-금 08:00-24:00; 토-일 10:00-22:00"
 *    - days + hours: "매일" / "월~토 (일 휴무)" / "화~일 (월 휴무)" / "월~금" / "평일 (주말 휴무)" + "08:00 ~ 23:00" / "24시간 영업"
 *    - 자정 넘김 영업 (예: "10:00 ~ 02:00") -> 익일 새벽 01:00 조회 시 전날 영업분 연장 적용
 *    - 24:00은 1440분(다음날 00:00)으로 처리
 *    - break_time ("15:00-16:00"), closed_days ("일", "매월 2·4주 월"), status ("운영", "임시휴업", "폐업") 반영
 *    - 해석 불가 값은 "영업시간 정보 없음" 반환 + console.warn 출력 (앱 중단 없음)
 */
(function (globalScope) {
  "use strict";

  const DAY_NAMES_KO = ["일", "월", "화", "수", "목", "금", "토"];
  const DAY_NAME_TO_INDEX = {
    일: 0,
    월: 1,
    화: 2,
    수: 3,
    목: 4,
    금: 5,
    토: 6,
  };

  /**
   * 기기 시간대와 무관하게 Asia/Seoul 기준 연/월/일/시/분/요일(0=일..6=토)을 반환한다.
   * @param {Date|number|string} [inputDate]
   */
  function getSeoulTimeParts(inputDate) {
    const dateObj =
      inputDate instanceof Date
        ? inputDate
        : inputDate !== undefined && inputDate !== null
        ? new Date(inputDate)
        : new Date();

    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const parts = dtf.formatToParts(dateObj);
    const map = {};
    for (let i = 0; i < parts.length; i++) {
      map[parts[i].type] = parts[i].value;
    }

    const weekdayMap = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };

    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(map.minute, 10);
    const year = parseInt(map.year, 10);
    const month = parseInt(map.month, 10);
    const day = parseInt(map.day, 10);
    const dayOfWeek =
      weekdayMap[map.weekday] !== undefined
        ? weekdayMap[map.weekday]
        : new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    return {
      year,
      month,
      day,
      dayOfWeek,
      dayNameKo: DAY_NAMES_KO[dayOfWeek],
      hour,
      minute,
      totalMinutes: hour * 60 + minute,
    };
  }

  /**
   * 서울 시간 기준 특정 시:분으로 Date 객체를 생성한다 (날짜는 baseDate의 서울 날짜 유지).
   */
  function createSeoulDateAtTime(hour, minute, baseDate) {
    const p = getSeoulTimeParts(baseDate);
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    const mo = String(p.month).padStart(2, "0");
    const dd = String(p.day).padStart(2, "0");
    return new Date(`${p.year}-${mo}-${dd}T${hh}:${mm}:00+09:00`);
  }

  /**
   * 다가오는 특정 시각(예: 아침 10시, 낮 2시, 밤 10시)을 기준으로 서울 Date 객체를 반환한다.
   * 새벽 2시에 "아침 10시"를 고르면 당일 오전 10시, 밤 11시에 "아침 10시"를 고르면 다음 날 오전 10시가 된다.
   */
  function createUpcomingSeoulDateAtTime(hour, minute, baseDate) {
    const ref = baseDate instanceof Date ? baseDate : new Date();
    const todayTarget = createSeoulDateAtTime(hour, minute, ref);
    if (todayTarget.getTime() <= ref.getTime()) {
      return new Date(todayTarget.getTime() + 24 * 60 * 60 * 1000);
    }
    return todayTarget;
  }

  /**
   * "HH:MM" 문자열을 분(0 ~ 1440)으로 변환한다.
   */
  function parseTimeToMinutes(str) {
    if (!str) return null;
    const m = String(str)
      .trim()
      .match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh === 24 && mm === 0) return 1440;
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  /**
   * 분(0 ~ 2880)을 "HH:MM" 표시 문자열로 변환한다.
   * 1440분은 마감 표기 시 "24:00" (또는 open 표기 시 "00:00")으로 선택 가능.
   */
  function formatMinutesToHHMM(mins, keep24ForMidnight) {
    const normalized = ((mins % 1440) + 1440) % 1440;
    if (mins === 1440 && keep24ForMidnight) {
      return "24:00";
    }
    const hh = Math.floor(normalized / 60);
    const mm = normalized % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  /**
   * "08:00 ~ 23:00" 또는 "08:00-24:00" 또는 "24시간 영업" 문자열을 파싱한다.
   * 자정을 넘는 경우(예: 10:00 ~ 02:00) closeMin은 1440 + 120 = 1560으로 반환한다.
   */
  function parseTimeRangeString(rangeStr) {
    if (!rangeStr) return null;
    const raw = String(rangeStr).trim();
    if (!raw) return null;

    if (/24\s*시간/.test(raw)) {
      return {
        is24h: true,
        openMin: 0,
        closeMin: 1440,
        overnight: false,
      };
    }

    const match = raw.match(
      /(\d{1,2}:\d{2})\s*[~\-–—]\s*(\d{1,2}:\d{2})/
    );
    if (!match) return null;

    const openMin = parseTimeToMinutes(match[1]);
    let closeMin = parseTimeToMinutes(match[2]);
    if (openMin === null || closeMin === null) return null;

    if (openMin === 0 && (closeMin === 1440 || closeMin === 0)) {
      return {
        is24h: true,
        openMin: 0,
        closeMin: 1440,
        overnight: false,
      };
    }

    let overnight = false;
    if (closeMin <= openMin) {
      closeMin += 1440;
      overnight = true;
    }

    return {
      is24h: false,
      openMin,
      closeMin,
      overnight,
    };
  }

  /**
   * 요일 표현식("월-금", "월~토", "화~일", "토-일", "평일", "주말", "매일", "월,수,금", "매주 토요일 휴무")에서
   * 활성 요일 인덱스 배열(0=일..6=토)을 추출한다.
   */
  function expandDaySpec(daySpecStr) {
    if (!daySpecStr) return [0, 1, 2, 3, 4, 5, 6];
    let s = String(daySpecStr).trim();

    // 괄호 안 휴무 표현 제거 전에 별도 추출 가능하도록 괄호 바깥을 우선 본다
    s = s.replace(/\([^)]*\)/g, "").trim();

    if (!s || /매일|연중무휴|전요일|공지\s*확인/.test(s)) {
      return [0, 1, 2, 3, 4, 5, 6];
    }

    // "매주 토요일 휴무", "매주 월·화요일 휴무"처럼 괄호 없이 휴무일만 적힌 경우:
    // 전체 요일(0..6)에서 해당 휴무 요일을 제외한 요일을 활성 요일로 반환
    if (/휴무/.test(s) && !/[~\-–—]/.test(s)) {
      const closedClean = s
        .replace(/공휴일/g, " ")
        .replace(/요일|휴무|정기휴무|매주/g, " ");
      const closedSet = new Set();
      if (/주말/.test(closedClean)) {
        closedSet.add(0);
        closedSet.add(6);
      }
      for (let i = 0; i < closedClean.length; i++) {
        const ch = closedClean[i];
        if (DAY_NAME_TO_INDEX[ch] !== undefined) {
          closedSet.add(DAY_NAME_TO_INDEX[ch]);
        }
      }
      if (closedSet.size > 0 && closedSet.size < 7) {
        return [0, 1, 2, 3, 4, 5, 6].filter((d) => !closedSet.has(d));
      }
      return [0, 1, 2, 3, 4, 5, 6];
    }

    if (/평일/.test(s) && !/주말/.test(s)) {
      return [1, 2, 3, 4, 5];
    }
    if (/주말/.test(s) && !/평일/.test(s)) {
      return [0, 6];
    }

    // "요일", "공휴일"의 '일' 글자가 일요일(0)로 오인되지 않도록 먼저 제거
    const cleaned = s.replace(/공휴일/g, " ").replace(/요일/g, "");
    const activeSet = new Set();

    // 1. 모든 범위 표현 추출 (예: 월~토, 화-일, 월~금·일 등)
    const rangeRegex = /([일월화수목금토])\s*[~\-–—]\s*([일월화수목금토])/g;
    let remaining = cleaned;
    let match;
    while ((match = rangeRegex.exec(cleaned)) !== null) {
      const startIdx = DAY_NAME_TO_INDEX[match[1]];
      const endIdx = DAY_NAME_TO_INDEX[match[2]];
      let cur = startIdx;
      for (let step = 0; step < 7; step++) {
        activeSet.add(cur);
        if (cur === endIdx) break;
        cur = (cur + 1) % 7;
      }
      remaining = remaining.replace(match[0], " ");
    }

    // 2. 범위 외에 개별 나열된 요일 추가 (예: "월~금·일"의 '일', "월,수,금")
    for (let i = 0; i < remaining.length; i++) {
      const ch = remaining[i];
      if (DAY_NAME_TO_INDEX[ch] !== undefined) {
        activeSet.add(DAY_NAME_TO_INDEX[ch]);
      }
    }

    return activeSet.size > 0 ? Array.from(activeSet) : [0, 1, 2, 3, 4, 5, 6];
  }

  /**
   * days 문자열의 괄호(또는 휴무 구절) 및 closed_days 컬럼에서 정기휴무 요일 집합 및 격주 휴무 규칙을 파싱한다.
   * 지원 예:
   * - "일" / "일요일" / "월 휴무" / "주말 휴무" / "매주 목요일 휴무"
   * - "매월 2·4주 월" / "매월 1,3주 일"
   */
  function parseClosedDaysRule(daysStr, closedDaysStr) {
    const weeklyClosed = new Set();
    const nthWeekdayRules = []; // { weeks: [2, 4], dayOfWeek: 1 }

    // 1. daysStr 안에 "(일 휴무)", "(월 휴무)" 등이 있거나, 괄호 없이 "매주 목요일 휴무" 형태인 경우 모두 추출
    const parenMatches = String(daysStr || "").match(/\(([^)]+)\)/g) || [];
    const nonParenDays = String(daysStr || "").replace(/\([^)]*\)/g, "").trim();
    const checkTargets = [...parenMatches, String(closedDaysStr || "")];
    if (/휴무/.test(nonParenDays)) {
      checkTargets.push(nonParenDays);
    }

    checkTargets.forEach((rawChunk) => {
      const chunk = rawChunk.replace(/[()]/g, "").trim();
      if (!chunk || /연중무휴|휴무\s*없음/.test(chunk)) return;

      // "매월 2·4주 월" 패턴
      const nthMatch = chunk.match(
        /(\d+(?:\s*[·,/\s]\s*\d+)*)\s*주\s*([일월화수목금토])/
      );
      if (nthMatch) {
        const weeks = nthMatch[1]
          .split(/[·,/\s]+/)
          .map((n) => parseInt(n, 10))
          .filter((n) => !Number.isNaN(n));
        const dow = DAY_NAME_TO_INDEX[nthMatch[2]];
        if (weeks.length > 0 && dow !== undefined) {
          nthWeekdayRules.push({ weeks, dayOfWeek: dow });
        }
        return;
      }

      if (/주말/.test(chunk)) {
        weeklyClosed.add(0);
        weeklyClosed.add(6);
      }

      // "공휴일", "요일"의 '일' 글자가 일요일(0)로 오인되지 않도록 먼저 제거한 뒤 요일 문자 추출
      const cleaned = chunk
        .replace(/공휴일/g, " ")
        .replace(/요일|휴무|정기휴무|매주/g, " ");
      for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (DAY_NAME_TO_INDEX[ch] !== undefined) {
          weeklyClosed.add(DAY_NAME_TO_INDEX[ch]);
        }
      }
    });

    return { weeklyClosed, nthWeekdayRules };
  }

  /**
   * 특정 서울 날짜(year, month, day, dayOfWeek)가 격주/특정주 휴무에 해당하는지 판정한다.
   */
  function isClosedByNthRule(seoulParts, nthWeekdayRules) {
    if (!nthWeekdayRules || nthWeekdayRules.length === 0) return false;
    const weekOfMonth = Math.ceil(seoulParts.day / 7);
    for (let i = 0; i < nthWeekdayRules.length; i++) {
      const r = nthWeekdayRules[i];
      if (
        r.dayOfWeek === seoulParts.dayOfWeek &&
        r.weeks.includes(weekOfMonth)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * 장소 객체에서 요일별(0=일..6=토) 스케줄 맵을 생성한다.
   * 반환 형식:
   * {
   *   valid: boolean,
   *   scheduleByDay: { 0: { openMin, closeMin, is24h, overnight } | null, ... },
   *   nthWeekdayRules: [...],
   *   breakRange: { openMin, closeMin } | null
   * }
   */
  function buildPlaceSchedule(place) {
    const scheduleByDay = {
      0: null,
      1: null,
      2: null,
      3: null,
      4: null,
      5: null,
      6: null,
    };

    const hoursDetail = String(place.hours_detail || "").trim();
    const daysStr = String(place.days || "").trim();
    const hoursStr = String(place.hours || "").trim();
    const closedDaysStr = String(place.closed_days || "").trim();
    const breakTimeStr = String(place.break_time || "").trim();

    const closedRule = parseClosedDaysRule(daysStr, closedDaysStr);
    let parsedAny = false;

    if (hoursDetail) {
      // 예: "월-금 08:00-24:00; 토-일 10:00-22:00"
      const segments = hoursDetail
        .split(/[;/]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      segments.forEach((seg) => {
        if (/휴무/.test(seg) && !/\d{1,2}:\d{2}/.test(seg)) {
          const closedDays = expandDaySpec(seg.replace(/휴무/g, ""));
          closedDays.forEach((d) => {
            scheduleByDay[d] = null;
          });
          parsedAny = true;
          return;
        }

        // 요일 부분과 시간 부분 분리
        const timeMatch = seg.match(
          /(24\s*시간(?:\s*영업)?|\d{1,2}:\d{2}\s*[~\-–—]\s*\d{1,2}:\d{2})/
        );
        if (!timeMatch) return;

        const range = parseTimeRangeString(timeMatch[1]);
        if (!range) return;

        const dayPart = seg.slice(0, timeMatch.index).trim();
        const activeDays = dayPart ? expandDaySpec(dayPart) : [0, 1, 2, 3, 4, 5, 6];
        activeDays.forEach((d) => {
          scheduleByDay[d] = { ...range };
        });
        parsedAny = true;
      });
    }

    if (!parsedAny && hoursStr) {
      const range = parseTimeRangeString(hoursStr);
      if (range) {
        const activeDays = expandDaySpec(daysStr || "매일");
        activeDays.forEach((d) => {
          scheduleByDay[d] = { ...range };
        });
        parsedAny = true;
      }
    }

    if (!parsedAny) {
      console.warn(
        `[hours.js] 영업시간을 해석할 수 없습니다: name="${place.name || ""}", days="${daysStr}", hours="${hoursStr}", hours_detail="${hoursDetail}"`
      );
      return {
        valid: false,
        scheduleByDay,
        nthWeekdayRules: closedRule.nthWeekdayRules,
        breakRange: null,
      };
    }

    // 정기휴무 요일 제거
    closedRule.weeklyClosed.forEach((d) => {
      scheduleByDay[d] = null;
    });

    // 브레이크타임 파싱
    let breakRange = null;
    if (breakTimeStr) {
      const parsedBreak = parseTimeRangeString(breakTimeStr);
      if (parsedBreak && !parsedBreak.is24h) {
        breakRange = parsedBreak;
      }
    }

    return {
      valid: true,
      scheduleByDay,
      nthWeekdayRules: closedRule.nthWeekdayRules,
      breakRange,
    };
  }

  /**
   * 특정 요일(dayIndex)로부터 가장 가까운 다음 영업일의 { dayOffset, dayIndex, dayNameKo, openText }를 찾는다.
   */
  function findNextOpening(scheduleByDay, startDayIndex, startOffset) {
    for (let offset = startOffset; offset <= 7; offset++) {
      const d = (startDayIndex + offset) % 7;
      const slot = scheduleByDay[d];
      if (slot) {
        const openText = formatMinutesToHHMM(slot.openMin, false);
        return {
          dayOffset: offset,
          dayIndex: d,
          dayNameKo: DAY_NAMES_KO[d],
          openText,
        };
      }
    }
    return null;
  }

  /**
   * 핵심 함수: 장소(place)와 기준 시각(refDate)을 받아 3-2 규격의 상태 객체를 반환한다.
   *
   * 반환 객체:
   * {
   *   state: 'open' | 'closing_soon' | 'break' | 'closed' | 'holiday' | 'temp_closed' | 'open_24h' | 'permanently_closed' | 'unknown',
   *   isOpen: boolean,          // 현재 영업 중 여부 (open, closing_soon, open_24h일 때 true)
   *   hidden: boolean,          // status=폐업이면 true
   *   label: string,            // 화면에 표시할 문구 (예: "곧 마감 · 30분 남음")
   *   shortBadge: string,       // 상태 요약명
   *   remainingMinutes: number | null
   * }
   */
  function getPlaceBusinessStatus(place, refDate) {
    if (!place) {
      return {
        state: "unknown",
        isOpen: false,
        hidden: false,
        label: "영업시간 정보 없음",
        shortBadge: "정보 없음",
        remainingMinutes: null,
      };
    }

    const rawStatus = String(place.status || "운영").trim();
    if (rawStatus === "폐업") {
      return {
        state: "permanently_closed",
        isOpen: false,
        hidden: true,
        label: "폐업",
        shortBadge: "폐업",
        remainingMinutes: null,
      };
    }

    if (rawStatus === "임시휴업") {
      return {
        state: "temp_closed",
        isOpen: false,
        hidden: false,
        label: "임시휴업",
        shortBadge: "임시휴업",
        remainingMinutes: null,
      };
    }

    const built = buildPlaceSchedule(place);
    if (!built.valid) {
      return {
        state: "unknown",
        isOpen: false,
        hidden: false,
        label: "영업시간 정보 없음",
        shortBadge: "정보 없음",
        remainingMinutes: null,
      };
    }

    const seoul = getSeoulTimeParts(refDate);
    const todayIdx = seoul.dayOfWeek;
    const yesterdayIdx = (todayIdx + 6) % 7;
    const nowMin = seoul.totalMinutes;

    // 1. 전날 자정 넘김 영업분이 현재 시각(새벽)까지 이어지는지 먼저 확인
    // 예: 월요일 10:00~02:00 매장을 화요일 01:00에 조회 -> 전날 영업분(closeMin=1560)과 nowMin+1440(=1500) 비교
    const yesterdaySlot = built.scheduleByDay[yesterdayIdx];
    if (yesterdaySlot && yesterdaySlot.overnight && !yesterdaySlot.is24h) {
      const extendedNowMin = nowMin + 1440;
      if (extendedNowMin < yesterdaySlot.closeMin) {
        const remaining = yesterdaySlot.closeMin - extendedNowMin;
        const closeStr = formatMinutesToHHMM(yesterdaySlot.closeMin, true);
        if (remaining <= 60) {
          return {
            state: "closing_soon",
            isOpen: true,
            hidden: false,
            label: `곧 마감 · ${remaining}분 남음`,
            shortBadge: "곧 마감",
            remainingMinutes: remaining,
          };
        }
        return {
          state: "open",
          isOpen: true,
          hidden: false,
          label: `영업 중 · ${closeStr} 마감`,
          shortBadge: "영업 중",
          remainingMinutes: remaining,
        };
      }
    }

    // 2. 오늘이 정기휴무일(또는 격주 휴무일)인지 확인
    const todaySlot = isClosedByNthRule(seoul, built.nthWeekdayRules)
      ? null
      : built.scheduleByDay[todayIdx];

    if (!todaySlot) {
      const nextOpen = findNextOpening(built.scheduleByDay, todayIdx, 1);
      const nextSuffix = nextOpen
        ? ` · ${nextOpen.dayNameKo} ${nextOpen.openText} 오픈`
        : "";
      return {
        state: "holiday",
        isOpen: false,
        hidden: false,
        label: `오늘 휴무${nextSuffix}`,
        shortBadge: "휴무",
        remainingMinutes: null,
      };
    }

    // 3. 24시간 영업 매장
    if (todaySlot.is24h) {
      return {
        state: "open_24h",
        isOpen: true,
        hidden: false,
        label: "24시간 영업",
        shortBadge: "24시간",
        remainingMinutes: 1440,
      };
    }

    // 4. 오늘 오픈 시각 이전인 경우 (예: 수요일 03:00에 08:00 오픈 매장 -> "영업 종료 · 08:00 오픈")
    if (nowMin < todaySlot.openMin) {
      const openStr = formatMinutesToHHMM(todaySlot.openMin, false);
      return {
        state: "closed",
        isOpen: false,
        hidden: false,
        label: `영업 종료 · ${openStr} 오픈`,
        shortBadge: "영업 종료",
        remainingMinutes: null,
      };
    }

    // 5. 오늘 영업 시간 내인 경우 (openMin <= nowMin < closeMin)
    if (nowMin >= todaySlot.openMin && nowMin < todaySlot.closeMin) {
      // 브레이크타임 체크
      if (
        built.breakRange &&
        nowMin >= built.breakRange.openMin &&
        nowMin < built.breakRange.closeMin
      ) {
        const reopenStr = formatMinutesToHHMM(built.breakRange.closeMin, false);
        return {
          state: "break",
          isOpen: false,
          hidden: false,
          label: `브레이크 · ${reopenStr} 재오픈`,
          shortBadge: "브레이크",
          remainingMinutes: null,
        };
      }

      const remaining = todaySlot.closeMin - nowMin;
      const closeStr = formatMinutesToHHMM(todaySlot.closeMin, true);
      if (remaining <= 60) {
        return {
          state: "closing_soon",
          isOpen: true,
          hidden: false,
          label: `곧 마감 · ${remaining}분 남음`,
          shortBadge: "곧 마감",
          remainingMinutes: remaining,
        };
      }
      return {
        state: "open",
        isOpen: true,
        hidden: false,
        label: `영업 중 · ${closeStr} 마감`,
        shortBadge: "영업 중",
        remainingMinutes: remaining,
      };
    }

    // 6. 오늘 영업이 이미 종료된 경우 (nowMin >= todaySlot.closeMin)
    const nextOpen = findNextOpening(built.scheduleByDay, todayIdx, 1);
    if (nextOpen) {
      const prefix =
        nextOpen.dayOffset === 1 ? "내일" : nextOpen.dayNameKo;
      return {
        state: "closed",
        isOpen: false,
        hidden: false,
        label: `영업 종료 · ${prefix} ${nextOpen.openText} 오픈`,
        shortBadge: "영업 종료",
        remainingMinutes: null,
      };
    }

    return {
      state: "closed",
      isOpen: false,
      hidden: false,
      label: "영업 종료",
      shortBadge: "영업 종료",
      remainingMinutes: null,
    };
  }

  /**
   * 영업시간 데이터 기준으로 24시간 매장인지 판별한다 (상황 카드 'cram' 및 세부 조건용).
   */
  function is24HoursPlace(place) {
    const built = buildPlaceSchedule(place);
    if (!built.valid) return false;
    return Object.values(built.scheduleByDay).some(
      (slot) => slot && slot.is24h
    );
  }

  /**
   * 영업시간 데이터 기준으로 23:00 이후까지 영업하는 매장인지 판별한다 (상황 카드 'late_night'용).
   * refDate의 요일(또는 평일 기본 스케줄) 마감 시각이 23:00(1380분) 이상이거나 24시간 영업이면 true.
   */
  function isLateNightByHours(place, refDate) {
    const built = buildPlaceSchedule(place);
    if (!built.valid) return false;
    const seoul = getSeoulTimeParts(refDate);
    const todaySlot = built.scheduleByDay[seoul.dayOfWeek];
    if (todaySlot) {
      return todaySlot.is24h || todaySlot.closeMin >= 23 * 60;
    }
    return Object.values(built.scheduleByDay).some(
      (slot) => slot && (slot.is24h || slot.closeMin >= 23 * 60)
    );
  }

  /**
   * 상세 화면용 요일별 영업시간 요약 리스트를 반환한다.
   */
  function getFormattedWeeklyHours(place) {
    const built = buildPlaceSchedule(place);
    if (!built.valid) {
      return [{ dayLabel: "영업시간", timeLabel: "영업시간 정보 없음" }];
    }

    const order = [1, 2, 3, 4, 5, 6, 0]; // 월~일
    const rows = order.map((d) => {
      const slot = built.scheduleByDay[d];
      let text = "휴무";
      if (slot) {
        text = slot.is24h
          ? "24시간 영업"
          : `${formatMinutesToHHMM(slot.openMin, false)} – ${formatMinutesToHHMM(
              slot.closeMin,
              true
            )}`;
      }
      return {
        dayIndex: d,
        dayLabel: `${DAY_NAMES_KO[d]}요일`,
        shortDay: DAY_NAMES_KO[d],
        timeLabel: text,
        isClosed: !slot,
      };
    });

    return rows;
  }

  /**
   * verified_at("2026-10-28")을 상대 날짜("3일 전 확인", "3주 전 확인") 및 60일 경과 여부로 변환한다.
   */
  function evaluateVerifiedAt(verifiedAtStr, refDate) {
    if (!verifiedAtStr || !String(verifiedAtStr).trim()) {
      return {
        hasDate: false,
        relativeLabel: "확인일 미기재",
        isStale: true,
        diffDays: null,
      };
    }

    const raw = String(verifiedAtStr).trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return {
        hasDate: false,
        relativeLabel: `${raw} 확인`,
        isStale: false,
        diffDays: 0,
      };
    }

    const seoulNow = getSeoulTimeParts(refDate);
    const nowUtcMs = Date.UTC(seoulNow.year, seoulNow.month - 1, seoulNow.day);
    const verUtcMs = Date.UTC(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10)
    );

    const diffDays = Math.max(
      0,
      Math.floor((nowUtcMs - verUtcMs) / (1000 * 60 * 60 * 24))
    );

    let relativeLabel = "오늘 확인";
    if (diffDays === 0) {
      relativeLabel = "오늘 확인";
    } else if (diffDays < 7) {
      relativeLabel = `${diffDays}일 전 확인`;
    } else if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      relativeLabel = `${weeks}주 전 확인`;
    } else if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      relativeLabel = `${months}개월 전 확인`;
    } else {
      const years = Math.floor(diffDays / 365);
      relativeLabel = `${years}년 전 확인`;
    }

    return {
      hasDate: true,
      relativeLabel,
      isStale: diffDays > 60,
      diffDays,
    };
  }

  /**
   * 폐업(status=폐업) 장소를 제외한 배열을 반환한다.
   */
  function filterActivePlaces(places) {
    if (!Array.isArray(places)) return [];
    return places.filter((p) => String(p.status || "운영").trim() !== "폐업");
  }

  const HoursEngine = {
    getSeoulTimeParts,
    createSeoulDateAtTime,
    createUpcomingSeoulDateAtTime,
    parseTimeToMinutes,
    formatMinutesToHHMM,
    parseTimeRangeString,
    buildPlaceSchedule,
    getPlaceBusinessStatus,
    is24HoursPlace,
    isLateNightByHours,
    getFormattedWeeklyHours,
    evaluateVerifiedAt,
    filterActivePlaces,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HoursEngine;
  }
  globalScope.HoursEngine = HoursEngine;
})(typeof window !== "undefined" ? window : globalThis);
