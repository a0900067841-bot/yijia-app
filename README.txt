億家 App v0.10.9.1 Points Sync

修正重點：
- 不再使用 App 自己的 1 點 = $1 規則。
- 直接讀取 TM / SC 已存在的 app_point_feature_settings。
- redeem_unit_points = 折抵所需點數。
- redeem_unit_amount = 可折抵金額。
- 例如後台目前 300 點折 1 元，App 會顯示並限制為 300、600、900…點。
- 後台日後改比例，App 自動同步。

點數兌換：
- 直接沿用 TM Alpha 9.02 已預做的 app_point_rewards、
  app_get_point_rewards()、
  app_redeem_point_reward(uuid, integer, text)、
  tm_sync_member_points()。
- 不再建立另一套兌換規則。

點數折抵：
- App 產生 YPD QR。
- TM 掃碼只讀取預選點數與折抵金額。
- 交易成功後才呼叫 tm_complete_point_discount_ticket()。
- 正式扣點走既有 tm_sync_member_points()，因此 TM / SC / App 同步。

更新順序：
1. 先執行 points_sync_existing_tm_settings.sql。
2. 再上傳 index.html。
