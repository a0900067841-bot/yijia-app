億家 App v0.10.13.2 Wallet Reload Core

這版把億家Pay「正式現金儲值」接通。

完成：
- 新增 app_yijiapay_settings
  - monthly_cash_reload_limit
  - cash_reload_enabled
- 預設每月現金儲值上限 NT$5,000
- 新增 app_yijiapay_reloads 正式儲值紀錄
- TM 正式儲值：
  tm_reload_yijiapay_wallet(phone, store_code, tm_sale_id, amount, description)
- 每月額度依 Asia/Taipei 曆月計算
- 超過本月剩餘額度 -> 不入帳
- 同一 tm_sale_id -> 不重複儲值
- 儲值與 wallet / ledger 同一 transaction
- App 主支付頁的「本月現金儲值額度」改讀正式資料
- 「儲值」按鈕不再是預留：
  會進入正式儲值頁，顯示：
  - 目前餘額
  - 本月額度
  - 本月已儲值
  - 本月剩餘額度
  - 最近儲值紀錄
- App 不自行加值，正式現金儲值仍由門市 TM 完成。

更新方式：
1. 執行 wallet_reload_core_backend.sql
2. 上傳新的 index.html
