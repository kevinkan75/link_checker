# 開發路線紀錄

## 狀態總覽

目前 P0-P5 已完成，包含 URL inventory、404 / 410 二次確認與外連風險治理 MVP。下一階段進入 P6 report diff；P7 cache、P8 incremental scan 與後續 Analyzer 強化都應建立在 P6 之後。

| 階段 | 狀態 | 重點 |
| --- | --- | --- |
| P0 | 已完成 | 單機版服務生命週期、idle shutdown、heartbeat。 |
| P1 | 已完成 | 結果模型、WAF/Bot/CDN 診斷、cache headers。 |
| P2 | 已完成 | URL canonical strategy 與 canonical key integration。 |
| P3 | 已完成 | URL inventory、來源合併、validation intent、validation queue。 |
| P4-0 | 已完成 | 404 / 410 分類與 UI 文案一致化。 |
| P4 | 已完成 | 404 / 410 二次確認 MVP。 |
| P5 | 已完成 | 外連風險規則、治理分類與風險摘要 MVP；CLI/report、GUI 匯出與 Analyzer 驗收通過。 |
| P6 | 下一個主要項目 | 兩份 report 歷史比對；只做 report-to-report diff。 |
| P7 | 待規劃 | TTL 檢查快取；晚於 P6。 |
| P8 | 待規劃 | 建立在 history/cache 上的增量掃描；晚於 P6/P7。 |

已完成基線：

- P0-P3：本機服務生命週期、結果模型、canonical key、URL inventory 與 validation queue。
- P4：同站 `404 / 410` 二次確認，輸出 `confirmation`、`transientFailure`、`needsReview`。
- P5：外連 `externalRisk`、治理規則、CSV / summary 與 Analyzer 最小呈現。

近期順序：

1. P6 report-to-report diff。
2. P7 TTL 檢查快取。
3. P8 增量掃描。
4. P9/P10 Analyzer 與分級排程強化。

下一個工作包：P6a report diff

1. 建立 `report-diff.mjs` CLI：`old-report.json` + `new-report.json` -> `diff.json`。
2. 實作 report normalization：新 report 優先 `checked[]`，舊 report fallback `broken[]`，外連獨立使用 `externalLinks[]`。
3. 實作 URL diff summary：新增、移除、變更、新發生問題、已修復、持續存在。
4. 實作 P4/P5 欄位 diff：`confirmation.outcome`、`transientFailure`、`confirmationNeedsReview`、`externalRisk`、`externalRiskNeedsReview`。
5. 先輸出 JSON 與簡短 console summary；GUI / Analyzer 呈現放到後續強化。

## 開發主軸

下一階段應優先聚焦在降低誤判、建立可延伸的檢查資料模型，以及補強治理分析，而不是先擴大爬取範圍或加入大型基礎設施。

核心設計方向：

```text
HTML 抽取
  -> URL resolve / canonicalize
  -> URL inventory 去重與來源合併
  -> HTTP validator 批次檢查
  -> 結果判讀、快取、歷史比對與報告呈現
```

現有實作已具備全域併發、per-host 併發限制、HEAD/GET fallback、redirect chain、retry 與外連盤點能力；後續開發應在這些能力上整理邊界，而不是重寫成熟的 HTTP 檢查邏輯。

CDN/WAF 處理邊界：

- 工具定位是辨識、降誤報、節流、保留證據與提示人工或站方協調。
- 可採用 WAF/Bot/CDN 感知分類與診斷欄位。
- 不採用繞過防護的策略，例如輪換身分、偽裝搜尋引擎、代理 IP 輪換、解 CAPTCHA 或模擬真人互動。

## 路線細節

### 已完成里程碑摘要

詳細設計與驗收紀錄已移至 [docs/ROADMAP_HISTORY.md](docs/ROADMAP_HISTORY.md)。

#### P0-P3 基礎能力（已完成）

- P0：單機版服務生命週期、idle shutdown、heartbeat、手動 shutdown。
- P1：結果模型補強、cache headers、CDN/WAF/Bot 診斷欄位。
- P2：URL canonical strategy 與 canonical key integration。
- P3：URL inventory、來源合併、validation intent、validation queue。

#### P4. 404 / 410 二次確認 MVP（已完成）

- 同站 `404 / 410` 在主掃描後集中二次確認。
- report 保留初次掃描結果，並新增 `confirmation`、`transientFailure`、`needsReview`。
- CLI、GUI、Analyzer 與 CSV 已接上最小呈現。
- 外連 `404 / 410` 不納入 P4 MVP confirmation 候選。

#### P5. 外連風險規則 MVP（已完成）

- `externalLinks[]` 每筆新增 `externalRisk`。
- 支援 `riskLevel`、`riskReasons`、`governanceStatus`、`matchedRules`、`needsReview`。
- `--external-risk-rules` 支援 allowlist、blocklist、watchlist。
- GUI 自動保存的 `external-links.csv` / `external-summary.json` 與 Analyzer 已支援 P5 欄位。
- P5 驗收通過，P6 可直接比對 `externalRisk` 與 governance 狀態。

### P6. 歷史比對

先做「兩份 report 比對」，再做完整 stateful incremental scan。

狀態：下一個主要項目。P6 只做 report-to-report diff，不引入常駐資料庫、cache 或增量掃描。

P6 評估結論：

- P6 可以開始，因 P4 confirmation 與 P5 externalRisk 已提供足夠穩定的 report schema。
- 第一版應做獨立 diff 工具，輸入兩份 `report.json`，輸出 JSON diff 與簡短 console summary。
- 不重新掃描、不重新判斷風險、不引入資料庫；P7 cache 與 P8 incremental scan 應維持後置。
- 新 report 優先用 `checked[]` 建立站內 URL index；舊 report 若沒有 `checked[]`，fallback 到 `broken[]`。
- 外連應從 `externalLinks[]` 建立獨立 index，不混入站內 broken repair 流程。
- 比對 key 優先使用 `canonicalUrl`，缺欄位時 fallback 到 `url`，以支援舊 report。
- `needsReview` 在 P4/P5 語意不同；P6 呈現時應拆開 `confirmationNeedsReview` 與 `externalRiskNeedsReview`，不要只合併成單一布林。

P6 MVP 範圍：

- 比對兩份 `report.json`。
- 顯示新增 URL、移除 URL、狀態改變、final URL 改變、redirect chain 改變。
- 顯示問題是否新發生、已修復、持續存在。
- 比對 `confirmation.outcome`、`needsReview`、`transientFailure` 與外連風險狀態。
- 輸出建議包含 `summary`、`added`、`removed`、`changed`、`newIssues`、`resolvedIssues`、`persistentIssues`、`externalRiskChanges`。
- 第一版 CLI 入口建議為 `node report-diff.mjs old-report.json new-report.json --output diff.json`。
- 比較欄位第一版收斂為 `ok`、`status`、`issueType`、`classification`、`finalUrl`、`redirected`、`redirectCount`、`redirectType`、`redirectIssues`、`confirmation.outcome`、`needsReview`、`transientFailure`、`externalRisk.riskLevel`、`externalRisk.governanceStatus`、`externalRisk.riskReasons`。
- 狀態判定第一版收斂為 `newIssue`、`resolvedIssue`、`persistentIssue`、`changed`、`riskIncreased`、`riskDecreased`、`confidenceIncreased`、`confidenceDecreased`。

P6 不納入：

- 不重新掃描網站。
- 不建立常駐資料庫。
- 不導入 TTL cache。
- 不做 incremental scan。
- 不先做大型 GUI / Analyzer 改版。

P6 後續 scan state 草案：

- 保存 scan state：

```js
{
  pages: {
    pageUrl: {
      contentHash,
      links: []
    }
  },
  urls: {
    canonicalUrl: {
      sources,
      firstSeenAt,
      lastSeenAt,
      lastCheckedAt
    }
  }
}
```

P6 驗收矩陣：

- 同一 canonical URL 從 `404` 變 `200` 應標示已修復。
- 同一 canonical URL 從 `200` 變 `404/410` 應標示新發生問題。
- `confirmation.outcome` 從 `needs_review` 變 `confirmed_missing` 應標示信心提高。
- 外連風險從 `low` 變 `high` 應進入治理摘要。
- 來源頁移除但 URL 仍在其他頁存在時，不應誤判 URL 完全移除。

理由：

- 歷史比對比單次掃描更符合治理需求。
- 先用 report diff 可快速落地，不必一開始就設計完整資料庫。

### P7. TTL 檢查快取

在 result model、inventory 與 P2b canonical key integration 穩定後加入持久化快取，避免大型內容庫每次全站重打外部 URL。

狀態：P6 後實作。P7 只處理可驗證的 URL result 快取，不先處理 page HTML cache。

建議 cache file：

```text
.cache/link-check-cache.json
```

cache key 應包含：

- `canonicalUrl`
- method policy
- userAgent hash
- accept language
- referer mode

cache value 應包含：

- result
- checkedAt
- expiresAt
- stableCount
- lastStatus
- lastFinalUrl

建議 TTL：

- 穩定 `200/204/3xx`：24 小時到 7 天。
- `404/410`：6 到 24 小時。
- `429/502/503/504/timeout`：5 到 30 分鐘。
- `blocked_waf/blocked_bot/rate_limited`：短 TTL 或不快取。
- `access_denied/auth_required`：短 TTL 或依站點規則決定是否快取。

CLI 可新增：

- `--cache`
- `--cache-file <file>`
- `--cache-ttl-hours <n>`
- `--no-cache`
- `--refresh-cache`

P7 驗收矩陣：

- 相同 canonical key、method policy、UA hash、語言與 referer mode 時可命中 cache。
- `404/410` 快取 TTL 應短於穩定 `200/204/3xx`。
- `429/timeout/5xx` 應短 TTL，避免長時間保留暫時性失敗。
- `blocked_waf/blocked_bot/rate_limited` 應短 TTL 或不快取。
- `--refresh-cache` 應忽略既有 cache 並回寫新結果。

理由：

- 大型站台與外部連結檢查需要控制頻率。
- 快取必須晚於 P1、P2b、P3，否則 key 與 result schema 容易返工。

### P8. 增量掃描

建立在 scan state 與 TTL cache 上，只優先檢查變更範圍。

狀態：P6/P7 後實作。P8 依賴 report diff、scan state 與 TTL cache，不應提前做。

- 優先檢查新頁面。
- 優先檢查 HTML hash 改變的頁面。
- 優先檢查新出現的 URL。
- 優先檢查上次錯誤或 retryable 的 URL。
- 跳過 TTL 未過期且穩定的 URL。

CLI 可新增：

- `--incremental`
- `--state-file <file>`
- `--changed-only`

P8 驗收矩陣：

- 新頁面與 hash 改變頁面應被優先掃描。
- 未變更頁面中的穩定 URL 若 TTL 未過期，應可跳過。
- 上次為 `needs_review`、timeout、redirect error 或 high risk 的 URL 應優先複查。
- 增量掃描 report 仍需保留完整可讀摘要，不能只輸出 delta。

理由：

- 增量掃描需要 inventory、history 與 cache 三者支撐。
- 若太早做，會被目前混合式流程卡住。

### P9. Analyzer 後續強化

P5c 已完成外連風險最小呈現；P9 只做 P6/P7/P8 之後的 Analyzer 強化，避免先做空 UI 或重複 P5c。

已具備：

- 顯示二次確認結果。
- 顯示外連風險分類與治理摘要。

後續強化：

- 顯示歷史比對：新增、移除、修復、惡化、持續存在。
- 顯示 cache 命中、TTL、上次檢查時間。
- 顯示高重複引用 URL 與影響頁面數。
- 顯示 redirect chain 詳細資訊。

理由：

- Analyzer 的價值來自穩定資料模型與規則結果。
- UI 應跟著治理問題設計，而不是單純堆欄位。

### P10. 分級排程

先設計排程建議，不急著做完整常駐 scheduler。

每個 URL 或 page 可計算：

```js
{
  priority: "high" | "normal" | "low",
  suggestedIntervalHours,
  reason
}
```

建議規則：

- 首頁、導覽列、站內頁：高頻。
- 站內圖片、CSS、JS：中頻。
- 外部連結：低頻。
- 上次錯誤、redirect error、timeout：高頻複查。
- `429` 或疑似 WAF/Bot 擋下：降低併發、延長 delay，避免密集重試。
- 外部站可加入每網域每分鐘與每路徑每分鐘限制；這應建立在 P7/P8 的快取與狀態資料後。
- 穩定 200 多次：降低頻率。

理由：

- 分級排程需要歷史、快取與穩定狀態。
- 先輸出「建議下次檢查時間」比直接做常駐排程更務實。

### P11. 輔助功能

這些功能有價值，但優先度低於誤判降低、資料模型、外連治理、歷史比對與快取。

- sitemap 支援。
- robots.txt 讀取與尊重策略。
- HTML / Excel 報表輸出。
- 環境變數設定。
- 更多匯入/匯出格式。

## 暫不納入近期主線

- 不使用 `rejectUnauthorized: false` 作為一般功能；TLS 問題優先使用既有 `--system-ca` 與 `--legacy-tls`。
- 不先導入 AI 分類、動態 JS 渲染、PostgreSQL、server-client 或 eGov 登入。
- 不做泛用 404 重試；404 二次確認應採條件式策略，避免拖慢整體掃描。
- 不以追蹤瀏覽器 process 作為關閉服務的主要機制；`Process.Start(url)` 無法可靠代表使用者是否仍開著該頁籤。
- 不把單機版改成常駐 Windows Service；目前需求是可預期地收尾本機工具，而不是背景服務化。
- 不預設啟用 aggressive URL canonicalization 作為去重、cache 或 validation key；避免把實際不同的資源錯誤合併。
- 不做輪換 User-Agent、偽裝 Googlebot、代理 IP 輪換、解 CAPTCHA、模擬真人互動或其他繞過 WAF/Bot 防護的策略。
- 不把 `200` 且 body 過短單獨判定為 `suspected_false_positive`；必須搭配 content-type、標頭、title 或 challenge pattern。
- 不對明確 WAF/Bot challenge 做多次 aggressive retry；這類結果應保存證據並提示調整掃描策略或與站方協調。
- 不保存完整 response body 作為診斷欄位，避免報告包含登入頁、錯誤頁或防護頁中的敏感內容。
