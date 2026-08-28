億家 App v0.10.15.2 Navigation Integrity Formal Flow

第十三個主功能接通：
App 導覽 / 入口完整性

本版完成：
- 首頁右上角通知鈴鐺正式接到通知中心
- 商品詳情返回鍵修正：
  anybuyHome → redeem
- 清除舊版失效 view：
  anybuyHome
  anybuyOrders
  subscriptions
  reservations
- 新增 resolveAppViewId()
  若未來仍有舊版入口指向不存在頁面，不會出現空白頁，會安全返回首頁
- 「我的 → App版本」正式可點
- 新增 App資訊頁

此版特別檢查所有 showView() 入口與實際 view id，
避免畫面上有按鈕但按下去沒有頁面。

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。

- 修正 YPD 建立後錯誤導向不存在的 pointDiscountTicket；正式回到 pointDiscount 內的 QR 區塊。
