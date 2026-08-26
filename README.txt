億家 App v0.10.12.0 Pay Amount Receipt

新增：
- 億家Pay付款完成明細新增「付款金額」。
- 最近交易顯示實際付款金額。
- 付款完成通知顯示實際付款金額。
- app_yijiapay_pay_codes 增加：
  amount
  balance_before
  balance_after
- 新版 TM 建議改用：
  tm_complete_yijiapay_pay_code(pay_code, store_code, sale_id, amount)
- 保留舊 3 參數版本相容，不會直接破壞目前 TM。

注意：
此版只補「實際成交金額」紀錄。
錢包真正扣款仍應由億家Pay正式扣款交易流程負責。
