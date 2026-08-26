億家 App v0.10.11.6 Pay Code Cloud Sync

這版把 v0.10.11.5 的 60 秒付款碼正式改成 Supabase 雲端 Token：

- 付款條碼與 QR Code 使用同一組付款 Token。
- Token 有效 60 秒。
- 手動按 🔄 會取消舊碼並產生新碼。
- 到期會自動產生新碼。
- 付款碼不再直接包含會員手機號碼。
- 同一會員同時間只保留一張 pending 付款碼。
- TM 預做：
  - tm_get_yijiapay_pay_code(text)
  - tm_complete_yijiapay_pay_code(text,text,text)

注意：
這版只完成「付款碼身份 / 有效期限 / 使用狀態」同步，
真正錢包扣款仍應沿用億家Pay正式交易流程，不在此函式直接扣款。

更新：
1. 執行 pay_code_cloud_sync_backend.sql
2. 上傳 index.html
