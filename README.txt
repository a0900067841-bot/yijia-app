億家 App v0.10.14.0 Anybuy Formal Purchase Flow

從這版開始改成「先把 App 功能真正接通」。

本版完成第一個主功能：隨買跨店取正式購買。

1. 億家Pay購買
商品 → 購物車 → 億家Pay → app_create_yijiapay_order()

後端回付款完成後，App 會再正式驗證：
- app_get_anybuy_order_history() 找得到訂單
- 訂單狀態確實 paid / 已付款
- app_get_member_products() 確實出現購買商品
- 重新讀億家Pay正式錢包餘額
- 全部確認後才清空購物車並顯示成功

任何一段沒有確認完成：
- 購物車不清空
- 不顯示假成功
- 顯示實際未完成階段

2. 店舖結帳
商品 → 購物車 → app_create_store_checkout_order()

建立後必須：
- 回傳 YS 開頭正式 paymentCode
- app_get_anybuy_order() 能立即讀回該訂單
- 確認存在後才清空購物車
- 顯示 YS QR Code 給 TM

TM 收款後：
- App 讀到 paid / 已付款
- 再確認 app_get_member_products() 已正式發放商品
- 確認後顯示「商品已正式加入我的商品」

正式 RPC：
- app_create_yijiapay_order
- app_create_store_checkout_order
- app_get_anybuy_order
- app_get_anybuy_order_history
- app_get_member_products

此版不建立假的購買資料、不使用 dev purchase。
不用跑 SQL，只上傳新的 index.html。
