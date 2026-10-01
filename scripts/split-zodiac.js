// 띠별 운세 원본(source/daily_zodiac.json)을 날짜별 파일로 나눈다.
//   docs/zodiac/YYYY-MM-DD.json  (하루치 12띠, 약 6KB)
//   docs/zodiac/index.json       (기간·근거 안내)
// 원본을 바꾼 뒤 `npm run zodiac` 한 번 실행하고 커밋하면 된다. (1년에 한 번)
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "source", "daily_zodiac.json");
const OUT = path.join(__dirname, "..", "docs", "zodiac");
const ANIMALS = ["쥐띠", "소띠", "호랑이띠", "토끼띠", "용띠", "뱀띠", "말띠", "양띠", "원숭이띠", "닭띠", "개띠", "돼지띠"];
const FIELDS = ["overall", "money", "love", "advice", "keyword"];

const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
const days = src.days ?? [];
if (!days.length) throw new Error("days 가 비어 있어요.");

// 검사: 날짜 형식·중복, 12띠, 필드
const seen = new Set();
for (const d of days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) throw new Error(`날짜 형식 오류: ${d.date}`);
  if (seen.has(d.date)) throw new Error(`중복 날짜: ${d.date}`);
  seen.add(d.date);
  const names = d.zodiac.map((z) => z.animal);
  if (ANIMALS.some((a) => !names.includes(a)) || names.length !== 12) throw new Error(`${d.date}: 12띠가 아니에요`);
  for (const z of d.zodiac) {
    for (const f of FIELDS) if (!z[f]) throw new Error(`${d.date} ${z.animal}: ${f} 없음`);
  }
}

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});
for (const d of days) {
  // 띠 순서를 고정해서 저장
  const zodiac = ANIMALS.map((a) => d.zodiac.find((z) => z.animal === a));
  fs.writeFileSync(path.join(OUT, `${d.date}.json`), JSON.stringify({date: d.date, zodiac}));
}
const dates = days.map((d) => d.date).sort();
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({
  start: dates[0],
  end: dates[dates.length - 1],
  count: dates.length,
  note: src.basis?.note ?? "재미로 보는 운세예요.",
}));
console.log(`띠별 운세 ${dates.length}일치 → docs/zodiac/ (${dates[0]} ~ ${dates[dates.length - 1]})`);
