億家 App v0.7 — 隨買 / 我的商品 / 兌換紀錄

本版新增：
1. 隨買跨店取
   - 直接讀 Supabase app_products
   - 商品搜尋
   - 商品名稱 / 說明 / 價格 / 圖片
   - 選購商品詳細畫面
   - 正式付款尚未接通，所以不建立假付款

2. 我的商品
   - 直接讀 app_member_products
   - 顯示購買數量
   - 顯示剩餘數量
   - 顯示有效期限
   - 有商品才可按兌換
   - 兌換仍以會員條碼交給 TM 處理

3. 兌換紀錄
   - 直接讀 app_redemptions
   - 顯示商品、數量、門市代碼、時間

安全：
- 顧客只能讀自己的 app_member_products
- 顧客只能讀自己的 app_redemptions
- 顧客端沒有 insert/update 已購商品或兌換紀錄權限
- 購買成功與 TM 兌換之後要由安全後端寫入，避免會員自行增加商品或偽造兌換

使用順序：
1. 在 Supabase SQL Editor 執行 setup_v0_7.sql
2. 成功後，把 index.html 覆蓋 GitHub Pages
3. 登入 App
4. 「隨買」應可看到兩筆測試商品
5. 「我的商品」若尚未有購買資料會顯示空白狀態
