億家 App v0.10.5.1 Redemption Qty Fix

修正：
1. TM 兌換成功後，App「我的商品」下方兌換紀錄不再固定顯示 0 件。
2. 兌換數量支援 quantity / redeemedQuantity / redeemQuantity / qty / items 等不同 TM 紀錄格式。
3. 商品使用紀錄 → 兌換，同步套用相同數量判斷。
4. 保留 v0.10.5.0 的剩餘數量同步與其他既有功能。

本版只有前端 index.html 修正，不需要執行 SQL。

GitHub：
將 index.html 上傳覆蓋 yijia-app 專案原本的 index.html 後 Commit。
