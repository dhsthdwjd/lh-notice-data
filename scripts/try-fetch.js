// 배포 전에 내 컴퓨터에서 인증키·응답을 확인하는 스크립트
// 사용: npm run try -- [지역코드] [유형코드]  (키는 실행 후 입력, 또는 LH_API_KEY 환경변수)
"use strict";

const readline = require("node:readline/promises");
const {fetchNotices} = require("./lib");

async function askKey() {
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
  });
  const answer = await rl.question("공공데이터포털 인증키를 붙여넣으세요: ");
  rl.close();
  return answer.trim();
}
const regionCode = process.argv[2] || "41";
const typeCode = process.argv[3] || "06";

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

(async () => {
  const key = process.env.LH_API_KEY || await askKey();
  if (!key) throw new Error("인증키가 비어 있어요.");
  return fetchNotices({key, typeCode, regionCode, now: new Date(), fetchJson});
})()
    .then((list) => {
      console.log(`${regionCode}/${typeCode}: ${list.length}건`);
      list.slice(0, 5).forEach((n) => console.log(n));
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
