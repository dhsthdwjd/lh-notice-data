// 테스트 알림 보내기: notices.json 에서 해당 지역·유형의 최신 공고 하나로 실제와 같은 알림을 보낸다.
// 사용: FIREBASE_SERVICE_ACCOUNT='{...}' node scripts/test-push.js 41 06
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {buildMessages, topicOf, REGIONS, TYPES} = require("./lib");

async function main() {
  const regionCode = process.argv[2] || "41";
  const typeCode = process.argv[3] || "06";
  if (!REGIONS[regionCode] || !TYPES[typeCode]) throw new Error(`지역(${regionCode}) 또는 유형(${typeCode}) 코드가 잘못됐어요.`);
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT 가 없어요.");

  const file = path.join(__dirname, "..", "docs", "notices.json");
  const {notices} = JSON.parse(fs.readFileSync(file, "utf8"));
  const n = notices.find((x) => x.regionCode === regionCode && x.typeCode === typeCode) ??
    {id: "", name: "테스트 공고", regionCode, typeCode, regionName: REGIONS[regionCode]};

  const [msg] = buildMessages([n]);
  msg.notification.title = `[테스트] ${msg.notification.title}`;

  const admin = require("firebase-admin");
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(raw))});
  const id = await admin.messaging().send(msg);
  console.log(`보냄: 토픽 ${topicOf(regionCode, typeCode)} / ${msg.notification.title} / ${msg.notification.body}`);
  console.log(`공고 ID: ${n.id || "(없음 - 목록만 열림)"}  메시지 ID: ${id}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
