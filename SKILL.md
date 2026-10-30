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
- `--public [--tunnel] [--key <k>]` — a read-only live view for anyone with the link, on port 4546: ids become aliases, projects become 部門 A/B…, no text, no buttons, every POST refused; `--tunnel` opens a Cloudflare quick tunnel (needs `cloudflared`) and prints the https link with its key
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

v0.12：`makeWay()`（step 裡迎面靠右側移、跟車減速、卡 1.5 秒放行）。`taskOf` 加 merge／ci，outcome 觸發 `alarmUntil`、`confetti`（hub chime 出聲）。`poke()`；`stateOf()` 包一層，原本邏輯改名 `stateNow`。`seasonOf()`、`decorate()`（測試用 `seasonOverride`）。`progress.track(views)` 存 `today.spans[key] = { title, s: [[ts, w|q|e|d|i]] }`，頁面 `OfficeReplay.at()` 換成假 session 播放。直播 `setLive()`：`Hub.setLive` 讓 label、doing、standupLine、ticker 只剩員工編號與工作種類，`office.deptLabel` 把部門改字母，`spotlight(key, force)` 自動輪拍。3D 坐姿一律播 sit clip、手臂靠 `pose()`；沙發座位往裡 0.2、`grid.soften()` 開前方通道；`orientSeats` 對椅子和沙發只取正向。美術：RoomEnvironment PMREM（environmentIntensity 0.35）、512 木地板貼圖（每排多畫一片，避免透明縫變黑底白線）、地毯與磁磚貼圖、踢腳板、`blobShadow()`；2D `box()` 地面陰影與稜線、地板紋路、人物明暗與五官。

v0.13：`src/visitors.js`（掃 `visitorDirs`、`POST /api/visit`，snapshot `visitors`）→ office `visitorsIn()`／`spawnVisitor()`／`stepVisitors()`（不在 people 裡、走 `bodies()`、不可點，`masked` 時不顯示內容）。錄影 `startRecording()`：onFrame 把看得到那層的 GL＋overlay 合成到 1920×1080 畫布，MediaRecorder（mp4 優先）＋今日回放，`stopReplay` 時存檔。`TRAITS`／`traitsOf()`／`office.traits(p)` 影響 roamTo 權重、seatAct、chore 人選；`window.OfficeTraits` 給員工卡。`splitFloors(..., { idleDown: 4 })` 留閒置的在 1F。3D：`DESK_H = 0.6`、打字等桌前姿勢；手臂 z 旋轉正值＝右手往內收（左手相反）；`poseTweak` 可在 console 試姿勢。家具材質一次性降飽和與亮度，`boxMesh` 同樣處理（emissive 與自帶材質除外）。裝飾避開所有座位與排隊位（1F 移到你的桌之後才擺）。走路格：模型範圍外擴 0.1、座位 soft 成本 150。

v0.14：`meet()`／`stepMeeting()`／`endMeeting()`（找兩張隔桌相對的空椅；host 掌時鐘、每 3.6 秒換人說話；update 裡 meeting 中不搶回座位、不重設 zone），優先於 `visit()`。徽章：parsers `okStreak`；`progress.js` 的 `BADGES`、`rec.k`（push／test／merge／streak／night／early）、`award()`（啟動那一輪 quiet）、`office().badges`／`recentBadges`；hub `announceBadges()`、`showBadges()`。天氣：`src/weather.js`（Open-Meteo、15 分鐘、`WMAD_NO_WEATHER` 關、測試已設）→ snapshot `weather` → `office.setWeather()`；2D 窗戶灰天／雨絲／雪／閃電，3D `windowMat` 換色＋`weatherTexture()` 捲動。分身 `stepMe()` 被擋 0.12 秒就 `grid.path` 繞路（`me.detour`，換方向就重找）。

v0.15：visitors.js `visitOf` 回 `{ kind: 'visit'|'reply' }`（bot 最後一則＝reply、帶 `conv`）；office `seeOff()`／`stepSeeOff()`。休假：progress `track()` 把標題記進 `sessions[key].title`、`onLeave(live, now, titleOf)`（server 的 `leaveTitle` 查 DesktopMeta、封存回 null）→ `office.onLeave`；office `setLeave()`／`leaveDesk()`／`leaveSign()`。音景 `public/ambient.js`（`OfficeAmbient.Ambient`：四條噪音迴圈＋按鍵＋雷，`sceneOf(office)` 數畫面上的打字／咖啡／聊天與天氣），頁面每 400ms 更新、存 `wmad.ambient`、要使用者手勢才啟動。

v0.16（reskin）：人物 `web/chibi.js`（`makeChibi(look)`／`animateChibi(rig, st, t, dt, speed)`／`dressChibi`；關節階層＋`act()` 約 50 種姿勢、臉是 CanvasTexture；頭約佔身高一半；`HAIR_STYLES` 13 種，`p.hairStyle = hairOf(h)` 2D／3D 共用）。家具 `web/furniture.js`（`makeFurniture()` 回 { 名稱: group }，正面 +z、原尺寸，`place()` 照舊縮放；螢幕 mesh 標 `userData.screen`；`soft(color)` 柔和三階 toon、`outlineOf(mesh)` 細描邊），`boxMesh` 的實心件同樣套 toon＋圓角＋描邊（玻璃／發光／金屬除外）。辦公區 ≥16 桌。會議：`atSeat()`、`endMeetingOf()`，不在椅上不說話、45 秒沒湊齊取消。休假桌不再灑灰塵（只留牌子）。2D 人物同比例（R=9.5、臉放大 1.3）、`hair2d()`，桌子＝橡木桌面＋白側板。場景包仍可用 `assets/kenney/furniture` 的模型。配置：pod 間距 `PODX = 4.6`、`plan.aisles`（走道地毯）、辦公區地毯（到 `OD + 0.2`）；3D-only props `pendant`（吊燈，`span` 兩盞間距）、`planter`（隔板上植栽）、`coatRack`、`armchair`（加一個 couch 座位）；落地窗 0.45–2.15（2D 同步）、`artPrint()` 後牆窗間掛畫。

v0.17（office-v2）：1F 重新規劃——左後玻璃會議室（`MW×MD` 6×5、門在前方 glass 缺口）、右後辦公區（pod 從 `PX0 = WX + 1` 起、窗與招牌在辦公區上方、印表機＋機櫃在右後）、左中遊戲區（桌球、手足球、販賣機靠左牆）、前排一條街（左：門口休息區＋電話亭；中：你的桌＋秘書，地毯、背後書櫃；右：咖啡廳；街機在遊戲區）。兩層同 `W`／`D`（升降梯同位置）；樓上仍是舊配置（`RW = W - OW`）。地板改成 `plan.floors`（wood／carpet／tiles／work／mat／rug，2D `floorPatch()`、3D 依序疊放），白板 `plan.whiteboard`、牆上名牌 `plan.wallSign`、掛畫 `plan.art`；`decorate({ spots })` 可傳節日裝飾候選點。
遊戲區老虎機：`SLOT_SYMS`／`SLOT_STRIPS`（每輪每個符號兩次）／`SLOT_PAY`；`stepSlot()`（坐在 slot poi 上的人每 3–4 秒拉一把、五輪由左到右停、中線左起 ≥3 同符號派彩、中獎時那人 act 變 cheer）；`slotScreen()`／`slotTopper()` 畫螢幕（3D 每 33ms 重畫 CanvasTexture、2D 縮小貼在機台正面 `onFront()`）；3D `slotRig`（燈條／SPIN 鍵／點光源中獎閃）；個性 gamer／owl 偏好 slot。點人物的 session 面板改成右下角小卡（`.hub-panel`），細節收進 `<details class="hub-more">`，開合狀態 `moreOpen` 跨重繪保留。
