億家 App v0.10.10.3 Point Rule Sync Fix

修正：
- 點數餘額已成功同步，但「點數規則」顯示同步失敗。
- app_get_point_feature_config() 改為直接讀既有 TM / SC 的 yj_point_settings。
- 相容 HQ / 001 與直接 JSON / settings / pointSettings 包裝。
- 非數字或空值不再讓整個 RPC 失敗。
- 比例會同步回 app_point_feature_settings，讓點數折抵與其他既有 RPC 共用同一規則。
- 前端若後端短暫失敗，不再整張顯示「讀取失敗」，會保留最後可用規則並標示等待同步。

更新：
1. 執行 point_rule_sync_fix_backend.sql。
2. 上傳 index.html。
