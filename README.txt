億家 App v0.10.15.5 Payment Limit Formal Flow

正式接通：億家Pay付款限額

本版完成：
- 億家Pay → 安全與設定 → 付款限額 正式可點
- 可設定：
  - 單筆付款上限
  - 每日付款上限
- 顯示：
  - 今日已付款
  - 今日剩餘可付款
- App 讀取 app_get_yijiapay_payment_limits()
- App 設定 app_set_yijiapay_payment_limits()

後端 SQL 另在聊天提供：
- app_yijiapay_payment_limits
- app_get_yijiapay_payment_limits()
- app_set_yijiapay_payment_limits(...)
- BEFORE UPDATE trigger on app_yijiapay_pay_codes
- 當付款碼由 pending → used 時：
  - 強制檢查單筆限額
  - 強制檢查 Asia/Taipei 當日已付款總額
  - 超過限額直接 exception，整個 TM 扣款 transaction rollback

此版需要跑 SQL。
