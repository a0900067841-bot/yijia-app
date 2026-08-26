億家 App v0.10.13.5 Points Core Sync

這版開始正式收尾「點數核心串接」，不新增新的點數玩法。

完成：
- App 點數頁進入時先呼叫 app_sync_my_points_from_hq()
- HQ yj4_members 維持正式點數權威來源
- 同步後讀取：
  - app_get_my_point_history()
  - app_get_point_feature_config()
- 保留既有：
  - 點數折抵
  - 點數兌換
  - 點數歷史
  - 點數到期
  - PR 點數兌換券
  - YPD 點數折抵券
- 同步完成後重新整理既有點數畫面
- 加入點數同步狀態提示
- 不另建第二套點數餘額

此版純前端。
不用跑 SQL，只上傳新的 index.html。

注意：
正式點數異動仍由既有 TM / HQ 流程與 RPC 處理，
App 不直接修改點數餘額。
