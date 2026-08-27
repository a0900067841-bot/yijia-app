億家 App v0.10.13.25 Production Checkout Guard

這版把隨買跨店取的結帳流程做正式化保護。

調整：
- 結帳方式明確顯示「億家Pay / 店舖結帳」
- 移除未正式接通的信用卡分支
- 移除 dev_app_purchase_anybuy 開發測試結帳函式
- 億家Pay付款前會再次確認：
  - 購物車金額 > 0
  - 正式錢包餘額足夠
- app_create_yijiapay_order() 只有在後端明確回傳：
  - paymentStatus = paid
  或
  - status = 已付款
  才會：
  - 清空購物車
  - 發放商品
  - 更新我的商品
  - 更新訂單 / 使用紀錄 / 通知
  - 更新億家Pay餘額與錢包帳本
- 如果後端沒有回傳付款完成：
  - 不清購物車
  - 不發商品
  - 顯示「後端尚未回傳付款完成」

店舖結帳仍沿用既有 app_create_store_checkout_order() 正式 QR Code 流程。

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
