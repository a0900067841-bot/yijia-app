億家 App v0.10.17.3 Return Mode Source Fix

根本原因：
app_get_member_products() 仍用舊規則判斷 returnMode：
只要商品帶 paidStoreCode，就可能被標成 original_store。
所以即使 app_create_return_request 已修成 online，
App 重新讀「我的商品」時仍可能被舊 returnMode 蓋回門市退貨。

本版前端補強：
- returnMode 不再是唯一判斷來源
- 只要 paymentSource=wallet / online
- 或 paymentMethod 包含 億家Pay / 線上
- 或 source 包含 億家Pay / 線上支付
- 或退貨碼是 RO
就一律視為線上退貨，不顯示門市條碼。

此版仍需要執行聊天中提供的 app_get_member_products SQL 修正，
讓後端資料源本身也改正。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
