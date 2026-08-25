億家 App v0.9.9 Refund Calculator

本版完成：
- 退貨改為可針對「剩餘未使用商品」計算退款，不再限制只要曾兌換就完全不能退。
- 已兌換／預約／轉贈會納入已使用數量；轉贈視同已兌換／領取。
- 退款公式：
  付款金額
  -（已使用完整組數 × 一組商品金額）
  - min（未滿一組已使用數量 × 單個商品原價，一組商品金額）
  最低為 0 元。
- App「我的商品」顯示目前試算退款。
- 退貨申請頁顯示完整試算明細與預計扣回點數。
- YR 退貨申請資料新增 refundAmount、pointsToDeduct、bundleQuantity、bundlePrice、
  unitOriginalPrice、usedQuantity 等欄位，供 TM 後續直接使用。
- 保留目前 7 日主動退貨期限及「店舖結帳回原付款門市」規則。
- 收禮人取得的轉贈商品仍不可由收禮人退貨。

重要：
若有「未滿一組」已使用數量，系統必須知道「單個商品原價」。
SQL 支援 originalUnitPrice / unitOriginalPrice / singleOriginalPrice /
singlePrice / originalPrice，建議 SC 正式統一使用 originalUnitPrice。

安裝順序：
1. 先在 Supabase SQL Editor 執行 setup_v0_9_9_refund_calculator.sql。
2. SQL 成功後，把 index.html 上傳 GitHub 覆蓋原檔。
3. App → 我的 → App版本，確認 v0.9.9 Refund Calculator。
4. 用測試商品查看「我的商品」的試算退款。

本版先處理「購買後主動退貨」的退款試算。
「商品逾兌換／預約期限後自動退款到原購買人億家錢包」將在下一階段處理。
