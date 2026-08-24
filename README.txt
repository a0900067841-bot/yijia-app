億家 App v0.9 — 開發測試購買 / 兌換

新增：
- 隨買商品詳情：「開發測試購買」
- 購買後真的建立 app_member_products
- SC quantity → quantity_total / quantity_remaining
- SC validityDays → 自動計算 expires_at
- 我的商品：「測試兌換1件」
- 兌換會真的扣 quantity_remaining
- 同時建立 app_redemptions 紀錄

正式版：
- 移除開發測試購買按鈕
- 購買改由億家Pay / 正式金流成功後建立
- 移除 App 端測試兌換按鈕
- 兌換改由 TM 掃會員條碼與商品完成

使用：
1. Supabase SQL Editor 執行 setup_v0_9.sql
2. 成功後覆蓋 GitHub Pages 的 index.html
3. App → 隨買 → 商品 → 開發測試購買
4. App → 我的商品 → 測試兌換1件
5. 確認剩餘數量與兌換紀錄同步
