# Release Security Assessment

評估日期：2026-06-27

本文件記錄針對本專案 `.cmd` 與 portable `.exe` 降低防毒軟體、Windows SmartScreen 或企業端安全工具警戒可能性的分析與優先建議。方向是提高透明度、可驗證性與最小權限；不採用繞過偵測、混淆、加殼或隱蔽行為。

## 執行紀錄

- 2026-06-27：先行完成 P0 第 2、3、4 項。`build-portable.ps1` 會產生 portable 專用 `.cmd`，嚴格使用同資料夾內的 `runtime\node.exe`，找不到 runtime 時直接報錯退出，不 fallback 到 PATH 中的 `node`。`PORTABLE-README.txt` 也補上 localhost-only、不安裝 service、不寫 registry、不設開機自動啟動、不連接遠端控制端等安全說明。
- 2026-06-27：依 next step 第 2 項加入 build manifest 產生流程。Portable 資料夾內會產生 `BUILD-MANIFEST.json`，記錄 bundled file 清單、SHA256、git commit、build time、Node 版本、launcher / Node 簽章狀態；zip 旁邊會產生 `LinkChecker-portable.build-manifest.json` 與 `LinkChecker-portable.zip.sha256`，用於發佈前驗證 zip artifact。

## 結論

目前架構沒有明顯惡意行為特徵：不寫 registry、不安裝 service、不設自啟動、不做提權、不注入其他 process，GUI server 只 listen `127.0.0.1`，portable / exe 模式也有 idle shutdown。

主要警戒來源不是掃描功能本身，而是發佈形態：

- portable zip 內含 `.exe`、`.cmd`、bundled `node.exe` 與 `.mjs` script runtime。
- launcher 會啟動本機 Node GUI server，並自動開啟瀏覽器。
- `Start Link Checker.exe` 目前使用 local self-signed Authenticode 簽章；這可供內部信任流程使用，但不是公開信任簽章，不能期待消除 SmartScreen 警告。

## 現況觀察

- `gui-server.mjs` 固定使用 `HOST = "127.0.0.1"`，不是對外服務。
- `runtime\node.exe` 的 Authenticode 簽章有效，簽署者為 OpenJS Foundation。
- `Start Link Checker.exe` 目前可被 Authenticode 辨識，但簽章鏈終止於未受信任的 self-signed root，因此驗證結果不是 publicly trusted。
- `build-portable.ps1` 會匯出 `LinkChecker-local-code-signing.cer`，並在 portable readme 說明 self-signed 不會移除 SmartScreen 警告。

## 優先建議

### P0：立即可做的小修

1. 發佈前重建 portable，確保 `dist/` 內容與目前 repo commit 一致。
2. portable 專用 `.cmd` 應嚴格使用同資料夾內的 `runtime\node.exe`；找不到 runtime 時直接顯示錯誤並退出，不 fallback 到 PATH 中的 `node`。
3. `PORTABLE-README.txt` 補明確安全說明：只啟動 `127.0.0.1` 本機服務、不安裝 Windows service、不寫 registry、不設開機自動啟動、不連接遠端控制端。
4. `build-portable.ps1` 產生 `BUILD-MANIFEST.json` 與外部 `LinkChecker-portable.build-manifest.json`，記錄 git commit、build time、Node 版本、zip / exe / node hash、launcher 簽章狀態與 bundled file 清單。
5. 發佈 zip 同時輸出 SHA256，並在 release notes 中列出 hash 與來源 commit。

### P1：Release gate

1. 正式對外發佈前使用公開信任 code signing certificate 或可信代管簽章服務。self-signed 只適合內部 trust/import 流程。
2. 建立 package smoke test：解壓 zip、確認 launcher 能啟動本機 GUI、確認 server 只 listen `127.0.0.1`、確認 idle shutdown / manual shutdown 有效。
3. 建立 dependency / license / SBOM 輸出，至少記錄 bundled Node runtime 版本與來源。
4. 若發生誤判，透過防毒廠商或 Microsoft Defender false-positive submission 流程提交樣本與 hash，不透過程式繞避偵測。

### P2：後續改善

1. launcher 可增加短暫啟動畫面或提示文字，明確告知正在啟動本機 GUI server。
2. 若未來改成 installer，優先使用標準 MSI / MSIX 或受信任簽章流程，避免自製 unpacker。
3. 保持 C# launcher 透明、簡短、無混淆；不要使用 packer、obfuscator 或 runtime 解密 payload。

## 不建議採用

- 不要混淆、加殼、壓縮或動態解密 launcher。
- 不要隱藏網路行為；本工具應明確維持 localhost-only GUI server。
- 不要透過改檔名、延遲啟動、規避掃描或偵測防毒 process 來降低警戒。
- 不要把單機工具改成常駐 Windows service 或開機自動啟動。

## 驗收標準

完成 release security 小修時，至少應符合：

- portable `.cmd` 不依賴 PATH 中的 `node`。
- release artifact 有 SHA256 與 build manifest。
- manifest 內含 git commit、Node runtime version、launcher hash、zip hash 與簽章狀態。
- README / portable readme 明確說明 localhost-only、不安裝、不自啟動與 self-signed 限制。
- package smoke test 能驗證 GUI 啟動與收尾。
