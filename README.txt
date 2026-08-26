億家 App v0.10.9.4 Points Live Sync

這版修正 App 顯示 0 點及「目前未開放點數折抵」：

1. App 每次進入點數頁，先呼叫 app_sync_my_points_from_hq()。
2. 直接用 TM / SC 共用 HQ yj4_members 的會員 points 當目前餘額。
3. 點數頁停留期間每 5 秒自動同步一次。
4. 點數折抵規則直接讀 yj_point_settings：
   - earnAmount
   - earnPoints
   - redeemPoints
   - redeemAmount
5. 例如 SC 現在是 300 點折 $1，App 會直接顯示相同規則。
6. 不用等待下一筆 TM 交易，既有會員點數也會補到 app_points。

先執行 points_live_sync_backend.sql，再上傳 index.html。
