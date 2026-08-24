億家 App v0.9.3 — TM 正式共用資料串接

核心改動：
1. 店舖結帳不再以 app_checkout_orders 為主要資料。
2. App 建立待付款訂單直接寫：
   public.yijia_app_state
   store_id = HQ
   data_key = yj_app_anybuy_orders
3. paymentCode 即 App 顯示的 YS 條碼，TM Alpha 8.84 可查同一筆。
4. App 每 4 秒透過安全 RPC 重新讀取自己的訂單狀態。
5. TM 更新 status=已付款 或 paymentStatus=paid 後：
   - 店舖付款頁自動變「付款完成」
   - 停止顯示付款條碼
   - 顯示 paidAt / paidStoreName / tmSaleId
   - 重新整理「我的商品」
6. 我的商品改讀：
   store_id = HQ
   data_key = yj_app_member_products
   但透過 RPC 只回傳目前登入會員自己的資料。
7. 篩選：
   status=可兌換
   remainingQuantity>0
   validUntil 未過期（若有值）

安全設計：
- 不把 HQ 的 yj_app_anybuy_orders / yj_app_member_products 整列 Data API 暴露給會員。
- App 透過 security definer RPC，只能取得自己的訂單與商品。

使用：
1. Supabase SQL Editor 執行 setup_v0_9_3_tm_sync.sql
2. 成功後覆蓋 GitHub Pages index.html
3. App 建立「店舖結帳」
4. 用 TM Alpha 8.84 掃 YS 條碼並完成收款
5. App 店舖付款頁應在數秒內切成付款完成
6. 「我的商品」應顯示 TM 新增的可兌換商品
