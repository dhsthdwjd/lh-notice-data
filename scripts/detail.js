// 상세정보(lhLeaseNoticeDtlInfo1)·공급정보(lhLeaseNoticeSplInfo1) API → 앱이 쓰는 공통 형태
// 유형마다 필드 이름이 달라서 후보 이름을 차례로 본다.
"use strict";

const {toIso, str, apiError, encodeKey} = require("./lib");

const DTL_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeDtlInfo1/getLeaseNoticeDtlInfo1";
const SPL_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeSplInfo1/getLeaseNoticeSplInfo1";

/** 응답 배열에서 이름이 name 인 데이터셋의 행들 */
function ds(body, name) {
  if (!Array.isArray(body)) return [];
  for (const blk of body) {
    if (blk && Array.isArray(blk[name])) return blk[name];
  }
  return [];
}

/** 후보 필드 중 처음으로 값이 있는 것 ("~" 같은 빈 값 제외) */
function pick(o, ...keys) {
  for (const k of keys) {
    const v = str(o?.[k]);
    if (v && v !== "~") return v;
  }
  return null;
}

/** "504484000" → 504484000, "공고문 참조" → null */
function num(v) {
  if (v == null) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const cut = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
const http = (u) => (u && /^https?:\/\//.test(u) ? u : null);
const empty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !empty(v)));

function parseDetail(dtl, spl) {
  const schedule = ds(dtl, "dsSplScdl").map((r) => compact({
    label: pick(r, "HS_SBSC_ACP_TRG_CD_NM", "SBD_LGO_NM"),
    applyStart: toIso(pick(r, "SBSC_ACP_ST_DT")),
    applyEnd: toIso(pick(r, "SBSC_ACP_CLSG_DT")),
    applyTime: pick(r, "ACP_DTTM"),
    method: pick(r, "RMK"),
    docTargetDate: toIso(pick(r, "PPR_SBM_OPE_ANC_DT")),
    docStart: toIso(pick(r, "PPR_ACP_ST_DT", "PZWR_PPR_SBM_ST_DT")),
    docEnd: toIso(pick(r, "PPR_ACP_CLSG_DT", "PZWR_PPR_SBM_ED_DT")),
    winnerDate: toIso(pick(r, "PZWR_ANC_DT")),
    contractStart: toIso(pick(r, "CTRT_ST_DT")),
    contractEnd: toIso(pick(r, "CTRT_ED_DT")),
  })).filter((r) => Object.keys(r).some((k) => k !== "label"));

  const complexes = ds(dtl, "dsSbd").map((r) => compact({
    name: pick(r, "LCC_NT_NM", "BZDT_NM"),
    address: [pick(r, "LGDN_ADR", "LCT_ARA_ADR"), pick(r, "LGDN_DTL_ADR", "LCT_ARA_DTL_ADR")]
        .filter(Boolean).join(" ") || null,
    households: num(pick(r, "HSH_CNT", "SUM_TOT_HSH_CNT")),
    area: pick(r, "DDO_AR", "MIN_MAX_RSDN_DDO_AR"),
    heating: pick(r, "HTN_FMLA_DESC", "HTN_FMLA_DS_CD_NM"),
    moveIn: pick(r, "MVIN_XPC_YM"),
  })).filter((c) => c.name || c.address);

  const supply = ds(spl, "dsList01").map((r) => compact({
    type: pick(r, "HTY_NNA", "HTY_NM", "HTY_DS_NM"),
    complex: pick(r, "SBD_LGO_NM", "BZDT_NM", "DNG_HS_ADR"),
    region: pick(r, "SGG_NM"),
    area: num(pick(r, "DDO_AR", "RSDN_DDO_AR")),
    households: num(pick(r, "NOW_HSH_CNT", "SIL_HSH_CNT", "QUP_CNT")),
    totalHouseholds: num(pick(r, "HSH_CNT", "TOT_HSH_CNT")),
    deposit: num(pick(r, "LS_GMY")),
    rent: num(pick(r, "RFE")),
    price: num(pick(r, "SIL_AMT")),
  }));

  const attachments = ds(dtl, "dsAhflInfo").map((r) => compact({
    kind: pick(r, "SL_PAN_AHFL_DS_CD_NM"),
    name: pick(r, "CMN_AHFL_NM"),
    url: http(pick(r, "AHFL_URL")),
  })).filter((a) => a.url);

  const etc = ds(dtl, "dsEtcInfo")[0] ?? {};
  const place = ds(dtl, "dsCtrtPlc")[0] ?? {};
  const quals = ds(dtl, "dsEtcList").map((r) => compact({
    label: pick(r, "PAN_ETC_INF_CD_NM"),
    text: cut(pick(r, "ETC_CTS"), 800),
  })).filter((q) => q.text);

  // 카드 요약용
  const areas = supply.map((s) => s.area).filter((a) => a != null);
  const sumHh = supply.reduce((t, s) => t + (s.households ?? 0), 0);
  const prices = supply.map((s) => s.price ?? s.deposit).filter((p) => p != null);

  return compact({
    schedule,
    complexes,
    supply,
    attachments,
    qualifications: quals,
    leaseTerms: cut(pick(etc, "LSC_CTS"), 500),
    leasePeriod: cut(pick(etc, "LSTR_CTS"), 300),
    recruitArea: cut(pick(etc, "ARAG_RCR_HSH_CTS"), 500),
    notes: cut(pick(etc, "ETC_CTS", "ETC_FCTS", "ETC_CTS2", "CAU_FCTS"), 800),
    phone: pick(place, "SIL_OFC_TLNO"),
    summary: compact({
      households: sumHh || complexes.reduce((t, c) => t + (c.households ?? 0), 0) || null,
      areaMin: areas.length ? Math.min(...areas) : null,
      areaMax: areas.length ? Math.max(...areas) : null,
      priceMin: prices.length ? Math.min(...prices) : null,
      priceKind: supply.some((s) => s.price != null) ? "price" :
        supply.some((s) => s.deposit != null) ? "deposit" : null,
    }),
  });
}

/** 공고 하나의 상세·공급 정보를 받아 정리. codes 가 없으면 null */
async function fetchDetail({key, notice, fetchJson}) {
  const c = notice.codes;
  if (!c?.spl || !c?.ccr || !c?.upp) return null;
  const qs = new URLSearchParams({
    SPL_INF_TP_CD: c.spl, CCR_CNNT_SYS_DS_CD: c.ccr, PAN_ID: notice.id, UPP_AIS_TP_CD: c.upp,
    ...(c.ais ? {AIS_TP_CD: c.ais} : {}),
  });
  const dtl = await fetchJson(`${DTL_URL}?serviceKey=${encodeKey(key)}&${qs}`);
  const e1 = apiError(dtl);
  if (e1) throw new Error(`상세 API 오류(${notice.id}): ${e1}`);
  const spl = await fetchJson(`${SPL_URL}?serviceKey=${encodeKey(key)}&${qs}`);
  const e2 = apiError(spl);
  if (e2) throw new Error(`공급 API 오류(${notice.id}): ${e2}`);
  return parseDetail(dtl, spl);
}

module.exports = {parseDetail, fetchDetail, num, ds};
