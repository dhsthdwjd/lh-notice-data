# lh-notice-data

LH 공고 알림 앱의 데이터 저장소. GitHub Actions 가 매시간(한국시간 07~22시) LH 분양임대공고를 수집해
`docs/notices.json` 을 갱신하고, GitHub Pages 로 배포한다. 앱은 이 파일 하나만 받는다.

- 데이터 주소: `https://<사용자명>.github.io/lh-notice-data/notices.json`
- 새 공고가 생기면 FCM 토픽(`lh_{지역}_{유형}`)으로 푸시를 보낸다.

## 처음 설정

1. **Secrets** (Settings → Secrets and variables → Actions → New repository secret)
   - `LH_API_KEY`: 공공데이터포털 인증키
   - `FIREBASE_SERVICE_ACCOUNT`: Firebase 서비스 계정 키 JSON 전체 (푸시용)
2. **Pages** (Settings → Pages): Source = Deploy from a branch, Branch = `main`, 폴더 = `/docs`
3. **Actions** 탭 → `sync` → Run workflow 로 한 번 실행해서 확인

## 로컬

```bash
npm install
npm test
LH_API_KEY=키 npm run sync   # FIREBASE_SERVICE_ACCOUNT 없으면 푸시는 건너뜀
```

## 파일 형식

```json
{ "version": 1, "updatedAt": "ISO 시각", "notices": [ { "id", "name", "typeCode", "typeName",
  "detailType", "regionCode", "regionName", "status", "noticeDate", "closeDate", "url",
  "mobileUrl", "firstSeenAt" } ] }
```
