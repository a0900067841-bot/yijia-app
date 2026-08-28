億家 App v0.10.15.0 App Entry Formal Flow

第十一個主功能接通：
首頁入口 / 本期活動 / 我的服務

本期活動：
- 「更多」正式可點
- 新增本期活動頁
- 直接讀 SC/HQ 正式資料：
  yj_app_coupons
  yj_app_anybuy_products
- 優惠券活動可直接進優惠券
- 隨買活動可直接進正式商品詳情

首頁「我的服務」不再顯示寫死假數字：
- 待兌換數量 → app_get_member_products
- 本月點數 → app_get_my_point_history
- 訂單摘要 → app_get_anybuy_order_history
- 會員資料 → 正式 profile

並修正舊版抽屜裡已過時的錯誤 view：
- anybuyOrders → orderManagement
- subscriptions → subscriptionManagement
- reservations → reservationManagement

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
