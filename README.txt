億家 App v0.10.16.8 Checkout Single Tap Flow

修正使用者實機回報：
購物車「前往結帳」要按好幾下才會進下一頁。

原因：
原本 openCheckout() 會先 await Supabase / SC 商品主檔同步，
同步完成後才 showView('checkout')。
網路慢時畫面完全不動，使用者會誤以為沒按到而重複點擊。

本版修正：
- 第一次點「前往結帳」就立即切到付款資訊頁
- 按鈕立即變成「正在前往結帳…」
- 新增 checkoutOpening 防重複點擊
- 付款資訊頁顯示「正在核對最新商品資料…」
- 同步完成後才開放選擇付款方式
- 若商品價格 / 數量有更新，重新渲染付款頁並提醒
- 若商品已下架或不可購買，自動返回購物車
- 不降低後端商品價格重新核對的安全性

此版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
