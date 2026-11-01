# 3D Fairy Character Asset Generation Prompts (`assets/fairy/`)

경희대 카공맵의 3D 요정 마스코트 에셋을 직접 재생성하거나 포즈를 추가할 때 사용하는 프롬프트 가이드입니다.
참고 이미지(`assets/fairy-reference.png`)를 함께 첨부하고 아래 프롬프트에서 `Pose: [...]` 부분만 변경해 생성한 뒤, 배경을 투명하게(PNG/WebP, `@2x`, 개당 80KB 이하) 저장해 사용합니다.

---

## 공통 베이스 프롬프트 (Base Prompt)

```text
A cute 3D character render based on the reference drawing: a small fairy with a round white head, two black dot eyes, a tiny smile, a simple white dress-shaped body and small translucent wings with a soft iridescent rainbow sheen, holding a small rainbow-gradient sparkle star. Soft matte clay / vinyl toy material, gentle studio lighting, subtle soft shadow, pastel and clean, keep the original proportions and simple face. Pose: [POSE]. Transparent background, centered, no text.
```

---

## 포즈별 파일명 및 프롬프트

### 1. `fairy-trio.webp` (첫 진입 시 시트 상단 인사 / `og:image`)
```text
A cute 3D character render based on the reference drawing: a small fairy with a round white head, two black dot eyes, a tiny smile, a simple white dress-shaped body and small translucent wings with a soft iridescent rainbow sheen, holding a small rainbow-gradient sparkle star. Soft matte clay / vinyl toy material, gentle studio lighting, subtle soft shadow, pastel and clean, keep the original proportions and simple face. Pose: three fairies standing side by side, the middle one slightly bigger, smiling. Transparent background, centered, no text.
```

### 2. `fairy-wave.webp` (상단 헤더 로고 옆 24px / 공유 카드)
```text
A cute 3D character render based on the reference drawing: a small fairy with a round white head, two black dot eyes, a tiny smile, a simple white dress-shaped body and small translucent wings with a soft iridescent rainbow sheen, holding a small rainbow-gradient sparkle star. Soft matte clay / vinyl toy material, gentle studio lighting, subtle soft shadow, pastel and clean, keep the original proportions and simple face. Pose: one single fairy waving one hand happily while holding a tiny rainbow-gradient sparkle star in the other hand, front view. Transparent background, centered, no text.
```

### 3. `fairy-head-pin.webp` (지도 기준점 핀)
```text
A cute 3D character render based on the reference drawing: a small fairy with a round white head, two black dot eyes, a tiny smile, a simple white dress-shaped body and small translucent wings with a soft iridescent rainbow sheen, holding a small rainbow-gradient sparkle star. Soft matte clay / vinyl toy material, gentle studio lighting, subtle soft shadow, pastel and clean, keep the original proportions and simple face. Pose: head only, front view, round white face with two black dot eyes, a tiny smile, and a tiny rainbow-gradient sparkle star on the cheek. Transparent background, centered, no text.
```

### 4. `fairy-fly.webp` (로딩 "자리 알아보는 중…" / 내 위치 찾는 중)
```text
A cute 3D character render based on the reference drawing: a small fairy with a round white head, two black dot eyes, a tiny smile, a simple white dress-shaped body and small translucent wings with a soft iridescent rainbow sheen, holding a small rainbow-gradient sparkle star. Soft matte clay / vinyl toy material, gentle studio lighting, subtle soft shadow, pastel and clean, keep the original proportions and simple face. Pose: flying sideways in profile view, holding a small rainbow-gradient sparkle star forward. Transparent background, centered, no text.
```

### 5. `fairy-sleep.webp` (0곳 결과 / 영업 종료만 남았을 때 / 밤 1시 이후 첫 화면 한마디)
```text
A cute 3D character render based on the reference drawing: a small fairy with a round white head, two black dot eyes, a tiny smile, a simple white dress-shaped body and small translucent wings with a soft iridescent rainbow sheen, holding a small rainbow-gradient sparkle star. Soft matte clay / vinyl toy material, gentle studio lighting, subtle soft shadow, pastel and clean, keep the original proportions and simple face. Pose: sleeping peacefully with closed eyes, resting its head on the rainbow-gradient sparkle star like a pillow. Transparent background, centered, no text.
```
