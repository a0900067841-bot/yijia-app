億家 App v0.10.16.9 Cart Blue + Checkout Sync Fix

本版完成兩件事：

1. 商品詳情「加入購物車」改成藍色主按鈕
- 藍底白字
- 按下時有深藍按壓效果
- 不可購買時維持灰色
- 商品數量 + / - 同步改成藍色系
- 舊版商品彈窗的加入購物車按鈕也同步藍色

2. 修正付款資訊頁「目前無法核對最新商品資料」
原因：
syncCartWithCurrentCatalog() 呼叫不存在的 bundleQuantity(current)
但目前 App 真正存在的 helper 是 bundleQty(current)
因此每次前往結帳都會丟 ReferenceError。

已改為：
bundleQty(current)

這版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
