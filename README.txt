億家 App v0.9.2 — 結帳方式選擇版

新增正式流程骨架：
隨買 → 加入購物車 → 購物車 → 結帳 → 選付款方式

付款方式：
1. 線上支付
   - 目前使用開發測試付款
   - 不會真的扣款
   - 成功後會直接加入「我的商品」
   - 正式版改接億家Pay / 金流

2. 店舖結帳
   - 建立 app_checkout_orders 待付款訂單
   - 建立 app_checkout_order_items
   - App 顯示訂單碼＋CODE128條碼
   - 狀態 pending_store_payment
   - 預設付款期限 24 小時
   - TM 收款串接完成後，才會將商品轉入「我的商品」

重要：
- 本版需要先執行 setup_v0_9_2.sql
- 新增兩張 table：
  app_checkout_orders
  app_checkout_order_items
- 目前 App 店舖結帳不需要直接讀這兩張 table；建立訂單透過 RPC。
- 之後做「我的訂單」時，再視需要把這兩張表加入 Data API Exposed tables。
