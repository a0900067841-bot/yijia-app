億家 App v0.10.13.23 Reload History Live Sync

這版把億家Pay「現金儲值完成後的 App 即時同步」再補完整。

完成：
- 儲值頁每 2.5 秒讀 app_get_my_yijiapay_reload_summary()
- 不只看最新一筆儲值 ID，也比較：
  - walletBalance
  - monthlyLimit
  - usedThisMonth
  - remainingThisMonth
  - recentReloads
- TM 完成儲值後，App 自動更新：
  - 儲值成功提示
  - 儲值頁錢包餘額
  - 本月現金儲值額度
  - 最近儲值紀錄
  - 億家Pay首頁餘額
  - 錢包帳本
  - 通知中心
- 即使後端 recentReloads 的 id 欄位型態不同，只要正式餘額或歷史資料變動仍可偵測。

不新增儲值邏輯。
儲值仍由 TM 正式 tm_reload_yijiapay_wallet() 執行，
App 只讀正式結果。

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
