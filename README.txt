億家 App v0.10.8.2 Product Redeem QR

這版把「我的商品」兌換流程改成商品專用 QR：

1. 「出示會員條碼」改成「出示兌換條碼」。
2. 會員先選本次兌換數量。
3. App 呼叫 app_create_redeem_ticket() 產生 YD 開頭的一次性兌換碼。
4. QR 有效 600 秒。
5. QR 內容只代表這次選定的商品與數量，不是會員條碼。
6. 同一會員同一商品重新產生兌換碼時，舊的 pending 碼會取消。
7. 一般會員條碼仍保留給正常消費結帳集點。

TM 串接規則：
- 掃到 YD 開頭：
  1) 呼叫 tm_get_app_redeem_ticket(YD...)
  2) 取得 memberPhone / memberProductId / quantity
  3) 交給既有 tm_redeem_anybuy 正式兌換流程
  4) 只有 tm_redeem_anybuy 成功後，才呼叫 tm_complete_app_redeem_ticket(...)
- 這樣既有的剩餘數量、到期限制、兌換紀錄、營收認列規則都繼續沿用。

需要：
- 先在 Supabase SQL Editor 執行 redeem_ticket_backend.sql 內容一次。
- 再上傳新的 index.html。
