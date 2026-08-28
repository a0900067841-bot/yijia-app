億家 App v0.10.15.1 Payment Methods Formal Status

第十二個主功能接通：
付款方式管理

原本億家Pay頁面的「管理」按鈕沒有功能，
信用卡與銀行帳戶也只是靜態文字。

本版完成：
- 新增正式「付款方式管理」頁
- 億家Pay錢包狀態讀 app_get_yijiapay_wallet_balance
- 點數折抵狀態讀 app_get_point_feature_config
- 億家Pay錢包正式顯示可用
- 點數折抵依正式後端設定顯示開放 / 未開放
- 信用卡 / 簽帳金融卡在沒有合法金流串接前明確標示未接通
- 銀行帳戶在沒有正式授權流程前明確標示未接通
- 不建立假的綁卡或銀行帳戶資料

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
