億家 App v0.10.14.5 YijiaPay Formal Flow

第六個主功能正式接通：
億家Pay 付款 / 儲值 / 正式交易資料確認

A. 付款碼
- 呼叫 app_create_yijiapay_pay_code()
- 產生後立即再讀 app_get_yijiapay_pay_code_status()
- 必須在正式後端找得到該付款碼
- 狀態必須為 pending
- 尚未過期
- 驗證完成後才顯示給使用者

維持既定規則：
- 每次進入億家Pay建立新付款碼
- 付款條碼 / QR Code 真正切換時建立新碼
- 按重新整理建立新碼
- 60秒到期建立新碼
- 同模式重複點擊不換碼
- App從背景 / 鎖屏回來不換碼

B. TM付款完成
App讀到 pay code = used 後，還會確認三份正式資料：
1. app_get_yijiapay_wallet_balance()
2. app_get_my_yijiapay_pay_history()
3. app_get_my_yijiapay_wallet_ledger()

三份正式資料都已寫入後，才顯示「付款已正式完成」。

C. 現金儲值
- 儲值仍由 TM 呼叫 tm_reload_yijiapay_wallet()
- App 不自行加值
- 偵測儲值後再讀 app_get_my_yijiapay_reload_summary()
- 正式 walletBalance 必須真的增加
- recentReloads 必須存在正式儲值紀錄
- 確認後才顯示「儲值已正式完成並入帳」

D. 退款
沿用已接通的正式退款流程：
- TM tm_refund_yijiapay_payment()
- App讀正式 pay code status / wallet / ledger / history
- App不自行加回餘額

正式 RPC：
- app_create_yijiapay_pay_code
- app_get_yijiapay_pay_code_status
- app_get_yijiapay_wallet_balance
- app_get_my_yijiapay_pay_history
- app_get_my_yijiapay_wallet_ledger
- app_get_my_yijiapay_reload_summary

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
