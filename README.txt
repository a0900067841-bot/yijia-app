億家 App v0.9.6 — 隨買剩餘功能第一版完成

新增可用功能：
1. 轉贈商品
   - 選擇我的可兌換商品
   - 選數量
   - 可指定對方手機或留白
   - 產生 YG 領取碼 + CODE128 條碼
   - 建立後先扣轉贈數量，避免重複使用
2. 領取商品
   - 輸入 YG 領取碼
   - 領取成功加入接收者「我的商品」
3. 轉贈紀錄
4. 訂單明細
5. 訂閱管理資料頁
6. 預約管理資料頁

正式 key：
HQ / yj_app_gifts

預留資料 key：
HQ / yj_app_subscriptions
HQ / yj_app_reservations

注意：
- 訂閱與預約目前是資料讀取頁；尚未定義建立/取消等商業規則，所以沒有擅自做寫入。
- 轉贈商品採建立時先扣剩餘數量，領取後加入對方商品。
- 後續可再補「取消未領取轉贈」並恢復數量。

更新：
1. Supabase 執行 setup_v0_9_6_anybuy_complete.sql
2. GitHub yijia-app 覆蓋 index.html
