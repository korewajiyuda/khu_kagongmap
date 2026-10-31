# 경희대 구원맵 (카공맵 & 거지맵) — Google Gemini Ambassador

경희대 재학생을 위한 반경 500m 카공 카페 & 가성비 맛집 큐레이션 모바일 웹 서비스입니다.

## 1. 파일 구조
- `index.html`: 모바일 퍼스트 시맨틱 마크업, Pretendard 웹폰트, Leaflet.js(CDN), GA4(`gtag.js`) 기본 세팅
- `style.css`: Toss·캐치테이블 스타일 + Google Gemini Ambassador 시그니처 그라데이션 UI 시스템
- `app.js`: 구글 시트 CSV URL 연동(로컬 `data.csv` Fallback), 하버사인 500m 거리 계산, 다중 필터 칩, Leaflet 지도 & 바텀시트 요약 카드, 인앱 브라우저 대응 A2HS 바텀시트(`showA2HSPopup`), GA4 7종 이벤트 트래킹
- `data.csv`: 서울캠·국제캠 총 42개 장소 데이터 (소수점 4자리 위·경도 및 네이버 지도 검색 링크 포함)

## 2. 구글 시트 CSV 연동 방법
1. 구글 스프레드시트에서 **[파일] → [공유] → [웹에 게시]** 클릭
2. 게시 형식을 **쉼표로 구분된 값(.csv)** 으로 선택 후 게시된 URL 복사
3. `app.js` 최상단의 `GOOGLE_SHEET_CSV_URL` 상수에 URL 입력:
   ```js
   const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/.../pub?output=csv";
   ```
   *(비워두거나 네트워크 오류 발생 시 자동으로 로컬 `./data.csv`를 불러옵니다.)*

## 3. GitHub Pages 배포 방법
1. GitHub 새 저장소(Repository) 생성 후 `index.html`, `style.css`, `app.js`, `data.csv`, `README.md` 업로드
2. 저장소 **[Settings] → [Pages]** 이동
3. **Branch**를 `main` (또는 `master`) `/ (root)`로 선택 후 **Save** 클릭
