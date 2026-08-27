億家 App v0.10.13.11 Anybuy Redemption Completion Sync

這版把「隨買跨店取 → 商品兌換」完成後的 App 即時同步正式收尾。

完成：
- App 產生商品兌換 QR Code 後，每 2.5 秒讀正式 app_get_member_products
- TM 完成兌換、正式剩餘數量下降後，App 自動判定兌換完成
- 兌換完成後：
  - 停止 QR 倒數
  - 停止兌換輪詢
  - QR 區改顯示「已完成兌換」
  - 顯示「兌換完成，商品數量已更新」
  - 更新我的商品
  - 更新商品使用 / 兌換紀錄
  - 更新通知中心
- 離開 / 取消兌換畫面時停止輪詢
- 我的商品頁原本的 TM 兌換同步也改成統一刷新正式資料

不新增第二套兌換資料。
正式商品剩餘數量仍以 app_get_member_products 為準。

此版純前端。
不用跑 SQL，只上傳新的 index.html。
