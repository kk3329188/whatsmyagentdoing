// Bubbles a public view may show word for word: lines the office itself
// writes (public/office.js), never words from a session, a visitor or you.
// A bubble that is not one of these shows its `pub` line instead (office.js
// gives one to every bubble that may carry a name or a message), else a
// stock line for its zone (src/server.js publicWorld).
// tests/public-hub.cjs reads office.js and checks every line it writes is here.

const LINES = new Set([
  // a session's state changes (EVENT_TEXT), arriving, the lift
  '開工！', '有事問你！', '要你決定！', '出錯了…', '被中斷', '做完了 ✓', '早安！☀️', '上樓了', '下樓了', '上樓去', '下樓去', '開飯囉！🍱', '吃飯去 🍱', '吃飽了 😋', '拿餐囉 🍱',
  // a finished test, build, push… (REACT)
  '測試沒過…', '測試全過！', '編譯失敗…', '建好了！', '推不上去…', '推上去了 🚀', 'commit 失敗', 'commit ✓',
  '合併失敗…', '合併了！🎉', 'CI 掛了！🚨', 'CI 綠燈 ✓',
  // picked up, poked, put down by the door / a spot
  '哇！', '放我下來！', '欸欸欸', '咦？要去哪', '我還在忙耶', '嚇我一跳！', '嗨～', '在休息啦', '幹嘛～', '別戳了啦', '別再戳了 😤',
  '回座位…', '呼～', '印成報告（複製）', '釘到白板上', '叫它停下這一輪', '先不顯示，有事再出現',
  // the boss walks in / out
  '老闆來了！', '快回座位！', '假裝很忙…', '咳咳，在做事', '老闆好～', '呼～老闆走了', '終於…', '休息一下', '伸個懶腰', '可以摸魚了',
  // errands and office life
  '貼上佈告欄 📌', '送去機房 📦', '上網查資料…', '翻一下文件…', '印出來看看', '排一下步驟', '印表機又卡紙了…', '咖啡豆沒了，我來補',
  '澆個花 🌱', '外送到了！', '午餐來囉 🍱', '下午茶時間 🍰', '休假回來了！🏖️',
  // two sessions meet (and the lines that stand in for a name or a message)
  '好，會議室見', '我覺得可以', '那這樣改呢？', '好，就這麼辦', '我這邊來處理', '有道理', '細節我再補給你', '來討論一下',
  '找同事開會', '去找同事', '有話跟同事說', '在忙啦', '報告進度',
  // visitors
  '你好～', '我送一下客', '收到，我來處理 👍', '謝啦～', '慢走～', '我有個問題 🙋',
  // the casino
  '來一把 🎰', '來押一把 🎡', '發牌吧 🃏', '手氣來了 🎰', '午休來一局 🃏', '下班打一局 🃏', '轉啦 🎡', '棄牌 🙅', '過牌 👌', '轉輪轉啦 🎯', '來轉一把 🎯',
  // Chuck, the dealer (a replaying page runs him itself; these keep it so)
  '歡迎！再一位就開局', '來玩一把嗎？🃏', '我回來了，發牌 🎩', '查克休假，我來代班 ⚽', '下班囉，回家幫小孩洗澡 🛁', '下班囉，明天見 ⚽', '打完牌，回家囉 👋', '發牌 🃏', '翻牌', '轉牌', '河牌', '開牌！',
]);

const HAND = '(高牌|一對|兩對|三條|順子|同花|葫蘆|四條|同花順|大家都棄牌了)';
const BET = '(紅|黑|單|雙|小 1-18|大 19-36|[0-9]{1,2} 號)';
const SPIN = '[0-9]{1,2}( 紅| 黑)?';
const PATTERNS = [
  /^升等！Lv[0-9]{1,2} (新人|正職|資深|主管|傳奇)?$/,
  /^(大盲|跟注) [0-9]{1,5}$/,
  /^加注 [0-9]{1,5} 🔥$/,
  new RegExp(`^🏆 ${HAND} \\+[0-9]{1,6}$`),
  new RegExp(`^押${BET} [0-9]{1,5}$`),
  new RegExp(`^中了！${SPIN} \\+[0-9]{1,6} 🎉$`),
  new RegExp(`^${SPIN}(，打平 😮‍💨|…槓龜 😩)$`),
  /^押轉輪 (1|2|5|10|20|★) [0-9]{1,5}$/,
  /^轉輪 (1|2|5|10|20|★)(：中了 \+[0-9]{1,6} 🎉|…沒中 😩)$/,
];

const publicSay = (text) => typeof text === 'string' && text.length <= 30 && (LINES.has(text) || PATTERNS.some((re) => re.test(text)));

module.exports = { publicSay, LINES };
