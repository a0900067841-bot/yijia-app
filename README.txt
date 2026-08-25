億家 App v0.10.9.0 Points Redeem & Discount

新增：
1. 點數兌換
   - 點數頁新增「點數兌換」入口。
   - 兌換項目由 HQ state：yj_app_point_rewards 讀取。
   - 兌換成功即扣點，寫入 app_point_transactions。
   - 同步建立「我的點數兌換」紀錄。

2. 點數折抵
   - 點數頁新增「點數折抵」入口。
   - 會員在 App 先選要使用的點數。
   - App 產生 YPD 開頭、600 秒有效的折抵 QR Code。
   - TM 不再提供點數選擇。
   - TM 掃 YPD 後取得 points / discountAmount。
   - 一般商品交易成功後，才呼叫 tm_complete_point_discount_ticket() 正式扣點。
   - 若交易取消，不會先扣會員點數。

3. SC 可預留的設定
   yj_hq_app_settings → appBackend：
   - pointDiscountEnabled
   - pointDiscountPointsPerDollar
   - pointDiscountMinPoints
   - pointDiscountStep
   - pointDiscountMaxPoints

目前預設：
- 1 點 = $1
- 最低 1 點
- 1 點為單位
- 0 = 不設折抵點數上限

注意：
- 先執行 points_redeem_discount_backend.sql。
- 再上傳 index.html。
- 點數兌換商品若尚未由 SC 上架，App 會正常顯示「目前沒有上架中的點數兌換項目」，不會出現假商品。
