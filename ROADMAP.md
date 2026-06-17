# 開發路線紀錄

## 下一階段建議順序

下一階段應優先聚焦在降低誤判與補強治理分析，而不是先擴大爬取範圍。

建議開發順序：

1. 404 二次確認
2. 外連風險規則
3. 歷史比對
4. Analyzer 呈現
5. sitemap / robots / 報表輸出等輔助功能

理由：

- 404 二次確認可直接降低「掃描當下回 404、瀏覽器或稍後重試為 200」的誤判。
- 外連風險規則可建立在既有外連盤點與網域分類能力上，補足白名單、黑名單與異常網址治理。
- 歷史比對比單次掃描更符合政府網站治理需求，可看出新增、移除與狀態變化。
- Analyzer 呈現應在底層資料與規則結果穩定後再補，避免先做空的 UI。
- sitemap、robots、HTML/Excel 報表與環境變數等功能有價值，但屬於輔助能力，優先度低於誤判降低與治理分析。

暫不納入近期主線：

- 不使用 `rejectUnauthorized: false` 作為一般功能；TLS 問題優先使用既有 `--system-ca` 與 `--legacy-tls`。
- 不先導入 AI 分類、動態 JS 渲染、PostgreSQL、server-client 或 eGov 登入。
- 不做泛用 404 重試；404 二次確認應採條件式策略，避免拖慢整體掃描。

### 404 二次確認 MVP

- 以使用者可勾選的設定提供，GUI 預設開啟。
- CLI 對應提供 `--confirm-404` 與 `--no-confirm-404`。
- 執行時機放在主掃描完成後、輸出報告前，作為集中複查階段。
- 第一版只針對同站 `404/410` 複查，外部連結先不納入。
- 複查使用 `GET`，帶來源頁 `Referer` 與瀏覽器相容 User-Agent。
- User-Agent 策略：一般掃描保留瀏覽器相容 UA 加工具識別；404 二次確認與保守模式使用純瀏覽器相容 UA；不使用或冒充 Googlebot UA。
- 複查請求使用核心瀏覽器式 headers：`User-Agent`、`Accept`、`Accept-Language`、`Referer`；不預設手動加入 `Cache-Control: no-cache` 或強制覆蓋 `Accept-Encoding`。
- 內建低速策略：每筆前加入 `1000-3000ms` jitter，全域複查併發 `2`，每 host 併發 `1`。
- 第一版限制全域最多複查 `100` 筆、每 host 最多複查 `20` 筆，避免大量 404 拖慢報告產出。
- 報告保留初次結果，新增 `confirmation`、`transientFailure`、`needsReview` 等欄位。
- Analyzer 顯示是否啟用二次確認，以及「二次確認後已恢復 / 需複查 / 確認不存在」等狀態。

