億家 App v0.10.14.4 Points Formal Flow

第五個主功能正式接通：
會員點數 / YPD 點數折抵 / PR 點數兌換

正式會員與點數來源：
- HQ yj4_members
- app_sync_my_points_from_hq()
- 正式會員編號 Mxxxxxxx
- App 不用手機號碼當會員條碼

YPD：
- 建立前重新同步 HQ 正式點數
- 確認正式會員編號與可用點數
- app_create_point_discount_ticket()
- 必須取得 YPD 開頭正式折抵碼
- TM 完成後，App 再同步 HQ 點數
- 正式點數必須扣除預期點數後，才顯示完成

PR：
- 確認正式兌換商品與所需點數
- 確認 HQ 正式點數足夠
- app_create_point_reward_redemption()
- 必須取得 PR 開頭正式兌換碼
- TM 完成後，App 再同步 HQ 點數
- 正式點數扣除所需點數後，才顯示完成

完成後同步：
- 點數餘額
- 點數明細
- 通知中心

安全原則：
- App 不自行扣點
- YPD / PR 產生本身不扣點
- 只有 TM 正式完成後，由後端正式扣點
- App 只驗證正式結果

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
