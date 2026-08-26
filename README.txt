億家 App v0.10.11.7 Pay Code Status Sync

新增：
- App 每 3 秒查詢目前億家Pay付款碼狀態。
- pending：顯示「等待 TM 掃描付款碼」。
- used：顯示「付款完成」，並自動跳出完成明細。
- 完成明細顯示：
  - 付款碼
  - 完成時間
  - 完成門市
  - TM 交易編號
- expired / cancelled：App 自動重新產生新付款碼。
- 付款完成後重新讀取億家Pay餘額。
- 離開億家Pay頁面會停止狀態輪詢。

沿用 v0.10.11.6 已建立的：
app_get_yijiapay_pay_code_status(text)

此版純前端，不需再跑 SQL。
只需上傳新的 index.html。
