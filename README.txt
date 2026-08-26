億家 App v0.10.13.6 Reload Test Ready

這版先把「儲值測試」真正接通，方便直接測 TM 儲值 + 億家Pay付款。

App 儲值頁新增：
- 顯示正式會員條碼，供 TM 掃描
- 顯示會員代碼文字
- 進入儲值頁後每 2.5 秒讀一次正式儲值摘要
- TM 儲值成功後：
  - App 自動偵測新儲值紀錄
  - 顯示「儲值完成」
  - 自動更新錢包餘額
  - 自動更新最近儲值紀錄
  - 同步億家Pay支付頁餘額
- 離開儲值頁會停止輪詢，不在背景持續讀取

正式 TM 儲值仍使用：
tm_reload_yijiapay_wallet(phone, store_code, tm_sale_id, amount, description)

測試順序建議：
1. App → 億家Pay → 儲值
2. TM 掃 App 上方會員條碼
3. TM 輸入儲值金額、完成收現
4. App 會自動更新餘額
5. 回億家Pay
6. TM 掃 60 秒付款條碼 / QR Code
7. 完成付款，確認正式扣款與付款後餘額

此版純前端。
不用跑 SQL，只上傳新的 index.html。
