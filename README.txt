億家 App v0.10.14.1 Anybuy Redeem Formal Flow

第二個主功能正式接通：
我的商品 → YD兌換 → TM完成兌換 → 正式扣剩餘數量

正式流程：

1. 開始兌換前
- 重新讀 app_get_member_products()
- 確認商品仍存在
- 確認 remainingQuantity 足夠
- 不相信畫面上的舊剩餘數量

2. 建立兌換碼
- 呼叫 app_create_redeem_ticket()
- 必須取得 YD 開頭正式兌換碼
- 沒有正式 YD code 不顯示成功

3. TM 掃描完成後
- App 每 2.5 秒重新讀 app_get_member_products()
- 正式 remainingQuantity 必須下降到預期值
- 確認後才顯示「兌換完成」

4. 完成後同步
- 我的商品
- 商品使用紀錄
- 通知中心
- 兌換 QR Code 變成「已完成兌換」

5. 安全原則
- App 不自行扣 remainingQuantity
- App 不建立假兌換紀錄
- 真正扣數量由 TM / 後端正式兌換流程完成
- App 只驗證正式結果

使用既有正式 RPC：
- app_get_member_products
- app_create_redeem_ticket
- app_get_product_usage_history

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
