億家 App v0.10.14.9 Subscription Reservation Formal Flow

第十個主功能正式接通：
訂閱管理 / 預約管理

正式資料來源：
- app_get_member_subscriptions
- app_get_member_reservations

本版完成：
- 訂閱管理正式列表
- 預約管理正式列表
- 點擊可查看正式明細
- 10 秒正式狀態同步
- 訂閱 / 預約狀態加入通知中心
- 資料更新後會自動刷新狀態

重要：
目前只接「正式查看與狀態同步」。
沒有新增取消訂閱、修改訂閱、取消預約、修改預約按鈕，
因為這些業務規則尚未由 SC / TM 正式定義。
App 不自行猜規則，也不建立假操作。

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
