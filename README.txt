億家 App v0.10.4.0 Background Expiry Refund

本版：
- 使用 Supabase pg_cron 每小時自動執行一次逾期退款檢查。
- 不需要會員打開 App。
- 退款仍依購買當下價格快照。
- 退款一律回原購買人的億家錢包。
- 轉贈商品若到期未兌換，仍由原購買人收到退款。
- 同一訂單商品只處理一次。
- App 版本更新為 v0.10.4.0。

安裝：
1. 在 Supabase SQL Editor 執行 setup_v0_10_4_0_background_expiry_refund.sql
2. GitHub 更新 index.html

排程：
每小時第 5 分鐘執行一次。
