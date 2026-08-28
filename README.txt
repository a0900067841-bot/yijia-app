億家 App v0.10.15.6 Account Cancellation Formal Flow

正式接通：取消會員申請

App：
- 會員資料 → 取消會員 正式可點
- 先檢查正式資料：
  - 億家Pay餘額必須為 0
  - 不可有可兌換商品
  - 不可有待付款 / 待處理訂單
- 送出前重新驗證目前密碼
- 正式建立 pending 取消會員申請
- pending 狀態可撤回
- 顯示正式申請時間與狀態

後端：
- app_member_cancellation_requests
- app_get_member_cancellation_status()
- app_request_member_cancellation(text)
- app_withdraw_member_cancellation()

設計原則：
- App 前端不直接 DELETE auth.users
- 不直接刪交易、錢包、發票/存根或依法需保留的資料
- 正式申請完成後的最終註銷由後台流程處理

此版需要執行聊天中提供的 SQL。
