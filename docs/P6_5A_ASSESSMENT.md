# P6.5a Assessment

本文件原為 P6.5a 實作前評估，現已回填完成狀態；最新主線請以 [../ROADMAP.md](../ROADMAP.md) 為準。

本文件記錄 P6.5a 實作前評估。P6.5a 名義上是低風險穩定性修補，範圍不引入 robots / compliance 語意，也不改掃描結果來源；但實作會觸及 report 契約、輸出脫敏、response body 讀取與 connection pool，因此整體風險應視為中等，需拆小批次落地。

## 結論

採納 P6.5a 作為下一個主線，但不得一次合併所有交付項。建議拆成四個批次：

1. 契約與輸出版本化。
2. 輸出安全與相容性。
3. 來源數上限與 body limit。
4. Header / Accept-Encoding / Keep-Alive。

每批次都應保持日常輸出檔名穩定，並避免改變現有 URL discovery、canonical key、確認流程與外連治理判斷。

## 現況

- P6 diff 已有 `schemaVersion` / `generator`，且能把缺少 `schemaVersion` 的舊 report 視為 legacy。
- P6.5a-1 已讓 scan report root 加入 `schemaVersion` / `generator`。
- P6.5a-2 已加入輸出層 URL query redaction，預設套用於 report、CSV、events log、manifest 與 GUI 保存檔。
- P6.5a-3 已加入 `maxSourcesPerUrl` 與 body byte limit，避免 sources 與大型 response 無限制膨脹。
- P6.5a-4 已加入 Accept header 分流、`gzip` / `deflate`、`--no-keep-alive` 與 per-host concurrency 驗證。
- `schemas/` 目前已有 `diff.schema.json` 與 P6.5a-1 的 `report.schema.json` 草案。
- GUI 會保存 `summary.json`、`report.json`、`broken.csv`、`external-links.csv`、`external-summary.json`、`events.log`、`README.txt` 與 `manifest.json`。
- CSV 目前已輸出 UTF-8 BOM，P6.5a 需補回歸測試而非重做格式。
- response body 已有 capped reader；後續仍可依實測調整預設 bytes。

## 建議切分

### P6.5a-1：契約與輸出版本化

狀態：已完成第一版。

交付：

- scan report root 已新增 `schemaVersion` / `generator`。
- 已新增 `schemas/report.schema.json` 草案，先約束 root、options、summary、checked、broken、externalLinks 的最低契約。
- CLI / GUI 已產出同目錄 `manifest.json`，記錄工具版本、schema versions、generatedAt、startUrl、optionsProfile、runtimeVersion 與 generated files。
- 保持 `report.json`、`summary.json`、`external-summary.json`、`diff.json` 檔名穩定。

驗收：

- 舊 report 仍可被 `report-diff.mjs` normalization 讀取。
- 新 report 可被 `report-diff.mjs` 讀取且不產生 legacy warning。
- GUI 與 CLI 產出的 manifest 欄位一致。
- `diff.json` 既有 schema / generator 行為不退化。

### P6.5a-2：輸出安全與相容性

狀態：已完成第一版。

交付：

- 已建立集中式 URL query redaction helper。
- 預設遮罩 token、session、auth、password、email、jwt、signature、api_key 等高風險 query value。
- redaction 已套用於 report、CSV、events log、manifest 與 GUI 保存檔。
- 實際 request URL、canonical key 與比對邏輯不使用遮罩後 URL。
- 已補 CSV BOM 與 redaction 回歸測試。

驗收：

- report、CSV、events log 不輸出未遮罩的高風險 query value。
- 同一 URL 的實際請求與 canonicalization 不因 redaction 改變。
- Excel 可直接開啟 `broken.csv` 與 `external-links.csv` 中文內容。

### P6.5a-3：sources 上限與 body limit

狀態：已完成第一版。

交付：

- 已新增 `maxSourcesPerUrl`，保留 `sourceCount`，超過上限時輸出 `sourcesTruncated=true`。
- 已新增 `maxHtmlBytes`、`maxBodyPreviewBytes`、`maxDownloadProbeBytes`。
- 超過上限時會輸出 `bodyTruncated` / `bodyBytesRead`。
- HTML 抽取、diagnostic body、download probe 已改成有 byte cap 的讀取路徑。
- response body 抽取或診斷完成後會及早釋放或取消。

驗收：

- 同一 canonical URL 來源超過上限時，`sourceCount` 保持完整數量，`sources` 只保留上限內資料，`sourcesTruncated=true`。
- 大型 HTML / PDF / media 不會被完整讀入記憶體。
- HTML 被截斷時 report 有明確 truncated 標記。
- WAF / Bot 診斷仍能使用 preview，不保存完整 body。

### P6.5a-4：Header / Accept-Encoding / Keep-Alive

狀態：已完成第一版。

交付：

- Accept header 已依 request intent 分流：page-like 使用 document request Accept，asset/media/document 使用 `*/*`。
- Accept-Encoding 已啟用並測試 `gzip` / `deflate`；`br` 暫不啟用。
- Keep-Alive connection pool 受 global concurrency 與 per-host concurrency 約束。
- 已提供 `--no-keep-alive` 回退，並在 report options / manifest 記錄 effective 設定。

驗收：

- 壓縮 HTML 仍能正常抽取連結。
- 啟用 Keep-Alive 後，同一 host in-flight request 不超過 `perHostConcurrency`。
- `--no-keep-alive` 可回復非 keep-alive 行為。
- legacy TLS 路徑不因 keep-alive 或 encoding 改動失效。

## 風險評估

| 項目 | 風險 | 原因 | 控制方式 |
| --- | --- | --- | --- |
| report schema / generator | 低 | 主要是新增 root metadata | 保持舊欄位語意與 legacy fallback |
| manifest | 低 | 新增旁路輸出，不改 report 主體 | CLI / GUI 共用 manifest builder |
| CSV BOM | 低 | 現況已有 BOM | 補測試即可 |
| `maxSourcesPerUrl` | 中低 | 會改 `sources` 陣列長度 | 保留 `sourceCount` 與 `sourcesTruncated` |
| URL redaction | 中 | 容易誤傷 request URL 或 canonical key | 僅在輸出序列化層套用 |
| body limit | 中高 | 會改 fetch body 讀取路徑 | 先導入 capped reader 與 fixture server 測試 |
| Accept-Encoding | 中 | runtime 行為與 legacy TLS 路徑需驗證 | 先 gzip / deflate，br 延後或 gated |
| Keep-Alive | 中高 | 可能影響併發、釋放與 timeout | 保留 `--no-keep-alive`，測 per-host limit |

## 不納入 P6.5a

- robots path enforcement。
- `--authorized-scan` 與 compliance 語意。
- SSRF / private IP / metadata IP 防護。
- WAF signature schema 擴充。
- Retry-After / host cooldown。
- partial report / runStatus。
- TTL cache、incremental scan、NDJSON 主格式、Bloom Filter、headless render。

以上項目維持落在 P6.5b 或後續階段，避免 P6.5a 同時改變輸出契約、網路安全策略與掃描語意。

## 實作順序建議

1. 先做 `schemaVersion` / `generator` / `report.schema.json` / `manifest.json`，建立可追溯輸出基線。
2. 再做 redaction 與 CSV / events log 測試，確認敏感 query 不外洩且 request 不受影響。
3. 接著做 `maxSourcesPerUrl`，因為它能降低報告尺寸且不需碰 fetch。
4. 最後做 body limit、Accept-Encoding 與 Keep-Alive，並用本機測試 server 驗證壓縮、截斷、釋放與 per-host concurrency。

## 最低測試清單

- legacy report diff 測試。
- 新 report diff 測試。
- report root shape 測試。
- manifest generated files 測試。
- sensitive query redaction 測試。
- actual request URL not redacted 測試。
- CSV BOM 測試。
- `maxSourcesPerUrl` / `sourcesTruncated` 測試。
- large body truncated 測試。
- gzip / deflate HTML extraction 測試。
- Keep-Alive per-host concurrency 測試。
