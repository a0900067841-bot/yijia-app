億家 App v0.10.13.7 Points Completion Sync

這版把既有點數功能「成功後同步」正式收尾，不新增新玩法。

完成：
- YPD 點數折抵被 TM 正式完成後：
  - App 停止監看
  - 呼叫 app_sync_my_points_from_hq()
  - 重新讀取正式點數餘額
  - 重新讀取點數歷史
  - 重新整理通知中心
- PR 點數兌換券被 TM 正式核銷後：
  - App 呼叫 app_sync_my_points_from_hq()
  - 重新讀取正式點數餘額
  - 重新讀取兌換紀錄
  - 重新整理通知中心
- App 建立點數兌換後，也會重新同步 HQ 正式點數資料
- HQ yj4_members 維持唯一點數權威來源
- App 不直接自行修改點數餘額

此版純前端。
不用跑 SQL，只上傳新的 index.html。
