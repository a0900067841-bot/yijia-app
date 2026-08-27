億家 App v0.10.13.18 Subscription Reservation Sync

這版把既有「訂閱管理 / 預約管理」正式資料同步接完整，不新增尚未定案的新規則。

完成：
- 訂閱管理讀取 app_get_member_subscriptions()
- 預約管理讀取 app_get_member_reservations()
- 進入任一頁後每 10 秒重新同步正式狀態
- 偵測到狀態變更時即時更新畫面
- 狀態變更時同步刷新通知中心
- 離開訂閱 / 預約頁後停止輪詢
- 修正先前 Anybuy Core Refresh 使用 subscriptions / reservations 錯誤 view id，
  改為實際 subscriptionManagement / reservationManagement

目前只同步已存在的正式資料與狀態。
不自行新增訂閱取消、修改頻率、預約取消等商業規則，
那些等 SC / TM 正式規則確定後再接。

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
