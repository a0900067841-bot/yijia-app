億家 App v0.9.5 — 隨買服務中心

依參考畫面新增：
- 隨買跨店取首頁
- 我的商品
- 轉贈或領取商品
- 訂單紀錄
  - 訂單管理
  - 訂閱管理
  - 預約管理
  - 商品使用紀錄
- 操作教學
- 權益公告

已接資料：
1. 訂單管理
   - HQ / yj_app_anybuy_orders
   - HQ / yj_app_yijiapay_orders
2. 商品使用紀錄
   - 購買：上述訂單
   - 兌換：HQ / yj_app_redemptions
   - 退款：HQ / yj_app_return_requests
   - 逾期：HQ / yj_app_member_products
3. 我的商品保留 returnCode，待退貨時可再次開啟 YR CODE128 條碼。

暫先建立入口、尚未正式串接：
- 轉贈或領取商品
- 訂閱管理
- 預約管理

更新方式：
1. Supabase SQL Editor 執行 setup_v0_9_5_anybuy_center.sql
2. GitHub yijia-app 覆蓋 index.html
