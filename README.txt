億家 App v0.10.16.7 YijiaPay Order Formal Ready

本版配合新增後端：
app_create_yijiapay_order(p_items jsonb, p_payment_source text)

App 流程：
- 後端重新核對商品主檔與價格
- 億家Pay錢包扣款
- 建立已付款隨買訂單
- 發放商品到我的商品
- 寫入億家Pay錢包帳本
- App 再讀訂單 / 我的商品 / 錢包餘額做完成驗證
- 任一後端步驟失敗時，SQL transaction rollback

此版需要先執行聊天中提供的 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
