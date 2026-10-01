// 상세정보·공급정보 API 실제 응답 확인용. 유형별 공고 몇 건으로 호출해 probe/ 폴더에 저장한다.
// 사용: npm run probe   (실행하면 인증키를 물어봄)
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const {TYPES, lhDate, collectRows, apiError} = require("./lib");

const BASE = "https://apis.data.go.kr/B552555";
const LIST = `${BASE}/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1`;
const DTL = `${BASE}/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1`;
const SPL = `${BASE}/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1`;
const OUT = path.join(__dirname, "..", "probe");

const enc = (k) => (/%[0-9A-Fa-f]{2}/.test(k) ? k : encodeURIComponent(k));

async function get(url) {
  const text = await (await fetch(url, {signal: AbortSignal.timeout(30_000)})).text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

async function main() {
  let key = process.env.LH_API_KEY;
  if (!key) {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
    key = (await rl.question("공공데이터포털 인증키를 붙여넣으세요: ")).trim();
    rl.close();
  }
  fs.mkdirSync(OUT, {recursive: true});
  const now = new Date();
  const from = lhDate(new Date(now.getTime() - 60 * 86400e3));
  const to = lhDate(new Date(now.getTime() + 730 * 86400e3));

  for (const typeCode of Object.keys(TYPES)) {
    const qs = new URLSearchParams({PG_SZ: "30", PAGE: "1", UPP_AIS_TP_CD: typeCode, PAN_NT_ST_DT: from, CLSG_DT: to});
    const list = await get(`${LIST}?serviceKey=${enc(key)}&${qs}`);
    const err = apiError(list);
    if (err) throw new Error(`목록 오류: ${err}`);
    // 세부 유형(AIS_TP_CD)이 다른 공고를 골고루 최대 3건
    const seen = new Set();
    const picks = collectRows(list).filter((r) => !seen.has(r.AIS_TP_CD) && seen.add(r.AIS_TP_CD)).slice(0, 3);
    for (const r of picks) {
      const p = new URLSearchParams({
        SPL_INF_TP_CD: r.SPL_INF_TP_CD, CCR_CNNT_SYS_DS_CD: r.CCR_CNNT_SYS_DS_CD,
        PAN_ID: r.PAN_ID, UPP_AIS_TP_CD: r.UPP_AIS_TP_CD, AIS_TP_CD: r.AIS_TP_CD ?? "",
      });
      const dtl = await get(`${DTL}?serviceKey=${enc(key)}&${p}`);
      const spl = await get(`${SPL}?serviceKey=${enc(key)}&${p}`);
      const file = path.join(OUT, `${typeCode}_${r.AIS_TP_CD}_${r.PAN_ID}.json`);
      fs.writeFileSync(file, JSON.stringify({notice: r, detail: dtl, supply: spl}, null, 2));
      const e1 = apiError(dtl);
      const e2 = apiError(spl);
      console.log(`${TYPES[typeCode]} / ${r.AIS_TP_CD_NM} / ${r.PAN_NM.slice(0, 30)}  상세:${e1 ?? "OK"} 공급:${e2 ?? "OK"}`);
    }
  }
  console.log(`\n저장: ${OUT}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
