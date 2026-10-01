"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const {parseDetail, num} = require("../scripts/detail");

const fx = (name) => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));
  return parseDetail(d.detail, d.supply);
};

test("숫자 변환: 금액·면적만, 안내 문구는 null", () => {
  assert.equal(num("504484000"), 504484000);
  assert.equal(num("26.37"), 26.37);
  assert.equal(num("공고문 참조"), null);
  assert.equal(num(""), null);
});

test("국민임대: 일정·단지·공급", () => {
  const r = fx("06_09_2015122300020692.json");
  assert.equal(r.schedule[0].applyStart, "2026-10-12");
  assert.equal(r.schedule[0].applyEnd, "2026-10-16");
  assert.equal(r.schedule[0].winnerDate, "2026-12-21");
  assert.equal(r.complexes[0].households, 996);
  assert.equal(r.summary.households, 150);
  assert.equal(r.supply[0].deposit, undefined); // "공고문 참조"
});

test("신혼희망 공공분양: 대상별 일정 여러 줄, 분양가 요약", () => {
  const r = fx("39_39_0000061179.json");
  assert.ok(r.schedule.length > 1);
  assert.equal(r.schedule[0].label, "사전청약당첨자");
  assert.equal(r.summary.priceKind, "price");
  assert.ok(r.summary.priceMin > 0);
  assert.ok(r.attachments.every((a) => a.url.startsWith("https://")));
});

test("든든전세(주거복지): 모집인원 합계, 임대조건", () => {
  const r = fx("13_26_2015122300020843.json");
  assert.equal(r.summary.households, 224);
  assert.match(r.leaseTerms, /시중임대료/);
  assert.ok(r.qualifications.length > 0);
});

test("빈 응답은 빈 객체", () => {
  assert.deepEqual(parseDetail([], []), {});
});
