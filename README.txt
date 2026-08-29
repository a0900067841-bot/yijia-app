億家 App v0.10.16.6 Checkout Total RPC Ready

本版先修正結帳畫面：
- 商品總金額與總付款金額同步
- 不再出現商品總金額 $610、總付款金額 $0
- 若 app_create_yijiapay_order 尚未建立，改成清楚的使用者提示
- 不改店舖結帳流程
- 不改億家Pay錢包資料

後端 app_create_yijiapay_order 仍需依目前正式 DB 結構建立。
為避免扣款與商品發放資料表寫錯，不在前端硬猜後端表結構。

此版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
