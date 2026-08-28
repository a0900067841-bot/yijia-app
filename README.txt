億家 App v0.10.15.3 YijiaPay Disable Formal Flow

第十四個主功能 / 安全功能正式接通：
停用 / 重新啟用億家Pay

本版：
- 新增億家Pay安全設定頁
- 正式讀取 app_get_yijiapay_security_settings
- 正式設定 app_set_yijiapay_enabled
- 停用億家Pay：
  - 後端記錄 enabled=false
  - 取消此會員所有 pending 付款碼
  - App 清除目前付款碼
  - 後續禁止建立新付款碼
- 重新啟用後才可再次建立付款碼
- 錢包餘額、交易歷史不會因停用而刪除

Face ID / Passkey：
- 仍不做假的前端開關
- 等正式 WebAuthn 驗證後端再接

付款限額：
- 仍不提供假的前端設定
- 必須與 TM 正式扣款 RPC 同步強制驗證後才可開放

此版需要執行聊天中提供的 SQL。
