# v1.5.4 Release Provenance Note

記錄日期：2026-10-08

本文件是 `v1.5.4` 的 historical release record，用於記錄已發布 Portable artifact 與 release tag 之間的 provenance exception；不是新的 active release policy 文件。目前 release policy 仍以 [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md)、[TECHNICAL_SPEC.md](../TECHNICAL_SPEC.md) 與 [CLI_REFERENCE.md](../CLI_REFERENCE.md) 為準。

## 已確認的來源識別

| 項目 | 已確認值 | Repository evidence |
| --- | --- | --- |
| Portable artifact build source | `ca48fe2cdf34e62cfcb1f5b76855e96126156ef6` | `dist/LinkChecker-portable.build-manifest.json` 的 `build.gitCommit` |
| `v1.5.4` tag target | `74b159d144b57328a0f3975bc71f5a07fd499af4` | `git rev-list -n 1 v1.5.4` |
| Report schema | `1.3.0` | 兩個 commit 的 `link-checker.mjs` 均定義 `REPORT_SCHEMA_VERSION = "1.3.0"` |

`74b159d144b57328a0f3975bc71f5a07fd499af4` 的 parent 是 `ca48fe2cdf34e62cfcb1f5b76855e96126156ef6`，因此 artifact build source 到 tag target 之間只有一個 commit。

## Release validation tooling delta

```text
74b159d test: make portable smoke PowerShell 5.1 safe
```

`git diff --name-status ca48fe2cdf34e62cfcb1f5b76855e96126156ef6 74b159d144b57328a0f3975bc71f5a07fd499af4` 的結果只有：

```text
A  scripts/portable-smoke.ps1
```

該 commit 新增 Portable smoke harness，用於 Windows PowerShell 5.1 相容的 required-file validation、disposable ZIP extraction、exact bundled Node PID observation、manual shutdown、idle shutdown 與 process exit 後清理。`build-portable.ps1` 的 package copy 清單不包含 `scripts/`，因此這個 delta 不屬於當次 Portable payload。

依 repository diff，此 source alignment exception 的範圍是 release validation / smoke tooling；artifact build source 到 tag target 之間沒有 crawler、HTTP validation、GUI、Analyzer、CLI runtime、版本或 report schema 檔案變更。此描述只界定已確認的差異範圍，不改寫其他 release evidence。

## Historical disposition

- 既有 `v1.5.4` tag 與 GitHub Release 維持原狀。
- 不因本紀錄修改或重建既有 `v1.5.4` artifact。
- `v1.5.4` Report schema 維持 `1.3.0`。
- 本文件只保存 provenance exception，不將此例外轉為 future release policy。

## Future release alignment

後續 formal release 應在建立 release tag 前確認：

```text
release artifact source
= approved release source
= release tag target
```

Release validation tooling 若在 artifact build 後改變 approved release source，應先重新建立 source alignment，再進入 tag 與 publication gate。
