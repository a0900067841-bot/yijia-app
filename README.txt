億家 App v0.6 — Supabase 會員＋點數接通版

這一版：
- App 畫面仍是「手機號碼＋密碼」
- 不需要 Twilio / SMS
- Supabase 內部使用隱藏的技術 Email 識別，會員看不到
- 會員資料直接讀寫 app_members
- 點數餘額讀取 app_points
- 點數紀錄讀取 app_point_transactions
- 會員只能讀寫自己的會員資料
- 會員只能讀自己的點數
- App 不能自己新增/修改點數，避免會員自行加點
- 首次登入自動建立 0 點帳戶

重要：
1. 先在 Supabase SQL Editor 執行 setup_v0_6.sql。
2. Supabase Authentication > Email provider 必須啟用。
3. 開發測試期間需關閉「Confirm email」，否則假 Email 無法完成註冊。
4. 然後再把 index.html 覆蓋到 GitHub Pages。

正式公開前會再把登入機制換成正式會員驗證，不會讓隱藏技術 Email 成為會員可見資料。
