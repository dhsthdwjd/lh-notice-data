// LH 분양임대공고문 API 호출·가공 로직 (Firebase 없이도 테스트 가능하게 분리)
"use strict";

const LH_URL =
  "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1";

// 공고 유형 (UPP_AIS_TP_CD)
const TYPES = {
  "06": "임대주택",
  "13": "주거복지",
  "05": "분양주택",
  "39": "신혼희망타운",
};

// 지역 (CNP_CD) - LH API 기준 시도 코드
const REGIONS = {
  "11": "서울",
  "26": "부산",
  "27": "대구",
  "28": "인천",
  "29": "광주",
  "30": "대전",
  "31": "울산",
  "36": "세종",
  "41": "경기",
  "42": "강원",
  "43": "충북",
  "44": "충남",
  "45": "전북",
  "46": "전남",
  "47": "경북",
  "48": "경남",
  "50": "제주",
};

const PAGE_SIZE = 100;

/** Date → "YYYY.MM.DD" (한국 시간 기준) */
function lhDate(date) {
  const kst = new Date(date.getTime() + 9 * 3600 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}.${m}.${d}`;
}

/** "2026.09.30" / "20260930" / "2026-09-30" → "2026-09-30" (못 읽으면 null) */
function toIso(v) {
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, "");
  if (digits.length < 8) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** 응답이 중첩 배열이라 PAN_ID 가진 객체를 재귀로 모은다 */
function collectRows(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((n) => collectRows(n, out));
  } else if (node && typeof node === "object") {
    if ("PAN_ID" in node) {
      out.push(node);
    } else {
      Object.values(node).forEach((n) => collectRows(n, out));
    }
  }
  return out;
}

/** 인증키 오류 등은 XML 문자열이나 SS_CODE != Y 로 온다 */
function apiError(body) {
  if (typeof body === "string") {
    const m = body.match(/<returnAuthMsg>([^<]+)</) ||
      body.match(/<errMsg>([^<]+)</);
    return m ? m[1] : "JSON이 아닌 응답";
  }
  const headers = [];
  let gateway = null;
  (function walk(n) {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      // 키 미등록 등 게이트웨이 오류는 JSON 으로도 온다
      if (n.cmmMsgHeader) {
        const h = n.cmmMsgHeader;
        gateway = h.returnAuthMsg || h.errMsg || "API 게이트웨이 오류";
      }
      if (n.resHeader) headers.push(...[].concat(n.resHeader));
      Object.values(n).forEach(walk);
    }
  })(body);
  if (gateway) return gateway;
  const bad = headers.find((h) => h && h.SS_CODE && h.SS_CODE !== "Y");
  return bad ? `SS_CODE=${bad.SS_CODE}` : null;
}

// 주거용이 아닌 공고 (세부 유형에 이 말이 있으면 수집·알림에서 뺀다). 앱 values/arrays.xml 과 같게
const NON_RESIDENTIAL = ["어린이집", "상가", "점포", "토지", "용지", "주차장", "근린"];

function isResidential(n) {
  const t = n.detailType ?? "";
  return !NON_RESIDENTIAL.some((w) => t.includes(w));
}

/** API 한 줄 → 앱에서 쓰는 공고 객체 */
function toNotice(r, typeCode, regionCode) {
  const url = str(r.DTL_URL);
  const mobileUrl = str(r.DTL_URL_MOB);
  const isHttp = (u) => !!u && /^https?:\/\//.test(u);
  return {
    id: String(r.PAN_ID),
    name: str(r.PAN_NM) || `LH 공고 ${r.PAN_ID}`,
    typeCode,
    typeName: str(r.UPP_AIS_TP_NM) || TYPES[typeCode] || null,
    detailType: str(r.AIS_TP_CD_NM),
    regionCode,
    regionName: str(r.CNP_CD_NM) || REGIONS[regionCode] || null,
    status: str(r.PAN_SS),
    noticeDate: toIso(r.PAN_NT_ST_DT) || toIso(r.PAN_DT),
    closeDate: toIso(r.CLSG_DT),
    url: isHttp(url) ? url : null,
    mobileUrl: isHttp(mobileUrl) ? mobileUrl : null,
    // 상세·공급 API 호출에 필요한 코드
    codes: {
      spl: str(r.SPL_INF_TP_CD),
      ccr: str(r.CCR_CNNT_SYS_DS_CD),
      upp: str(r.UPP_AIS_TP_CD) || typeCode,
      ais: str(r.AIS_TP_CD),
    },
  };
}

/**
 * 한 지역·한 유형의 공고를 전부 가져온다.
 * fetchJson(url) 은 파싱된 JSON 또는 문자열을 돌려주는 함수 (테스트용 주입).
 */
async function fetchNotices({key, typeCode, regionCode, now, fetchJson}) {
  const from = lhDate(new Date(now.getTime() - 60 * 86400 * 1000));
  const to = lhDate(new Date(now.getTime() + 730 * 86400 * 1000));
  const got = new Map();
  let expected = null;
  for (let page = 1; page <= 30; page++) {
    const qs = new URLSearchParams({
      PG_SZ: String(PAGE_SIZE),
      PAGE: String(page),
      UPP_AIS_TP_CD: typeCode,
      CNP_CD: regionCode,
      PAN_NT_ST_DT: from,
      CLSG_DT: to,
    });
    // 인증키는 이미 URL 인코딩된 키/디코딩 키 둘 다 올 수 있어 따로 붙인다
    const url = `${LH_URL}?serviceKey=${encodeKey(key)}&${qs}`;
    const body = await fetchJson(url);
    const err = apiError(body);
    if (err) throw new Error(`LH API 오류(${regionCode}/${typeCode}): ${err}`);
    const rows = collectRows(body);
    if (expected == null) {
      const c = rows.map((r) => Number(r.ALL_CNT)).find(Number.isFinite);
      expected = c ?? rows.length;
    }
    rows.forEach((r) => got.set(String(r.PAN_ID), r));
    if (rows.length < PAGE_SIZE || got.size >= expected) break;
  }
  return [...got.values()].map((r) => toNotice(r, typeCode, regionCode));
}

function encodeKey(key) {
  // 이미 인코딩된 키(%2B 등 포함)는 그대로, 아니면 인코딩
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

function topicOf(regionCode, typeCode) {
  return `lh_${regionCode}_${typeCode}`;
}

/** 같은 토픽으로 가는 새 공고를 묶어 알림 메시지 목록을 만든다 */
function buildMessages(newNotices) {
  const byTopic = new Map();
  for (const n of newNotices) {
    const t = topicOf(n.regionCode, n.typeCode);
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(n);
  }
  const msgs = [];
  for (const [topic, list] of byTopic) {
    const first = list[0];
    const region = first.regionName || REGIONS[first.regionCode] || "";
    const type = first.detailType || first.typeName || "";
    const title = list.length === 1 ?
      `[${region}] 새 ${type} 공고` :
      `[${region}] 새 ${TYPES[first.typeCode] || type} 공고 ${list.length}건`;
    const body = list.length === 1 ?
      first.name :
      `${first.name} 외 ${list.length - 1}건`;
    msgs.push({
      topic,
      notification: {title, body},
      data: {panId: list.length === 1 ? first.id : ""},
      android: {
        priority: "high",
        notification: {channelId: "new_notice"},
      },
    });
  }
  return msgs;
}

module.exports = {
  str,
  isResidential,
  NON_RESIDENTIAL,
  encodeKey,
  TYPES,
  REGIONS,
  lhDate,
  toIso,
  collectRows,
  apiError,
  toNotice,
  fetchNotices,
  topicOf,
  buildMessages,
};
