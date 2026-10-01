"use strict";

const test = require("node:test");
const assert = require("node:assert");
const lib = require("../scripts/lib");

function lhResponse(rows, all) {
  return [
    {dsSch: [{PG_SZ: "100"}]},
    {
      dsList: rows.map((r) => ({...r, ALL_CNT: String(all ?? rows.length)})),
      resHeader: [{SS_CODE: "Y"}],
    },
  ];
}

const row = (id, extra = {}) => ({
  PAN_ID: id,
  PAN_NM: `공고 ${id}`,
  UPP_AIS_TP_NM: "임대주택",
  AIS_TP_CD_NM: "행복주택",
  CNP_CD_NM: "경기도",
  PAN_SS: "공고중",
  PAN_NT_ST_DT: "2026.09.25",
  CLSG_DT: "2026.10.10",
  DTL_URL: "https://apply.lh.or.kr/x",
  ...extra,
});

test("날짜 변환", () => {
  assert.strictEqual(lib.toIso("2026.09.30"), "2026-09-30");
  assert.strictEqual(lib.toIso("20260930"), "2026-09-30");
  assert.strictEqual(lib.toIso(""), null);
  assert.strictEqual(lib.lhDate(new Date("2026-09-30T20:00:00Z")),
      "2026.10.01"); // KST 기준 다음 날
});

test("공고 변환", () => {
  const n = lib.toNotice(row("A1", {DTL_URL: "javascript:x"}), "06", "41");
  assert.strictEqual(n.id, "A1");
  assert.strictEqual(n.detailType, "행복주택");
  assert.strictEqual(n.noticeDate, "2026-09-25");
  assert.strictEqual(n.closeDate, "2026-10-10");
  assert.strictEqual(n.url, null);
});

test("여러 페이지를 모두 가져온다", async () => {
  const all = Array.from({length: 150}, (_, i) => row(`P${i}`));
  const urls = [];
  const list = await lib.fetchNotices({
    key: "abc+/=", typeCode: "06", regionCode: "41", now: new Date(),
    fetchJson: async (url) => {
      urls.push(url);
      const page = Number(new URL(url).searchParams.get("PAGE"));
      return lhResponse(all.slice((page - 1) * 100, page * 100), 150);
    },
  });
  assert.strictEqual(list.length, 150);
  assert.strictEqual(urls.length, 2);
  assert.ok(urls[0].includes("serviceKey=abc%2B%2F%3D"));
});

test("이미 인코딩된 키는 다시 인코딩하지 않는다", async () => {
  let seen;
  await lib.fetchNotices({
    key: "abc%2B", typeCode: "06", regionCode: "41", now: new Date(),
    fetchJson: async (url) => {
      seen = url;
      return lhResponse([]);
    },
  });
  assert.ok(seen.includes("serviceKey=abc%2B&"));
});

test("인증키 오류는 에러로", async () => {
  await assert.rejects(lib.fetchNotices({
    key: "k", typeCode: "06", regionCode: "41", now: new Date(),
    fetchJson: async () =>
      "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>" +
      "SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader>" +
      "</OpenAPI_ServiceResponse>",
  }), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
});

test("알림은 토픽별로 묶인다", () => {
  const a = lib.toNotice(row("A"), "06", "41");
  const b = lib.toNotice(row("B"), "06", "41");
  const c = lib.toNotice(row("C", {CNP_CD_NM: "서울특별시"}), "06", "11");
  const msgs = lib.buildMessages([a, b, c]);
  assert.strictEqual(msgs.length, 2);
  const gg = msgs.find((m) => m.topic === "lh_41_06");
  assert.match(gg.notification.title, /2건/);
  assert.strictEqual(gg.data.panId, "");
  const se = msgs.find((m) => m.topic === "lh_11_06");
  assert.strictEqual(se.data.panId, "C");
});
