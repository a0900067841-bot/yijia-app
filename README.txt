億家 App v0.10.13.26 My Products Live Sync Fix

這版修正一個實際 view id 問題：

HTML 正式結構是：
- section id="products" ＝「我的商品」整頁
- div id="myProducts" ＝頁面裡面的商品清單容器

先前部分同步邏輯錯把 myProducts 當成 view id，
因此在「我的商品」頁有些即時監看其實不會啟動。

本版修正：
- showView 正式改用 products
- Anybuy Core Refresh 正式改用 products
- 到期退款監看正式改判斷 products 頁
- 新增「我的商品」每 10 秒正式同步 app_get_member_products()

我的商品發生以下變化時會自動更新：
- 新購買商品加入
- 兌換後剩餘數量變化
- 轉贈後所有權 / 數量變化
- 領取轉贈商品
- 退貨申請狀態
- 退款完成
- 商品到期 / 到期退款
- 其他正式商品生命週期狀態

偵測到變化後同步更新：
- 我的商品
- 商品使用紀錄
- 訂單管理
- 通知中心

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
