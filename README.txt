億家 App v0.10.13.0 Wallet Debit Core

這版開始正式「接通核心」，不再新增零碎功能。

完成：
- 正式 app_yijiapay_wallets 錢包
- 正式 app_yijiapay_wallet_ledger 帳本
- App 正式錢包餘額 RPC
- TM 掃付款碼可讀會員目前錢包餘額
- TM 完成交易時正式原子扣款
- 餘額不足不扣款
- 過期付款碼不扣款
- 同付款碼重複完成不重複扣款
- source_key 再做一層防重複
- 扣款成功記錄：
  - 金額
  - 付款前餘額
  - 付款後餘額
  - 門市
  - TM交易編號
- App付款完成明細新增付款前/後餘額
- App可讀正式錢包帳本

正式 TM 完成付款必須呼叫四參數：
tm_complete_yijiapay_pay_code(pay_code, store_code, sale_id, amount)

舊三參數版本會回 amount_required，不會做0元完成。

更新方式：
1. 執行 wallet_debit_core_backend.sql
2. 上傳新的 index.html
