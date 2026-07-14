# P8 Incremental Scan Analysis

本文件記錄 P8：增量掃描的實作前分析。P8 的目標是降低重複 URL 驗證成本，並優先處理新 URL、變更來源、上次錯誤與高風險 URL；但不應改變 HTML discovery、inventory 建立與 `report.json` 主契約。

## 核心原則

P8 的邊界應定義為：

> 增量只影響「哪些 URL 要優先或重新驗證」，不影響「哪些頁面要被發現與建立 inventory」。

因此第一版不應用 state、sitemap 或舊 report 直接跳過 HTML page body fetch。`requireBody: true` 的頁面 crawl 仍必須抓取實際 HTML body，讓 `extractLinks()`、SPA payload extraction、site link rules、source tracking 與 inventory 維持完整。

P8 可以復用或降低優先級的是 status validation result，不是 discovery 本身。

## 是否需要比對舊 report

需要。舊 report 是 P8 的重要 baseline，特別適合第一次啟用 incremental scan 或使用者想指定比較基準時使用。

但舊 report 不應是唯一依據。舊 report 只能回答「以前是否看過這個 URL」，不能回答「這次網站上是否仍存在這個 URL」。本次是否存在，必須由本次 crawl 產生的 inventory 判斷。

建議支援兩種資料來源：

- `--baseline-report <file>`：使用指定舊 report 作為一次性 baseline。
- `--state-file <file>`：使用長期 scan state 作為持續追蹤資料。

P7 persistent TTL cache 只負責 URL status result 是否仍可復用，不負責判斷 URL 是否仍存在於網站。

## URL 新舊判斷

新舊判斷應使用 canonical key，而不是直接比較原始 URL 字串。

流程建議：

```text
本次 crawl
  -> 抓 HTML body
  -> 抽取 links / SPA payload / site rules
  -> 建立 current inventory canonical set

讀取舊 report / scan state
  -> 建立 previous canonical set

集合比對
  -> current - previous = new URLs
  -> previous - current = disappeared URLs
  -> current ∩ previous = known URLs
```

舊 report 至少應讀取下列來源：

- `checked[].canonicalUrl` / `checked[].url`
- `broken[].canonicalUrl` / `broken[].url`
- `externalLinks[].canonicalUrl` / `externalLinks[].url`

若 canonical strategy、URL normalization 或 policy fingerprint 和目前執行不同，舊資料不可直接視為完全可復用，只能作為弱參考或要求重查。

## 增量分類

P8 應把本次 inventory 中的 URL 分成下列類型：

| 分類 | 判斷條件 | 建議行為 |
| --- | --- | --- |
| `new` | 本次 canonical key 不存在於舊 report/state | 必查 |
| `source_changed` | URL 已知，但來源頁、source context 或頁面 link inventory hash 改變 | 優先查 |
| `previous_error` | 上次 broken、timeout、network error、5xx、429、protected、suspected WAF/Bot 或 needs review | 優先查 |
| `policy_mismatch` | userAgent、acceptLanguage、checkExternal、preferGet、externalReferer、robots、安全設定、canonical strategy 或 rules 改變 | 必查 |
| `ttl_expired` | P7 cache/state TTL 已到期 | 查 |
| `unstable_redirect` | 上次有 redirect、finalUrl 變化、long redirect、cross-host redirect 或 confirmation needs review | 優先查 |
| `stable_known` | 舊資料存在、上次穩定、policy 相同且 TTL 未到期 | 可復用 state/cache，並標記 reused |
| `disappeared` | 舊 report/state 有，但本次 inventory 未發現 | 不列入本次 checked；可在 incremental summary 記錄 |

`stable_known` 若被復用，report 需要清楚標記，例如 `incremental.reused` 或 result-level `incrementalReused: true`，避免使用者誤以為該 URL 是本輪實測。

## Scope 邊界

### 應納入 P8

- 讀取 baseline report 或 scan state。
- 建立 previous canonical URL set。
- 比對 current inventory 與 previous set。
- 對 validation queue 加入 incremental priority。
- 優先重查新 URL、上次錯誤、policy mismatch、TTL expired 與 redirect 不穩定 URL。
- 在 report summary 記錄 incremental 統計。
- 寫回 scan state，保存下次可用的安全摘要。

### 不應納入 P8 第一版

- page HTML cache。
- 因 sitemap 或 state 跳過 HTML inventory discovery。
- 只輸出 delta 的 `changed-only` report。
- 用舊 report 直接取代本次 sources。
- 將 P7 cache 當成 URL 是否仍存在於網站的依據。
- 常駐 scheduler 或治理排程；這應留給 P10。

## P1-P5.5 相容性矩陣

P8 會讀取舊 report/state，並可能復用 status result。因此它必須尊重 P1-P5.5 已建立的資料語意，不可讓增量模式破壞既有 report、GUI、Analyzer 或 CSV 的解讀。

| 既有階段 | 既有能力 | P8 衝突風險 | P8 規劃邊界 |
| --- | --- | --- | --- |
| P1 結果模型 | `checkedAt`、`canonicalUrl`、cache headers、WAF/Bot/CDN 診斷 | 復用舊 result 可能讓診斷證據過期 | reused result 必須標記；WAF/Bot、429、timeout、5xx 不應長期復用 |
| P2 canonical key | `canonicalStrategy`、canonical URL、代表 URL 與實際 fetch URL 分離 | canonical policy 不同時會誤判 new/known 或錯誤合併 | state/baseline 必須保存 policy fingerprint；canonical strategy 不同時視為 `policy_mismatch` |
| P3 inventory | inventory 合併 URL、保留 sources、validation intent 分層 | 若 P8 跳過 discovery，`sources`、`sourceCount`、`externalLinks` join 會失真 | 本次 sources 一律來自 current inventory；舊 report/state 不可取代 sources |
| P4 404/410 confirmation | 主掃描後集中複查，不覆蓋初次結果 | 舊 `404/410` 或 `needs_review` 直接復用會保留已修復錯誤 | previous not_found、transient failure、needs review 一律優先重查 |
| P5 external risk | `externalLinks[].externalRisk`、治理狀態、風險原因 | 規則或 checked result 改變時，舊 externalRisk 可能不有效 | rules / policy fingerprint 不同時重算；HTTP-derived risk 需標示來自 reused 或 current result |
| P5.5 SPA / Nuxt | SPA detection、payload extraction、site link rules、checkedByKind、scanQuality | 跳過 body extraction 會漏掉 script payload 或 site-rule-derived URL | `--spa-links` 與 `--site-link-rules` 流程不可被 baseline/state/sitemap 繞過 |

驗證後的結論是：P1-P5.5 不是 P8 的阻礙，而是 P8 的安全邊界。P8 應接在 inventory 與 validation scheduling 之間，不能插到 HTML discovery 之前。

## 復用與重算規則

P8 需要明確區分「可沿用的事實」與「必須由本次掃描產生的事實」。

### 可沿用或參考

- 舊 report/state 中的 canonical URL set，用來判斷 known / new / disappeared。
- 上次 result summary，用來判斷 previous error、unstable redirect、TTL 與 priority。
- P7 cache 中仍有效的 `requireBody: false` status result。
- 舊 report 的 `externalRisk`，僅能在 rules / policy fingerprint 相同且 result 可復用時作為參考。

### 必須由本次掃描產生

- page HTML body 與 `requireBody: true` crawl result。
- HTML attribute links、SPA payload links、site-rule-derived links。
- current inventory、sources、sourceCount、sourceType 與 source page context。
- current `scanQuality`、`spaDetection`、`checkedByKind`。
- policy mismatch 判斷後需要重查的 status result。
- previous error、not_found、transient failure、needs review 的最新狀態。

### 可復用但必須標記

若 `--changed-only` 或後續 reuse 模式復用舊 status result，該 result 必須在 report 中可追溯。建議新增 additive 欄位，避免改變既有欄位語意：

```js
{
  incremental: {
    mode,
    classification,
    reused,
    reuseSource,
    baselineCheckedAt,
    reason
  }
}
```

其中 `reuseSource` 可為 `state`、`baseline_report` 或 `p7_cache`。`reason` 應使用固定 vocabulary，例如 `stable_known`、`ttl_valid`、`policy_match`。

## Scan State 建議資料

`scan state` 應是本機效能最佳化與追蹤資料，不取代 `report.json` 主契約。建議形狀：

```js
{
  stateSchemaVersion,
  policyVersion,
  generator,
  startUrl,
  startOrigin,
  policyFingerprint,
  updatedAt,
  urls: {
    [canonicalKey]: {
      canonicalUrlHash,
      displayUrl,
      firstSeenAt,
      lastSeenAt,
      lastCheckedAt,
      lastRunId,
      lastStatus,
      lastOk,
      lastIssueType,
      lastClassification,
      lastFinalUrlHash,
      lastRedirectCount,
      lastSourceCount,
      sourcePageHashes,
      ttlExpiresAt,
      unstable,
      previousError,
      resultSummary
    }
  }
}
```

安全邊界：

- 不保存未遮罩 sensitive query value。
- `displayUrl` 應沿用 redaction 後的展示值。
- key 應使用 canonical URL hash 或 canonical key，不應將敏感原始 URL 當成 state 主鍵。
- `resultSummary` 只保存可復用判斷需要的欄位，不保存 response body。

## Suggested Implementation Slices

## 2026-07-14 feasibility recommendation

結論：P8 可以開始，但第一輪應聚焦在「資料模型、state、分類與排序」，不要直接啟用 `changed-only` result reuse。

建議採用下列落地原則：

- 先做 P8a + P8b：讀取 baseline report / scan state、建立 previous canonical set、輸出 `summary.incremental`，並用 incremental classification 調整 validation priority。
- scan state 需要先做，但只做最小版；否則 P8 只能像一次性的 report diff，無法長期記住 `firstSeenAt`、`lastSeenAt`、上次分類與 policy fingerprint。
- 第一版 scan state 預設可放在 `.cache/link-check-state.json`，並允許 `--state-file <file>` 覆寫。
- P8a 可以同時支援 `--baseline-report <file>` 與 `--state-file <file>`；baseline report 適合第一次啟用或手動指定比較基準，scan state 則是長期增量記憶。
- P8a / P8b 不應跳過任何 status validation；只標記 `new`、`known`、`disappeared`、`previous_error`、`policy_mismatch` 等分類與優先順序。
- P8c 的 `--changed-only` / reused result 必須等 P8a/P8b 測試穩定後再做，且只能復用 `stable_known`、policy match、TTL valid、非 previous error 的 status result。
- sitemap 可做為 seed 或 priority signal，但不得取代 HTML discovery 或 current inventory。

最小 scan state 欄位建議：

```js
{
  stateSchemaVersion,
  policyVersion,
  startUrl,
  startOrigin,
  policyFingerprint,
  updatedAt,
  urls: {
    [canonicalKey]: {
      displayUrl,
      firstSeenAt,
      lastSeenAt,
      lastCheckedAt,
      lastStatus,
      lastOk,
      lastIssueType,
      lastClassification,
      lastSourceCount,
      lastFinalUrlHash,
      previousError
    }
  }
}
```

第一階段不納入：

- state 管理 UI。
- 清除 state。
- 多 profile state。
- sitemap state。
- result reuse。
- `changed-only`。
- 複雜 source hash / page hash。

### P8a：baseline/state loader

目標：先建立資料模型與報告摘要，不改掃描行為。

- 新增 `--baseline-report <file>`。
- 新增 `--incremental`、`--state-file <file>` 與 `--no-incremental-state-write` 的 CLI skeleton；預設 state 檔可先放 `.cache/link-check-state.json`。
- 從 baseline report/state 建立 previous canonical set。
- 建立 policy fingerprint，至少涵蓋 canonical strategy、UA、Accept-Language、checkExternal、preferGet、externalReferer、robots/security policy、rules source。
- 在 report `options` 中記錄 incremental 設定。
- 在 report `summary.incremental` 顯示 new / known / disappeared / policyMismatch / baselineWarnings 計數。
- 不啟用 reused result。
- 寫入最小 scan state，至少保存 redacted display URL、firstSeenAt、lastSeenAt、last checked summary、policy fingerprint 與 previous error signal；不保存 response body。

### P8b：incremental priority

目標：讓增量開始降低實際等待時間，但仍保持完整檢查語意。

- 接入現有 `validationQueue` priority。
- `new`、`previous_error`、`policy_mismatch`、`ttl_expired`、`unstable_redirect` 排前面。
- `stable_known` 排後面，但仍可檢查；第一版不省略。
- 保留 P5.5 既有外連、內容頁、文件、media、asset priority，再疊加 incremental priority，不直接覆蓋。
- 補測試確保 HTML discovery 不被 baseline/state 跳過。

### P8c：changed-only / reuse

目標：正式降低 status validation 量。

- `--changed-only` 只允許復用 `stable_known`，且必須 policy match、TTL valid、非 previous error。
- report 仍輸出完整 summary，不只輸出 delta。
- reused result 必須有明確標記。
- policy mismatch、previous error、TTL expired 不能復用。
- current inventory 與 sources 仍完整建立；舊 sources 不可帶入本次 report。
- confirmation 結果不可無條件復用；`confirmed_missing` 可作參考，但本次若仍分類為 not_found，應按 P4 規則重新確認或明確標示未確認。

### P8d：sitemap

目標：用 sitemap 輔助 seed 與優先級，不取代 HTML discovery。

- 新增 `--sitemap <url-or-file>`。
- 支援 sitemap index、urlset 與 `lastmod`。
- sitemap unchanged 只能降低 priority，不可跳過頁面 discovery。
- 設定 sitemap URL 數量與深度上限。

### P8e：文件、GUI 與 Analyzer 最小呈現

目標：讓使用者能分辨 current check 與 reused result。

- CLI help 補 `--incremental`、`--baseline-report`、`--state-file`、`--no-incremental-state-write`、`--changed-only`、`--sitemap`。
- print summary 顯示 incremental new / known / reused / priority / disappeared 計數。
- GUI 第一版可不新增完整 state 管理介面，但需能顯示 report 中的 incremental summary。
- Analyzer 讀到 reused result 時應顯示標記；舊 report 沒有 incremental 欄位時保持相容。

## GUI 呈現建議

GUI 的增量掃描應整合到既有「檢查網站」流程，不另開獨立頁面。使用者心智應維持為「同樣開始檢查，但這次參考上次結果」，而不是進入一個需要理解 state file、policy fingerprint 或 cache schema 的技術流程。

### 設定入口

建議放在既有「進階設定」中新增一個 `增量掃描` 區塊。

P8e 第一版最小設定：

```text
增量掃描
[ ] 啟用增量掃描

基準來源
(•) 自動使用上次同網站紀錄
( ) 選擇既有 report.json
( ) 只建立本次 state，不使用基準

掃描模式
(•) 優先重查新 URL 與上次問題
( ) 只重查變更項目
```

預設建議：

- `啟用增量掃描` 預設關閉。
- 啟用後預設使用「優先重查新 URL 與上次問題」，不要預設 `changed-only`。
- `changed-only` 應放在同區塊的進階選項，並提示「仍會完整爬頁與建立 inventory」。
- 第一版不讓使用者手填 arbitrary state file path；GUI 可使用工具管理的同網站 state。

### 執行中狀態

現有 GUI 已有頁面數、檢查數、問題數與即時事件。P8 可在狀態區增加一組簡短統計：

```text
新增 URL 12
已知 URL 320
優先重查 28
復用結果 210
設定變更重查 3
```

執行中文案應避免「跳過頁面」這類容易誤導的字眼。建議使用：

- 正在建立本次連結清單。
- 正在比對上次結果。
- 正在優先檢查新 URL 與上次問題。
- 正在套用可復用的穩定結果。

### 完成後摘要

報告完成後，GUI 可在摘要區顯示 `summary.incremental`：

```text
增量掃描：已啟用
基準：上次同網站紀錄
新增 URL：12
本次重查：94
復用結果：210
上次存在但本次未發現：8
```

若發生 policy mismatch，顯示非阻斷提示：

```text
部分舊結果因設定變更已重新檢查。
```

### 問題連結標記

問題連結表格可加小型 badge，讓使用者知道每筆結果從何而來：

- `新增`
- `上次也有`
- `已重查`
- `復用`
- `設定變更重查`
- `上次需複查`

`復用` 必須明顯，因為它不是本輪實際驗證結果。若 reused result 進入 `broken[]`，GUI 應能顯示 baseline checked time 或 reuse source，避免誤解為剛剛檢查出的問題。

### 批次佇列

批次掃描時，增量設定應由整批共用，避免每個佇列項目有過多技術設定。佇列表格可顯示：

```text
增量：自動
基準：有 / 無
模式：優先重查
```

P8e 第一版不需要 state 管理頁。若使用者需要清除 state，可先放在後續 P9 或 P10 評估。

### 不建議第一版納入

- 不新增複雜 state file 管理頁。
- 不讓使用者手動編輯 policy fingerprint。
- 不把 `changed-only` 做成醒目的主按鈕。
- 不把增量掃描描述成「只掃變更頁面」。
- 不在 GUI 裡暴露 cache schema、state schema、hash key 等內部細節。

最小可行 GUI 是：

1. 進階設定加 `啟用增量掃描`。
2. 掃描完成後顯示 `summary.incremental`。
3. 問題連結上標示 `新增 / 已重查 / 復用`。

## 驗收建議

- 同一 URL 在舊 report 中存在，本次 inventory 也發現時，分類為 `known`。
- 本次 inventory 發現舊 report 沒有的 canonical key 時，分類為 `new` 並必查。
- 舊 report 有但本次 inventory 沒發現時，記錄為 `disappeared`，但不列入本次 checked。
- 改變 `userAgent`、`checkExternal`、security policy 或 canonical strategy 時，既有 URL 分類為 `policy_mismatch` 並重查。
- 上次 `404`、`410`、`5xx`、`429`、timeout、protected 或 needs review 的 URL 在 incremental 模式下優先重查。
- `--changed-only` 仍產生完整 summary，且 reused URL 明確標記為 reused。
- `requireBody: true` 的頁面 crawl 不命中 persistent status cache，也不被 baseline/state 跳過。
- state file 不含未遮罩 sensitive query value。
- P3 驗收：同一 URL 多 sources 時，本次 report 的 `sourceCount` 來自 current inventory，不來自舊 report/state。
- P4 驗收：舊 report 的 `404/410`、`needs_review`、`transientFailure` 在 incremental 模式下優先重查，不被 stable reuse 吃掉。
- P5 驗收：external risk rules 改變時，既有外連分類為 policy mismatch 或 risk recompute，不直接復用舊 `externalRisk`。
- P5.5 驗收：`--spa-links auto/strict` 與 `--site-link-rules` 的 payload URL 在 incremental 模式下仍會被 current discovery 發現。
- P7 驗收：P7 cache 命中只影響 `requireBody: false` status check，不減少 `pagesCrawled`、`urlsDiscovered` 或 source tracking。
- P6 相容：P8 產生的新 additive 欄位不得破壞 `report-diff.mjs` 讀取既有 `checked[]`、`broken[]`、`externalLinks[]`。
- GUI 驗收：啟用增量掃描時，使用者能看到 incremental summary，並能分辨 current check 與 reused result。
- GUI 驗收：`changed-only` 不能被呈現為「跳過頁面」或「只掃變更頁面」，說明必須保留完整 discovery。
- GUI 驗收：批次佇列能顯示每個項目的增量狀態，但第一版不要求逐項編輯 state。

## 建議結論

P8 第一階段應先做 baseline/state 與 priority，不急著做 `changed-only` 和 sitemap。這能先取得低風險的效能收益，也能驗證 canonical set、policy fingerprint、incremental summary 與 P1-P5.5 相容性是否穩定。

最重要的設計線是：

> 用 state 判斷「驗證成本怎麼花」，不要用 state 判斷「網站有哪些連結」。

落地順序建議為 P8a -> P8b -> P8c -> P8d -> P8e；若 P8a/P8b 的相容測試未穩定，不應提前啟用 `--changed-only` 的 result reuse。
