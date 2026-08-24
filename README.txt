億家 App v0.4 — 手機號碼登入／會員資料版

本版調整：
- 手機號碼就是登入帳號
- 手機號碼＋密碼註冊
- 手機號碼＋密碼登入
- 自動把台灣 09xxxxxxxx 轉成 Supabase 使用的 +8869xxxxxxxx
- 新增會員資料頁
- 會員可填寫／編輯：
  姓名
  生日
  性別
  Email
  地址
  國籍
- Email 僅為會員資料，不是登入帳號
- 會員資料先存 Supabase Auth user_metadata
- 顯示手機號碼、密碼入口、生物辨識登入介面、取消會員介面

重要：
Supabase Dashboard 必須啟用 Phone provider，才可以使用 phone + password。
如果專案開啟 Phone confirmation，註冊時仍會要求手機驗證；若要完全不走 SMS 驗證，
需在 Supabase Auth 設定中調整 Phone confirmation/驗證策略。

目前點數、隨買商品、我的商品仍需之後接真實資料表。
