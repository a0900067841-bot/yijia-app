億家 App v0.10.17.1 Existing Return Resume Flow

修正實機回報：
上一筆退貨申請其實已成功建立 YR，因此 app_get_member_products
會把 returnEligible 改為 false。使用者再次按「確認申請退貨」時，
App 原本只顯示「這筆商品目前已不符合退貨條件」。

本版修正：
- 若 returnEligible=false，但商品已有有效 returnCode / returnRequestStatus
  → 不再顯示不符合條件
  → 直接開啟既有 YR 退貨條碼
  → 繼續監控 TM 退貨狀態
- 避免同一商品重複建立第二張退貨申請
- 已退貨 / 已退款 / 已取消 / 已駁回不會誤開舊條碼
- 退貨資格、7 天規則、原門市限制都不變

此版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
