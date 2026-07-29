# Documentation Improvement Record

狀態：歷史文件維護紀錄。現行使用入口請看 [../../README.md](../../README.md)，現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，文件索引請看 [../README.md](../README.md)。

本文件記錄 README 與 ROADMAP 易讀性、一致性改善建議的採納狀態。

## 採納日期

2026-06-29

## 採納原則

- README 定位為第一次使用者與常用操作入口。
- ROADMAP 定位為目前進度、下一步與階段邊界入口。
- 技術細節、完整 CLI 參數、規則檔格式與歷史驗收紀錄分流到 `docs/` 或 `docs/archive/`。
- 安全邊界、授權提醒與防護阻擋判讀仍保留在入口文件，避免使用者誤用。

## README 採納項目

| 建議 | 採納狀態 | 落點 |
| --- | --- | --- |
| 明確界定 README 主要讀者 | 已採納 | README 開頭新增讀者定位與技術文件連結 |
| 調整章節順序為先操作、後技術 | 已採納 | README 改為工具簡介、適用情境、快速開始、GUI、CLI、輸出、判讀、進階功能 |
| 將開發階段資訊移出 README | 已採納 | README 僅保留目前可用功能，詳細主線連到 `ROADMAP.md` |
| 新增三步驟快速開始 | 已採納 | README `快速開始` |
| 將 GUI 說明提前 | 已採納 | README 先列 GUI，再列 CLI |
| 補充建議使用哪一種模式 | 已採納 | README `常見使用情境` 表格 |
| 統一外部連結 / 外連 | 已採納 | README 使用「外部連結」，技術欄位保留 `externalLinks` |
| 區分問題連結 / 失效連結 / 無效連結 | 已採納 | README `結果判讀` |
| 統一英文欄位呈現 | 已採納 | README 與 CLI reference 使用反引號標示欄位與檔名 |
| 統一檢查 / 掃描 / 爬行用語 | 已採納 | README 以「檢查」面向使用者，「掃描」「爬行」用於流程描述 |
| 將常用參數重新分組 | 已採納 | README `常用參數` |
| 將進階規則檔移至獨立章節 | 已採納 | 詳細格式移至 `docs/CLI_REFERENCE.md` |
| Report diff 移至進階功能 | 已採納 | README `進階功能` |
| 輸出檔案依使用者需求排序 | 已採納 | README `輸出檔案` 分一般與進階 |
| 結果判讀增加處理建議 | 已採納 | README `結果判讀` 表格 |
| 補充哪些結果不一定代表連結壞掉 | 已採納 | README `結果判讀` 開頭提醒 |
| 安全邊界集中於獨立章節 | 已採納 | README `安全邊界與授權` |
| robots.txt 說明簡化 | 已採納 | README `安全邊界與授權` |
| GUI 與 CLI 功能定位 | 已採納 | README `GUI 使用說明`、`CLI 基本使用`、`進階功能` |
| GUI 功能差異表簡化 | 已採納 | README `GUI / CLI 功能差異` |
| README 保留入口資訊，細節移至 docs | 已採納 | 新增 `docs/CLI_REFERENCE.md` |
| 將大量參數細節移至 CLI_REFERENCE.md | 已採納 | 新增 `docs/CLI_REFERENCE.md` |
| 將 SPA / Nuxt 技術說明移至技術文件 | 部分採納 | README 保留簡述與連結，完整內容移至 `docs/CLI_REFERENCE.md` / `docs/TECHNICAL_SPEC.md` |

## ROADMAP 採納項目

| 建議 | 採納狀態 | 落點 |
| --- | --- | --- |
| 明確區分路線圖與開發紀錄 | 已採納 | ROADMAP 開頭定位為開發路線圖，歷史紀錄連到 `docs/archive/ROADMAP_HISTORY.md` |
| 新增目前狀態摘要 | 已採納 | ROADMAP `目前狀態摘要` |
| 將一致性結論改名 | 已採納 | 改以 `目前狀態摘要` 與 `採納決策摘要` 分流 |
| 將階段總覽提前 | 已採納 | ROADMAP 前段 |
| 已完成基線摘要化 | 已採納 | ROADMAP `已完成工作摘要` |
| P6 章節保留摘要、細節分流 | 已採納 | P6 細節連到 `docs/archive/P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md` |
| P6.5a / P6.5b 簡化為穩定性與稽查修補摘要 | 部分採納 | 主文摘要化，但保留 a/b 分段語意與 archive 連結 |
| P7-P11 統一呈現格式 | 已採納 | ROADMAP `近期工作` 與 `後續階段規劃` |
| 階段總覽增加下一步欄位 | 已採納 | ROADMAP `階段總覽` |
| 狀態用語統一 | 已採納 | ROADMAP `狀態用語` |
| 不得混入改名為排除範圍 | 已採納 | ROADMAP `階段總覽` |
| 採納決策移至摘要或獨立文件 | 部分採納 | ROADMAP 保留摘要，本文件記錄文件改善採納；v5.1/v5.2 詳細決策仍保留於 ROADMAP 摘要 |
| 補充 Stage / P / P6.5 命名說明 | 已採納 | ROADMAP `階段命名說明` |
| 中英文術語第一次出現格式 | 部分採納 | 核心術語已補，完整術語治理留待後續技術文件整理 |
| 明確定義 report 主契約 | 已採納 | ROADMAP `階段命名說明` 後 |
| 明確定義不改掃描語意 | 已採納 | ROADMAP `階段命名說明` 後 |
| 近期工作只保留未完成或可執行項 | 已採納 | ROADMAP `近期工作` 僅放 P7 |
| P7 增加實作前置條件 | 已採納 | ROADMAP `P7：TTL 檢查快取` |
| P8 與 P7 依賴關係明確化 | 已採納 | ROADMAP `P8：增量掃描` |
| P9 拆成 GUI 易用性、大型報告、Profile/Rules | 已採納 | ROADMAP `P9a`、`P9b`、`P9c` |
| 細部規格索引移至附錄或獨立文件 | 部分採納 | 保留在 ROADMAP 後段，定位為附錄型索引 |
| 細部規格索引增加狀態 | 已採納 | ROADMAP `細部規格索引` |
| 暫不納入近期主線分類整理 | 已採納 | ROADMAP `暫不納入近期主線` |
| 暫不納入項目補理由 | 已採納 | ROADMAP 使用表格列出理由 |
| 2026-07-18 Roadmap 主文收斂 | 已採納 | ROADMAP 改為主線導航頁，前段聚焦目前狀態、產品定位護欄、近期主線、延後項目與索引 |
| 2026-07-18 README 主文收斂 | 已採納 | README 改為第一次使用者與承辦人入口，保留快速開始、判讀、輸出、安全提醒與文件連結，進階細節分流到 CLI / 技術文件 |
| 2026-07-18 Archive 索引補強 | 已採納 | 新增 `docs/archive/README.md`，將歸檔文件依主線歷史、階段評估、GUI / 發布與站台案例分類 |
| 2026-07-18 歷史文件狀態導覽補齊 | 已採納 | 為缺少開頭狀態說明的 archive 文件補上現行主線連結與歷史定位 |

## 未完全採納與理由

| 建議 | 決策 | 理由 |
| --- | --- | --- |
| README 完全移除技術與安全資訊 | 不採納 | README 仍是工具入口，安全邊界、授權提醒與防護阻擋判讀會直接影響使用正確性 |
| ROADMAP 完全移除採納決策 | 不採納 | Roadmap 仍需保留主線決策摘要，方便維護者理解階段邊界 |
| 立即新增 `docs/TECHNICAL_SPEC_INDEX.md` | 暫不採納 | 現有 ROADMAP 後段索引已足夠；等規格索引持續膨脹再拆檔 |
| 完全合併 P6.5a / P6.5b | 不採納 | 兩者風險與語意不同，且已有獨立 assessment 文件承接 |
| 移除 README 的 robots / compliance 提醒 | 不採納 | 使用者需要知道工具只記錄、不驗證授權，也尚未執行 robots path enforcement |

## 新增與調整文件

- `README.md`：改為入口型文件，快速開始與 GUI 優先；2026-07-18 再收斂為承辦人可讀版本，移除過多階段、cache、incremental 與 GUI/CLI 差異細節。
- `ROADMAP.md`：改為開發主線入口，2026-07-18 再整理為易讀導航頁；已完成階段細節改由 archive 文件承接，主文聚焦目前狀態、P9c-2、產品定位護欄、延後項目與規格索引。
- `docs/CLI_REFERENCE.md`：新增完整 CLI 參數、規則檔格式與進階用法。
- `docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md`：新增本採納紀錄。
- `docs/README.md`：補入新文件索引。
- `docs/archive/README.md`：新增 archive 入口索引與維護提醒。

## 2026-07-18 Roadmap 易讀性更新

本次重新檢視 `ROADMAP.md` 後，採納以下整理方向：

- 將 Roadmap 定位為主線導航，而不是完整歷史紀錄。
- 前段保留目前狀態、產品定位護欄、近期主線與 P9c-2 實作邊界。
- 已完成階段改成索引表，詳細脈絡連到 `docs/archive/`。
- 延後項目集中呈現，避免未來把 crawler 重構、scheduler、平台化監控或完整整站策略重做插入近期主線。
- 保留全域原則與細部規格索引，作為後續實作前的檢查清單。

## 2026-07-18 README 易讀性更新

本次比照 Roadmap 重新檢視 `README.md`，採納以下整理方向：

- 將 README 定位為第一次使用者、政府機關承辦人員與網站窗口的入口文件。
- 前段保留產品定位、快速開始、常見情境、GUI 使用與結果判讀。
- 把進階 CLI、rules、cache、incremental 與技術細節分流到 `docs/CLI_REFERENCE.md`、`docs/TECHNICAL_SPEC.md` 與 Roadmap。
- 輸出檔案改以一般使用者最常用的檔案為主，保留 NDJSON sidecar 的簡短說明。
- 結果判讀改用「代表意義 / 建議處理」語氣，避免讓 `403`、`429`、WAF 或 timeout 被誤認為明確壞連結。
- 安全邊界與授權提醒保留在 README，因為會直接影響工具使用方式。

## 2026-07-18 Archive 索引更新

本次檢視 `docs/archive/` 後，採納以下整理方向：

- 新增 `docs/archive/README.md` 作為 archive 入口。
- 將歸檔文件分成主線歷史與近期決策、階段評估與收尾、GUI / 發布與站台案例。
- 明確提醒 archive 是歷史與決策背景，不是目前主線入口。
- 新增歸檔文件時需同步更新 `docs/archive/README.md` 與 `docs/README.md`。

## 2026-07-18 歷史文件狀態導覽更新

本次維護 archive 相關歷史文件，採納以下整理方向：

- 為缺少開頭狀態說明的歷史文件補上「狀態」導覽。
- 將 `ROADMAP_HISTORY.md` 的現行 Roadmap 連結修正為 [../../ROADMAP.md](../../ROADMAP.md)。
- 保留歷史內容原文，不改變當時分析結論。
- 讓每份 archive 文件一開頭就能辨識它是歷史分析、近期評估、發布收尾或索引文件。

## 2026-07-29 Archive 文件收斂

本次更新將階段評估與站台案例文件合併，降低 `docs/archive` 入口數量，同時保留原始評估脈絡與驗收紀錄。

| 項目 | 狀態 | 紀錄 |
| --- | --- | --- |
| P6 / P6.5 系列合併 | 已採納 | `P6_PREFLIGHT_ASSESSMENT.md`、`P6_IMPLEMENTATION_ANALYSIS.md`、`P6_5A_ASSESSMENT.md`、`P6_5B_ASSESSMENT.md` 合併為 `docs/archive/P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md`。 |
| P7 系列合併 | 已採納 | `P7_CACHE_EVALUATION.md` 與 `P7_RELEASE_CLOSURE.md` 合併為 `docs/archive/P7_CACHE_ASSESSMENT_AND_RELEASE.md`。 |
| P5.5 SPA 系列合併 | 已採納 | CEC / Nuxt 掃描改善報告與 SPA link extraction 實作筆記合併為 `docs/archive/P5_5_SPA_LINK_EXTRACTION_RECORD.md`。 |
| GUI usability 併入 P9 | 已採納 | `GUI_USABILITY_ASSESSMENT.md` 併入 `docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md`，作為 P9 GUI usability preflight 章節。 |
| Archive index 更新 | 已採納 | `docs/archive/README.md` 改以合併後文件作為主入口；`ROADMAP.md` 與歷史 roadmap snapshot 的 P6/P7 連結同步更新。 |
| 檔案數量收斂 | 已採納 | `docs/archive` 由 18 份收斂為 12 份。 |

驗證紀錄：

- 舊 P5.5 / P6 / P7 / GUI usability 分散檔名已無 active 文件引用。
- active 文件本機連結檢查通過。
- 合併 commit：`af6bed0 Consolidate archive documentation`。
