億家 App v0.10.2.0 Order Price Snapshot

本版正式完成「購買當下價格快照」：
- 店舖結帳建立 YS 訂單時，由 Supabase 後端直接讀 SC 當下商品資料。
- 保存整組原價 originalPrice / originalBundlePrice。
- 保存當時售價 price / salePrice / bundlePrice。
- 保存每組數量 bundleQuantity。
- 保存購買組數 cartQuantity。
- 保存實付 paidAmount。
- 自動算 originalUnitPrice = 購買當時整組原價 ÷ 每組數量。
- 保存 maxPurchaseGroups，後端也會再次檢查限購。
- SC 日後改價不會影響舊訂單的退款基準。

安裝：
1. Supabase 執行 setup_v0_10_2_0_order_price_snapshot.sql。
2. GitHub 更新 index.html。
3. 建立一筆新的店舖結帳測試訂單，再檢查訂單 items 是否有 purchaseSnapshot。

注意：
舊訂單不會被回填新快照；只有本版之後新建立的訂單才會完整保存購買當下價格。
