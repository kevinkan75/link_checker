# P6.5b Assessment

本文件記錄 P6.5b 實作前評估。P6.5b 的主軸是稽查語意、掃描安全邊界與誤判降低，會新增 report 欄位與 CLI / GUI / Analyzer fallback 行為。相較 P6.5a，P6.5b 風險更高，必須拆批實作，避免同時改動 security policy、robots / compliance、partial report 與 host retry 行為。

## 結論

採納 P6.5b 作為下一個主線，但不得一次合併所有交付項。建議拆成五個批次：

1. SSRF / URL security policy。
2. `runStatus` / partial report。
3. robots / compliance 記錄。
4. Retry-After / host diagnostics。
5. WAF signature schema 收斂。

優先順序以安全邊界為先。SSRF / private IP / metadata IP 防護應先於 robots、partial report 與 Retry-After，因為它會影響所有 request 路徑，也會成為後續遠端 rules 載入安全的共用基礎。

## 現況

- P6.5a 已完成輸出契約、redaction、sources/body limit 與 Header / Keep-Alive。
- P6.5b-1 已完成 SSRF / URL security policy、redirect 後重檢、CLI fallback 與 security policy report 欄位。
- WAF / Bot 診斷已有基礎欄位：`protection`、`suspectedWaf`、`suspectedBot`、body pattern 與 header evidence。
- 404 confirmation 已避開 `protected` / suspected WAF / Bot 結果，避免把防護頁誤判為一般 404。
- README 已明確說明目前只記錄 robots / compliance，不執行 robots.txt path enforcement，也不驗證使用者授權。
- P6.5b-2 已完成 `runStatus` / partial report，scan report 會正式產生 `runStatus`，diff 與 Report Analyzer 會提示 partial / failed report。
- P6.5b-3 已完成 robots / compliance 記錄，scan report 會正式產生 `summary.robotsTxt`、`scanPolicy` 與 `compliance`。
- P6.5b-4 已完成 Retry-After / host diagnostics，scan report 會正式產生 `summary.hostDiagnostics`。

## 建議切分

### P6.5b-1：SSRF / URL security policy

狀態：已完成第一版。

交付：

- 已預設阻擋 localhost、private IP、link-local、metadata IP、reserved IP 與 blocked scheme。
- 已在 request 前對 hostname 做 DNS resolve 後檢查。
- 已在 redirect 後重新檢查 target URL 與 resolved IP。
- CLI 已提供 `--block-private-ip` 預設開啟、`--allow-localhost`、`--allow-private-ip`。
- report 已記錄 `securityPolicy` 與 per-result security issue labels。

驗收：

- `http://127.0.0.1`、`http://localhost`、`http://169.254.169.254` 預設不請求。
- public hostname 解析到 private IP 時預設不請求。
- `--allow-localhost` 不得自動允許所有 private IP；`--allow-private-ip` 不得自動允許 localhost。
- redirect 到 private IP、metadata IP 或 blocked scheme 時停止 follow 並標記 security issue。
- IPv6 loopback、link-local、unique local 與 IPv4-mapped IPv6 需納入測試。

### P6.5b-2：runStatus / partial report（已完成）

優先級：高。

交付：

- report root 已新增 `runStatus`，支援 `complete`、`partial`、`failed`。
- GUI stop、queue stop、runtime error 會保存帶狀態的 report。
- report 記錄 `stoppedByUser`、`stopReason`、`failureReason`、`completedAt` 等最小狀態欄位。
- Analyzer / diff 讀到 partial / failed report 時顯示 warning，不當成完整掃描。

驗收：

- GUI stop 後能保存 report，且 `runStatus.status=partial`。
- runtime error report 不應被 Analyzer / diff 誤判為完整結果。
- 舊 report 沒有 `runStatus` 時仍可讀，並視為 legacy complete。

### P6.5b-3：robots / compliance 記錄（已完成）

優先級：高，但需保守。

交付：

- `summary.robotsTxt` 已記錄 start origin robots.txt 狀態、Crawl-delay、全站 Disallow、Allow / Disallow rule count 與 Sitemap。
- `scanPolicy` 已記錄 robots fetch 結果、是否停用 robots 記錄、是否僅 record-only。
- report root 已新增 `compliance`，記錄 purpose、scope、authorizedScanDeclared、robotsTxtPolicy、responseBodyStored、bodyHashEnabled 與授權免責說明。
- CLI 與 GUI 已提供 `--authorized-scan` / 授權宣告、`--authorization-note` / 授權備註、`--no-robots` / 不抓 robots.txt。

驗收：

- robots.txt 不存在或讀取失敗時掃描不中斷，report 有明確 `scanPolicy`。
- 未帶 `--authorized-scan` 時，report 不得宣稱已授權。
- external host 不套用同站授權 override 語意。
- 全站 Disallow 且無 Crawl-delay 時，最低降頻為 `effectiveDelayMs >= 2000`、`effectivePerHostConcurrency <= 1`。

### P6.5b-4：Retry-After / host diagnostics（已完成）

優先級：中高。

交付：

- 429 / 503 時已解析 `Retry-After` 秒數與 HTTP-date。
- 已設定 `retryAfterMaxMs` host cooldown 上限，避免掃描長時間卡住。
- cooldown 只影響該 host，不阻塞其他 host。
- report summary 已增加 `hostDiagnostics`，包含高 403 / 429 / suspected WAF/Bot 比例提示與 Retry-After cooldown 記錄。

驗收：

- `Retry-After` 不得讓掃描超過設定等待上限。
- 一個 host cooldown 時，其他 host 仍可繼續檢查。
- block-rate diagnostics 不得自動觸發 aggressive retry。

### P6.5b-5：WAF signature schema 收斂

優先級：中。

交付：

- 將現有 `protection` / body signature / WAF header evidence 收斂成穩定 report schema。
- 保存 provider、header evidence、body signature rule id，不保存完整 body。
- bodyHash 預設關閉，僅 diagnostics opt-in 可啟用。
- WAF body signature 命中時，不應被歸入一般 404。

驗收：

- WAF / Bot body signature 命中時 classification 不落入一般 `not_found`。
- `bodyHashEnabled=false` 是預設。
- report 不保存完整 challenge body。

## 風險評估

| 項目 | 風險 | 原因 | 控制方式 |
| --- | --- | --- | --- |
| SSRF / DNS resolve | 高 | IPv4、IPv6、IDN、redirect 與 DNS rebinding 邊界複雜 | 先做本機 fixture server 與逐欄 assertion |
| partial report | 中高 | 會牽動 GUI stop、Analyzer 與 diff normalization | 先建立最小 `runStatus` 契約 |
| robots / compliance | 中高 | 容易被誤寫成工具已驗證授權 | 只記錄使用者宣告與工具策略 |
| Retry-After | 中 | 過長等待會拖慢掃描 | 設等待上限且 per-host 生效 |
| WAF schema | 中 | 現有診斷已有欄位，需避免破壞相容性 | 以新增 schema 欄位為主，不重命名既有欄位 |

## 不納入 P6.5b

- robots path enforcement / `--respect-robots` 的嚴格 Disallow 路徑跳過。
- TTL URL result cache。
- incremental scan。
- adaptive backoff 完整策略。
- WAF/Bot 繞過、輪換 User-Agent、代理 IP 輪換、解 CAPTCHA 或模擬真人互動。
- 遠端 rules governance 的完整 schema；但 SSRF 基礎可供 P9 重用。

## 最低測試清單

- blocked scheme 測試。
- localhost / private IP / metadata IP 阻擋測試。
- public hostname resolve 到 private IP 測試。
- redirect 到 blocked target 測試。
- IPv6 loopback / link-local / unique local 測試。
- GUI stop partial report 測試。（P6.5b-2 已完成核心 runStatus 覆蓋）
- diff / Analyzer partial report warning 測試。（P6.5b-2 已完成）
- robots missing / fetch error / full disallow 測試。（P6.5b-3 已完成核心覆蓋）
- `--authorized-scan` 宣告欄位測試。（P6.5b-3 已完成）
- `Retry-After` capped wait 測試。（P6.5b-4 已完成）
- host cooldown 不阻塞其他 host 測試。（P6.5b-4 已完成）
- WAF signature classification 測試。
