---
name: myoffice
description: Open a live office view of every Claude Code, Codex and Gemini CLI agent on this machine — who is thinking, running a tool, writing a reply, waiting for the user, or done. Use when the user types /myoffice, asks what their agents are doing, wants to see all running sessions, or which agent is stuck or finished ("我的 agent 在幹嘛", "show my agents").
---

# myoffice

Start the dashboard. It serves a local page and opens it in the browser.
Run it **in the background** so it keeps running and doesn't block the chat
(this skill's base directory is shown above as "Base directory for this skill"):

```bash
node "<base directory>/bin/cli.js"
```

If it is already running, the same command just reopens the browser tab.

To **update** it — `/myoffice update`, or the user asks to update / upgrade —
run `node "<base directory>/bin/cli.js" --update` (not in the background),
report the version it printed, then start it again as above. The page also
shows the version in the corner and an "Update" button when a new one is out.

To **close** it — `/myoffice stop`, or the user asks to stop / close / shut the
office down — run (not in the background):

```bash
node "<base directory>/bin/cli.js" --stop
```

and say it's stopped.
Then tell the user, in one line, that the office is open at the printed URL.
If the output also says **"Update available: vA → vB"**, tell the user a new
version is out and offer to update it (`/myoffice update`, below).
Requires Node.js 18+; if `node` is missing, say so and stop.

## Scenes (3D)

Besides the built-in office there are downloadable 3D scenes (e.g. a pirate
cove). When the user asks for another scene, a different look, "DLC", or names
one ("海盜船", "pirate"):

1. `node "<base directory>/bin/cli.js" --scenes` — lists every scene, whether
   it's installed, and its download size. Use the ids it prints; don't guess.
2. `node "<base directory>/bin/cli.js" --scene <id>` (in the background) —
   downloads it if needed (checksum-verified, data only) and opens the office
   in that scene. `--scene office` goes back to the office.

Scenes are only downloaded when asked for. `--remove-scene <id>` deletes one.

Options the user may ask for:

- `--private` — hide prompts/replies, show status only (for screen sharing)
- `--hours 4` — only sessions active in the last 4 hours (default 24)
- `--port 5000` — different port (default 4545)
- `--stop` — stop the running dashboard
- `--json` — print a one-off snapshot instead of opening a page. Use this when
  the user asks in chat what their other agents are doing: run
  `node "<base directory>/bin/cli.js" --json --hours 2` and summarize by status.

Everything is read locally from `~/.claude/projects`, `~/.codex/sessions` and `~/.gemini/tmp`;
the server listens on 127.0.0.1 only and sends nothing anywhere.

## Hub 版（`hub` 分支）

這個版本（https://github.com/kk3329188/whatsmyagentdoing 的 `hub` 分支）在原版之上加了：角色名牌用桌面 app 的 session 標題、頭上用中文寫正在做什麼、
點人物開側欄（步驟清單、最近動作、等你處理的問題、切到該 session、送訊息、中斷）、頂端「等你處理／待你決定」列。

送訊息／中斷：瀏覽器第一次用按一次 Touch ID（repo 內 `gate/human-gate.swift`），之後 8 小時免按（HttpOnly cookie，只存在 server 記憶體，重啟要再按）。
指令經 `~/.cache/session-remote/` 交給收件外掛 `plugin/myoffice-remote` 執行，外掛動手前回頭向 127.0.0.1:4545 核對一次性 token，所以控制功能只在預設 4545 埠可用。
外掛要另外裝：`claude plugin install myoffice-remote --marketplace kk3329188/whatsmyagentdoing`（或在 Claude Code 輸入 `/plugin install myoffice-remote --marketplace kk3329188/whatsmyagentdoing`），
只對裝好後新開的 session 有效。使用者說「送不出去／一直排隊中」時，先確認外掛裝了沒、那個 session 是不是裝好後才開的。
Touch ID 要用到 Swift：沒有 Command Line Tools 時請使用者自己跑 `xcode-select --install`。

畫面：預設「自由走動」——工作中的人坐在工作桌（姿勢與螢幕依工作種類），其他人全辦公室走動，狀態看頭上符號（! 等你回覆、? 留了決定、✓ 剛做完、Ⅱ 被中斷）與腳下色圈；
圖例旁的按鈕可切成「依狀態分區」（會議室＝等你、機房前＝出錯、茶水間＝剛做完、休息區＝閒置）。會聊天、摸貓、印東西、伸懶腰、午餐吃便當；
長指令跑超過 90 秒會去倒咖啡；卡住會冒煙並進「等你處理」；子代理畫成桌邊小助手；session 互傳訊息時，送出方會走去找對方聊天。
按住人物可拖曳拎起、放開落在最近的空地（2D、3D 都可以）；單點開面板，游標直接在傳話框，Enter 送出、Shift+Enter 換行。

`--update` 跟著 clone 時的分支更新（`git pull --rebase`）。改 web/office3d.js 後要 `npm run build`。
測試：`node --test tests/hub.cjs tests/parsers-hub.cjs tests/zones-hub.cjs tests/watcher.cjs`。
