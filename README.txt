億家 App v0.10.13.10 Anybuy Store Checkout Sync

這版把「隨買跨店取 → 門市付款」完成後的 App 同步流程正式收尾。

完成：
- App 建立門市待付款訂單後持續監看正式訂單狀態
- TM 完成門市付款後，App 偵測 paymentStatus=paid / 已付款
- 停止訂單輪詢
- 顯示「付款完成，商品已同步到我的商品」
- 自動同步：
  - 我的商品
  - 訂單管理
  - 商品使用紀錄
  - 通知中心
- 新建立下一筆訂單時會清除上一筆完成提示

這版不新增第二套訂單資料。
仍以既有 app_get_anybuy_order / app_get_anybuy_order_history / app_get_member_products 為正式來源。

此版純前端。
不用跑 SQL，只上傳新的 index.html。
