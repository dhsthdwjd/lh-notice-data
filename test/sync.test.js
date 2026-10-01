"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {merge} = require("../scripts/sync");

const now = new Date("2026-10-01T03:00:00Z");
const n = (id, noticeDate = "2026-09-30", extra = {}) => ({id, name: `공고 ${id}`, noticeDate, ...extra});

test("첫 실행은 신규 알림 없음", () => {
  const {notices, newOnes} = merge(null, [n("a"), n("b")], now);
  assert.equal(notices.length, 2);
  assert.equal(newOnes.length, 0);
  assert.ok(notices[0].firstSeenAt);
});

test("이전에 없던 공고만 신규", () => {
  const {notices: prev} = merge(null, [n("a")], now);
  const {newOnes} = merge({notices: prev}, [n("a"), n("b")], now);
  assert.deepEqual(newOnes.map((x) => x.id), ["b"]);
});

test("firstSeenAt 유지, 내용 갱신", () => {
  const {notices: prev} = merge(null, [n("a", "2026-09-30", {status: "공고중"})], new Date("2026-09-30T00:00:00Z"));
  const {notices} = merge({notices: prev}, [n("a", "2026-09-30", {status: "접수중"})], now);
  assert.equal(notices[0].status, "접수중");
  assert.equal(notices[0].firstSeenAt, prev[0].firstSeenAt);
});

test("이번에 못 받은 공고는 기간 안이면 유지, 오래되면 제거", () => {
  const prev = {notices: [n("old", "2026-05-01"), n("keep", "2026-09-01")]};
  const {notices} = merge(prev, [n("a")], now);
  assert.deepEqual(notices.map((x) => x.id).sort(), ["a", "keep"]);
});

test("공고일 최신순 정렬", () => {
  const {notices} = merge(null, [n("x", "2026-09-01"), n("y", "2026-09-20")], now);
  assert.deepEqual(notices.map((x) => x.id), ["y", "x"]);
});

test("같은 공고가 여러 지역 조회에 나와도 신규 1건", () => {
  const {notices: prev} = merge(null, [n("a")], now);
  const {newOnes} = merge({notices: prev}, [n("b", "2026-09-30", {regionCode: "11"}), n("b", "2026-09-30", {regionCode: "41"})], now);
  assert.equal(newOnes.length, 1);
});

test("다시 받은 공고도 이전 상세 정보 유지", () => {
  const prev = {notices: [{...n("a"), firstSeenAt: "x", detail: {summary: {households: 3}}, detailAt: "t"}]};
  const {notices} = merge(prev, [n("a", "2026-09-30", {status: "접수중"})], now);
  assert.equal(notices[0].detail.summary.households, 3);
  assert.equal(notices[0].detailAt, "t");
  assert.equal(notices[0].status, "접수중");
});

test("어린이집·상가 등 비주거 공고는 목록·알림에서 제외", () => {
  const {notices: prev} = merge(null, [n("a")], now);
  const {notices, newOnes} = merge({notices: prev}, [
    n("a"), n("kids", "2026-09-30", {detailType: "가정어린이집"}), n("shop", "2026-09-30", {detailType: "단지내상가"}),
    n("home", "2026-09-30", {detailType: "행복주택"}),
  ], now);
  assert.deepEqual(notices.map((x) => x.id).sort(), ["a", "home"]);
  assert.deepEqual(newOnes.map((x) => x.id), ["home"]);
});
