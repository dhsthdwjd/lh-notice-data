// GitHub Actions 에서 매시간 실행: LH 공고 수집 → docs/notices.json 갱신 → 새 공고 FCM 푸시
// 로컬 실행: LH_API_KEY=키 node scripts/sync.js   (FIREBASE_SERVICE_ACCOUNT 없으면 푸시는 건너뜀)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {TYPES, REGIONS, fetchNotices, buildMessages} = require("./lib");
const {fetchDetail} = require("./detail");

const OUT = path.join(__dirname, "..", "docs", "notices.json");
// 앱이 보여주는 기간과 맞춤: 공고일이 이보다 오래되면 파일에서 뺀다
const KEEP_DAYS = 120;
// 접수 중인 공고의 상세 정보는 이 시간이 지나면 다시 받는다
const DETAIL_TTL_MS = 20 * 3600 * 1000;
// 한 번 실행에 상세를 받을 최대 공고 수 (API 호출 = 이 값 × 2). 나머지는 다음 실행에
const DETAIL_PER_RUN = 120;

async function fetchJson(url) {
  const res = await fetch(url, {signal: AbortSignal.timeout(30_000)});
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

function readPrevious() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch (e) {
    return null;
  }
}

function kstToday(now) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 이전 파일과 새로 받은 공고를 합친다.
 * - 이번에 못 받은 공고(수집 실패·조회 기간 밖)는 KEEP_DAYS 안이면 이전 값 유지
 * - firstSeenAt 으로 처음 본 시각을 기억한다
 * 반환: {notices, newOnes}  (이전 파일이 없으면 첫 실행이라 newOnes 는 비움)
 */
function merge(prev, fetched, now) {
  const prevList = prev?.notices ?? [];
  const prevById = new Map(prevList.map((n) => [n.id, n]));
  const nowIso = now.toISOString();
  const cutoff = kstToday(new Date(now.getTime() - KEEP_DAYS * 86400 * 1000));

  const byId = new Map();
  for (const n of prevList) byId.set(n.id, n);
  const newOnes = [];
  for (const n of fetched) {
    const old = prevById.get(n.id);
    if (!old && prev && !byId.has(n.id)) newOnes.push(n);
    byId.set(n.id, {
      ...n,
      firstSeenAt: old?.firstSeenAt ?? nowIso,
      // 상세 정보는 따로 받으므로 이전 값을 이어받는다
      ...(old?.detail ? {detail: old.detail, detailAt: old.detailAt} : {}),
    });
  }
  const notices = [...byId.values()]
      .filter((n) => !n.noticeDate || n.noticeDate >= cutoff)
      .sort((a, b) =>
        (b.noticeDate ?? "").localeCompare(a.noticeDate ?? "") ||
        a.id.localeCompare(b.id));
  return {notices, newOnes};
}

function isClosed(n, today) {
  if (/마감|완료|취소/.test(n.status ?? "")) return true;
  return !!n.closeDate && n.closeDate < today;
}

/** 상세가 없거나(새 공고), 접수 중인데 오래된 공고의 상세·공급 정보를 채운다 */
async function fillDetails(key, notices, now) {
  const today = kstToday(now);
  const need = notices.filter((n) => n.codes && (
    !n.detailAt ||
    (!isClosed(n, today) && now - new Date(n.detailAt) > DETAIL_TTL_MS)));
  // 상세가 아예 없는 것 먼저, 그다음 접수 중 갱신
  need.sort((a, b) => (a.detailAt ? 1 : 0) - (b.detailAt ? 1 : 0));
  let ok = 0;
  let fail = 0;
  for (const n of need.slice(0, DETAIL_PER_RUN)) {
    try {
      n.detail = await fetchDetail({key, notice: n, fetchJson}) ?? undefined;
      n.detailAt = now.toISOString();
      ok++;
    } catch (e) {
      fail++;
      console.warn(e.message);
      if (/서비스키|LIMITED|TRAFFIC/i.test(e.message)) break; // 키·한도 문제면 그만
    }
  }
  console.log(`상세 정보: 대상 ${need.length}건 중 ${ok}건 갱신, 실패 ${fail}건`);
}

async function sendPush(newOnes) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.log("FIREBASE_SERVICE_ACCOUNT 없음: 푸시 건너뜀");
    return 0;
  }
  const admin = require("firebase-admin");
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(raw))});
  const msgs = buildMessages(newOnes);
  let sent = 0;
  for (let i = 0; i < msgs.length; i += 500) {
    const res = await admin.messaging().sendEach(msgs.slice(i, i + 500));
    sent += res.successCount;
  }
  return sent;
}

async function main() {
  const key = process.env.LH_API_KEY;
  if (!key) throw new Error("LH_API_KEY 환경변수가 없어요.");
  const now = new Date();

  const fetched = [];
  const failures = [];
  for (const typeCode of Object.keys(TYPES)) {
    for (const regionCode of Object.keys(REGIONS)) {
      try {
        fetched.push(...await fetchNotices({key, typeCode, regionCode, now, fetchJson}));
      } catch (e) {
        failures.push(`${regionCode}/${typeCode}: ${e.message}`);
      }
    }
  }
  if (failures.length) console.warn(`수집 실패 ${failures.length}건\n${failures.join("\n")}`);
  if (failures.length === Object.keys(TYPES).length * Object.keys(REGIONS).length) {
    throw new Error(`전체 수집 실패: ${failures[0]}`);
  }

  const prev = readPrevious();
  const {notices, newOnes} = merge(prev, fetched, now);
  await fillDetails(key, notices, now);

  // 내용이 같으면 파일을 건드리지 않는다 → 커밋·배포 없음
  if (prev && JSON.stringify(prev.notices) === JSON.stringify(notices)) {
    console.log(`변경 없음 (공고 ${notices.length}건)`);
    return;
  }

  fs.mkdirSync(path.dirname(OUT), {recursive: true});
  fs.writeFileSync(OUT, JSON.stringify({version: 1, updatedAt: now.toISOString(), notices}));

  const sent = newOnes.length ? await sendPush(newOnes) : 0;
  console.log(`공고 ${notices.length}건, 신규 ${newOnes.length}건, 알림 ${sent}건` +
    (prev ? "" : " (첫 실행: 알림 생략)"));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {merge, KEEP_DAYS};
