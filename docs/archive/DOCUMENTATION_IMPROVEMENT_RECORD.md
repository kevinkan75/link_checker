# Documentation Improvement Record

本文件記錄 README 與 ROADMAP 易讀性、一致性改善建議的採納狀態。

## 來源

- `C:\Users\kevin\Desktop\README_易讀性與一致性改善建議.md`
- `C:\Users\kevin\Desktop\ROADMAP_易讀性與一致性改善建議.md`

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
| P6 章節保留摘要、細節分流 | 已採納 | P6 細節連到 `docs/archive/P6_IMPLEMENTATION_ANALYSIS.md` |
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

## 未完全採納與理由

| 建議 | 決策 | 理由 |
| --- | --- | --- |
| README 完全移除技術與安全資訊 | 不採納 | README 仍是工具入口，安全邊界、授權提醒與防護阻擋判讀會直接影響使用正確性 |
| ROADMAP 完全移除採納決策 | 不採納 | Roadmap 仍需保留主線決策摘要，方便維護者理解階段邊界 |
| 立即新增 `docs/TECHNICAL_SPEC_INDEX.md` | 暫不採納 | 現有 ROADMAP 後段索引已足夠；等規格索引持續膨脹再拆檔 |
| 完全合併 P6.5a / P6.5b | 不採納 | 兩者風險與語意不同，且已有獨立 assessment 文件承接 |
| 移除 README 的 robots / compliance 提醒 | 不採納 | 使用者需要知道工具只記錄、不驗證授權，也尚未執行 robots path enforcement |

## 新增與調整文件

- `README.md`：改為入口型文件，快速開始與 GUI 優先。
- `ROADMAP.md`：改為開發主線入口，前段呈現目前狀態與 P7 下一步。
- `docs/CLI_REFERENCE.md`：新增完整 CLI 參數、規則檔格式與進階用法。
- `docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md`：新增本採納紀錄。
- `docs/README.md`：補入新文件索引。
