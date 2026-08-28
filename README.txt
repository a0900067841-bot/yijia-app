億家 App v0.10.16.2 Redeem QR Display Fix

修正使用者實機回報：
YD 兌換碼建立成功，但 QR Code 畫面沒有顯示。

原因：
1. app_create_redeem_ticket 成功後只建立 QR，
   但沒有把 redeemTicketSetup 隱藏、redeemTicketQrWrap 顯示。
2. 程式寫入 redeemTicketCodeText，
   但 HTML 真正的欄位 id 是 redeemTicketCode。
3. redeemTicketExpiresAt 沒有在建立成功時設定，
   倒數計時因此無法正常開始。

本版修正：
- 建立成功後立即切換到 QR 畫面
- 正確顯示 YD 兌換碼文字
- 正確顯示商品與本次兌換數量
- 後端有 expiresAt 時使用後端期限
- 否則依規則使用 600 秒
- 每次新建兌換碼都重設倒數與狀態
- 返回我的商品後清除舊的 expiry 狀態

此版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
