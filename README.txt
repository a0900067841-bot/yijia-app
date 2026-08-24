億家 App v0.9.5.1 Login Fix

修正：v0.9.5 移除「我的」頁上方重複會員卡後，登入流程仍直接存取 meName/meEmail，造成登入後會員資料讀取失敗。
本次只需更新 GitHub 的 index.html，不需要執行 Supabase SQL。
