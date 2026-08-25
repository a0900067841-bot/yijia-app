億家 App v0.10.0.2 Login Fix

修正：
- v0.10.0.1 新增購物車欄位時，JavaScript 同一運算式混用了 ?? 與 ||。
- Safari 會因此整份 JavaScript 無法解析，導致登入功能也一起失效。
- 已修正語法，保留 v0.10.0.1 的商品詳情頁與購物車功能。

部署：
- 不需要跑 SQL。
- 只要把 index.html 上傳 GitHub 覆蓋原檔。
