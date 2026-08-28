億家 App v0.10.16.4 YijiaPay PIN iOS Input Fix

修正 iPhone Safari 實機回報：
億家Pay 4 位數安全密碼視窗有出現，但無法叫出鍵盤輸入。

原因：
原本 PIN input 被放到螢幕外（left:-9999px + opacity:0）。
iOS Safari 對這種隱藏欄位常不會叫出軟體鍵盤。

本版修正：
- 改成真正可點擊、可聚焦的 4 位數輸入框
- type=tel + inputmode=numeric，iPhone 會顯示數字鍵盤
- 仍用圓點 / 黑點方式遮蔽密碼
- 點輸入框即可輸入
- 自動聚焦時會先捲到畫面中央
- 保留 4 位數限制
- 保留兩次輸入確認
- 保留 5 次錯誤鎖定 5 分鐘
- 不改 PIN 後端 SQL

此版不用再跑 SQL（若 v0.10.16.1 的 PIN SQL 已執行）。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
