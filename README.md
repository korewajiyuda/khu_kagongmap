# 경희대 카공맵 — 지금 열려 있는 카공 카페를 상황별로 찾는 지도 웹앱

경희대학교 서울캠퍼스·국제캠퍼스 재학생을 위한 모바일 우선(390×844 기준, 최대 480px) 카공 카페 탐색 서비스입니다.

## 1. 파일 구조
- `index.html`: 지도 앱 레이아웃(상단 1줄 헤더 + 전체화면 지도 + 3단계 드래그 바텀시트), Open Graph(`og:image`, `twitter:image`), Lucide 선 아이콘 시스템
- `style.css`: 따뜻한 화이트(`#FFFFFF` / `#FAFAF7`), 단일 무지개 그라데이션 포인트, 레이아웃 시프트 없는 상황 카드 및 칩 시스템
- `hours.js`: `Asia/Seoul` 기준 실시간 영업시간·브레이크타임·정기휴무·자정 넘김·임시휴업·폐업 및 정보 확인일(`verified_at`) 계산 엔진
- `app.js`: 구글 시트 CSV(`GOOGLE_SHEET_CSV_URL`) 및 로컬 `data.csv` 병합 파서, 8종 상황 카드(`mood`) + 세부 조건 미리보기, 시간대 시뮬레이션("언제 갈 거예요?"), CARTO Positron 지도 및 3단계 바텀시트 제어, GA4 이벤트 트래킹
- `data.csv`: 서울캠·국제캠 총 60개 장소 데이터 (기존 39개 장소 + Gemini Pro 발굴 신규 카페 21곳 통합, 19개 확장 컬럼 스키마 반영, `카페봉영로` 쉼표 이스케이프 수정 완료)
- `test-hours.html`: `hours.js` 영업시간 계산 엔진 필수 테스트 케이스 검증 페이지
- `assets/fairy/`: 3D 요정 캐릭터 에셋 5종(`fairy-trio.webp`, `fairy-wave.webp`, `fairy-head-pin.webp`, `fairy-fly.webp`, `fairy-sleep.webp`), 공유 썸네일(`og-image.png`), 생성 프롬프트(`PROMPTS.md`)

## 2. 데이터 스키마 (`data.csv` 및 구글 시트 공통, 총 60개 장소)
기존 12개 컬럼에 운영 상태·영업시간 상세 7개 컬럼을 더해 총 19개 컬럼을 지원합니다(빈 값이어도 기본값으로 안전하게 동작):
- 기본 컬럼: `id, campus, map, name, lat, lng, summary, tags, link, days, hours, outlets`
- 확장 컬럼:
  - `status`: `운영` / `임시휴업` / `폐업` (`폐업`은 지도·목록에서 자동 숨김, `임시휴업`은 회색 배지 표시)
  - `verified_at`: `YYYY-MM-DD` (마지막 정보 확인일, 60일 경과 시 `정보 확인 필요` 배지 표시)
  - `hours_detail`: 요일별 상세 영업시간 (예: `월-금 08:00-24:00; 토-일 10:00-22:00`)
  - `break_time`: 브레이크타임 (예: `15:00-16:00`)
  - `last_order`: 라스트오더 (예: `23:30`)
  - `closed_days`: 정기휴무 (예: `일` / `매월 2·4주 월`)
  - `note`: 특이사항 (예: `시험기간 24시간 연장`)
- 지원 태그: `콘센트많음`, `조용한`, `밤늦게까지`, `24시간`, `교내카페`, `1인석`, `대화가능`, `분위기좋음`, `단체석`, `저가`

## 3. 구글 시트 CSV 연동 및 배포
1. `app.js` 상단의 `GOOGLE_SHEET_CSV_URL`을 먼저 읽고, 실패하거나 비어 있는 확장 컬럼은 로컬 `data.csv`로 자동 보완합니다.
2. GA4 측정 ID는 `app.js`의 `GA_MEASUREMENT_ID` 상수에 입력하며, 비어 있으면 `gtag.js`를 로드하지 않습니다.
3. 정보 수정 제보 구글 폼 주소는 `REPORT_FORM_URL` 상수에 입력하며, 비어 있으면 제보 버튼을 숨깁니다.
