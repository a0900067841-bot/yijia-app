億家 App v0.10.16.5 Return Barcode Resume Fix

延續條碼 / QR 顯示流程檢查，本版修正「既有退貨條碼」重新開啟流程。

找到的問題：
- showExistingReturnBarcode(code, storeName) 最後錯用不存在的 returnCode 變數。
- 因此雖然 YR 條碼可能已經畫出來，但後續退貨狀態監控會發生 JavaScript 錯誤。
- 返回我的商品時也沒有統一停止退貨狀態監控。

修正：
- 正確使用傳入的 code 作為 activeReturnCode
- 正確重新繪製 YR CODE128
- 重新開啟既有退貨條碼時立即啟動狀態同步
- 返回 / 回我的商品時停止 monitor 並清除舊狀態
- 找不到退貨碼時給使用者明確提示
- 不修改後端退貨規則與 RPC

此版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
