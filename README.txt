億家 App v0.9.6.4 — 禮物／轉贈明細點擊修正

修正：
- 禮物紀錄「查看明細」點了沒反應
- 轉贈紀錄「查看明細」點了沒反應

原因：
舊版把整筆 JSON 直接塞進 inline onclick，在 iPhone Safari 上容易因字串編碼造成事件失效。
新版改用頁面記憶體索引開啟明細，不再把 JSON 放進 onclick。

本次只改 App 前端：
- 不用跑 Supabase SQL
- 只要 GitHub 覆蓋新的 index.html
