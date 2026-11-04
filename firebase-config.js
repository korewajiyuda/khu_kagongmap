/**
 * firebase-config.js — 경희대 카공맵 실시간 "나 여기서 공부 중" 체크인 설정
 *
 * ※ Realtime Database 생성 시:
 * - '미국(us-central1)'으로 만든 경우 아래 기본 databaseURL 그대로 작동합니다.
 * - '싱가포르(asia-southeast1)'로 만든 경우 databaseURL을
 *   "https://khu-kagong-map-default-rtdb.asia-southeast1.firebasedatabase.app" 로 바꾸거나
 *   Realtime Database 화면 상단의 URL을 붙여넣어 주세요.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCdUWQAPTF3t5cLXsfcie8hBf6YEvqWxRk",
  authDomain: "khu-kagong-map.firebaseapp.com",
  databaseURL: "https://khu-kagong-map-default-rtdb.firebaseio.com",
  projectId: "khu-kagong-map",
  storageBucket: "khu-kagong-map.firebasestorage.app",
  messagingSenderId: "389002030529",
  appId: "1:389002030529:web:4e0af8d8c42b030df25340",
  measurementId: "G-DBQZF976CH",
};
