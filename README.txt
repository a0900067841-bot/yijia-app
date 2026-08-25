億家 App v0.10.0.4 Limit Field Fix

修正：
- 已確認 SC 寫入 Supabase 的實際限購欄位為 maxPurchaseGroups。
- App 現在會正確讀取 maxPurchaseGroups。
- 例：maxPurchaseGroups = 1 → 商品詳情顯示「限購組數 1 組」。
- 購物車與購買數量也會遵守此限購值。
- 0 仍代表不限購。

本版不用跑 SQL。
只要把 index.html 上傳 GitHub 覆蓋原檔即可。
