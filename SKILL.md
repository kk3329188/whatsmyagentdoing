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
丟到別人身上＝轉話：開對方面板、填好前一人最後的回覆（`〔轉自「…」〕` 開頭），按 Enter 才送；送出後前一人走過去聊。
等你超過 3 分鐘舉牌冒汗、超過 10 分鐘到畫面最前面敲螢幕；音效（叮／警報／敲門／升等）圖例旁可關，存在 localStorage `wmad.sound`。
兩層樓（內建辦公室、非子母畫面）：index.html 建兩個 Office（`floor: 1|2`，各自一個 `.floor-view` 容器，沒看的那層 setVisible(false) 不畫）；
誰在哪層由 `OfficeFloors.split`（public/office.js）決定：等你／出錯／剛做完／工作（前 12 個）／秘書在 1F，閒置與超額工作在 2F，2F 的工作者做完前不下樓；換層的 key 傳給 `update(list, { moved })`，走電梯（plan.lift）不走門。
2F 平面是 `upstairs()`（沒有你的桌與排隊，door＝電梯）；樓層分頁顯示各層人數，按 1／2 切換，選的樓層存 `wmad.floor`。載入時等「看得見那層」畫好才收 loading。

3D 視角（web/office3d.js `viewControls()`，純函式在 web/camera.mjs，測試 tests/camera-hub.cjs）：橫向滾輪（觸控板雙指左右滑、Shift＋滾輪）攔下來改平移，直向滾輪與捏合照舊縮放；方向鍵／右下 `.view-pad` 平移、0 回正、雙擊地板滑過去；每格畫面 `steerView()` 把旋轉中心拉回房間範圍內（邊界外 1 格）。平移走 OrbitControls 的 `_pan()`、回正清 `_panOffset`——升 three 版本要確認這兩個私有成員還在。
你的桌（plan.boss）在前緣、秘書桌（plan.sec）在旁；zone wait 的人依等待時間排到 plan.queue（最多 6 格），排第一且等 >10 分會敲桌，排不下的照舊亂逛／敲螢幕。
秘書＝面板「設為秘書」存的標題片段（日期去掉，localStorage `wmad.secretary`）所符合的最新 Claude session，沒設時用 /秘書|總機|secretary/，固定坐秘書桌；離開 ≥10 分鐘回來時 `Hub.welcome` 出摘要卡、`office.deliver` 讓秘書走到你桌前。
日報：18 點後第一次活動自動出一次（localStorage `wmad.reportDay`），資料來自 progress.js 的 today（今日輪數、回覆時間）；程式碼尾巴按資料夾合併。
拖到家具（plan.targets）：printer 複製報告、whiteboard 釘選（`wmad.pins`）、coffee 確認後 stop、door 隱藏到有新動靜（`wmad.hidden`，key→當時 lastEventAt）。
經驗值：`src/progress.js`，工具呼叫 +1、做完一輪 +5，存 `~/.whatsmyagentdoing/progress.json`（測試用 `WMAD_PROGRESS_FILE` 改路徑）；
log 是從尾巴讀的，所以已記錄過的 session 重啟後只算之後的增量。等級 60／200／600／1500 經驗換裝；辦公室累積完成輪數 10／50／120／250／500 解鎖家具（`UNLOCKS` 在 public/office.js）。

`--update` 跟著 clone 時的分支更新（`git pull --rebase`）。改 web/office3d.js 後要 `npm run build`。
測試：`node --test tests/hub.cjs tests/parsers-hub.cjs tests/zones-hub.cjs tests/watcher.cjs tests/progress-hub.cjs`。

生活化（public/office.js）：server 在 parsers.js 用 `taskOf()` 把每個工具呼叫標成 test／build／push／commit／lookup／web／doc／plan…（`s.task`），test／build／push／commit 的結果記成 `s.outcome = { at, task, ok }`。office.js：`trip()` 讓工作中的人依 task 短暫離座（push→機房、查資料 20 秒以上→書架、寫文件→印表機、新計畫→白板），`REACT` 依 outcome 歡呼／抱頭；`life()`／`chore()` 照真實時鐘排外送（11:45）、下午茶（15:00）與隨機小事（卡紙、補咖啡豆、澆花），由 idle／done 的人去做（`p.chores` 一串步驟，`arrive` 到達時觸發 `lifeMark`）。座位依 `deptOf()`（repo 名，worktree 算原 repo）分組，`podDepts()` 給部門牌。佈告欄便條存在瀏覽器 `wmad.board`（只留當天），公司名稱存 `wmad.company`。

同一個桌面 session 的多段 log：/clear 等會以同一個 `bridge-session` 的 bridgeSessionId 開新 log；server.js `latestSegments()` 只留桌面 meta 指著的那段（沒有就最新那段），子代理改掛到現行那段。

鏡頭跟拍：office.js `spotlight(key)`（update() 在開工／做完時呼叫，佇列最多 3、同人 60 秒一次、只在看得見的樓層）、`spotPerson()` 給 2D `fitCamera()` 與 3D `steerView()` 用；3D 跟拍前存下視角，結束後用 `fly` 連 zoom 一起滑回；畫布 pointerdown／wheel、方向盤、回正都會 `spotCancel()`。開關存 `wmad.follow`。

v0.9：跟拍 `spotFrame()` 取畫布在視窗中看得到的那塊（中心略往下留泡泡空間）；3D 依投影後的螢幕誤差校正 target、縮放用 1.2 秒 ease-in-out（`glide(..., inOut)`），結束或被打斷都 `fly` 回存下的 target＋zoom（`calmControls()` 清 OrbitControls 殘餘慣性）。老闆模式 `setBoss()`：`bossIn` 時 atDesk＝非等待者全部（樓層照分），`rush` 2.3 倍速跑、stateOf 假裝工作、停掉 trip／coffeeRun／life；事件與跟拍用真實 zone（假裝不算開工）。存 `wmad.boss`，B 鍵／工具列切換。公司招牌改成 `plan.logo`（後牆中段、取代該處窗戶、z 1.2–2.34 高過隔板），改名會 rebuild 平面，輸入框 600ms 防抖。

v0.10：晨會 `startStandup(lineOf, done)`（會議椅＋桌子周圍一圈站位，`standupJoin` 收後到的人，`stepStandup` 每 5 秒換人，`splitFloors(..., { allDown })` 讓全員下 1F；頁面 `startStandup()`、10:00 自動、`Hub.showMinutes`）。員工卡 `employeeCard()`（server `s.kinds` 依 taskOf 計次）、今日最佳 `Hub.bestKey()`→`office.bestKey`。打烊 `closing()` 19–07：update 不讓 idle／done 留下、`nightShade()`（2D）＋`deskLamps()`（3D）。分身 `meOn()/meKey()/stepMe()`，`bodies()` 給繪圖用（不進 people、不可點），3D `screenAxes()` 依相機方向。老闆模式改成不擴桌：`pretend` 的人先搶空桌，沒桌的 `pretendAt()` 找白板／印表機／書架／電話／會議椅／沙發，真正工作的人可以把假裝的人擠走。修：`builtFor` 防同人數重複 rebuild（2F 桌數剛好等於人數時每次 update 都重排→大家一直在走＝「卡住」），2F 也留 2 張空桌。

v0.11：3D `collide()` 在 build 後用 `footprints()`（room 子物件的 Box3，略過地上的、牆上的、頭上的）把家具實際範圍寫進走路格；站立點周圍保持開放、座位一帶標 2（soft，自己要坐才走進去，路徑成本 40），再從門口 flood fill，走不到的點沿最短路徑把新加的格子打開。Grid 實心成本 25→400、新增 `hard()`（分身走動用）。茶几 pad 0.02 讓沙發前留出一排可走格。`orientSeats()` 讓有 sit 的 poi 面向最近的圓桌／會議桌／茶几／電視（yaw＋2D face）。`SEAT_ACTS`＋`seatAct()` 依座位類型輪替動作；3D `pose()` 在 mixer 之後疊加手臂／頭／軀幹旋轉（記住上次寫入值，判斷 clip 有沒有覆寫，避免累加），手上有手機／掌機、腿上有筆電。鏡頭：build 只在第一次框景（之後只調太陽），resize 保持每像素世界尺寸，不再因重排或版面變動跳鏡頭。
