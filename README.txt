億家 App v0.10.15.9 PWA Install Formal Flow

本版完成 Web App → 可加入主畫面的正式 PWA 外殼：

- manifest.webmanifest
- service-worker.js
- 180 / 192 / 512 App icon
- iPhone / iPad Safari「加入主畫面」教學
- 支援 beforeinstallprompt 的瀏覽器可直接安裝
- App Info 新增加入主畫面入口
- 從主畫面開啟時使用 standalone App 模式

離線原則：
- 只快取 App 外框 / 啟動資源
- Supabase、會員、點數、付款、訂單、優惠券、隨買等資料不做離線快取
- 避免顯示過期交易狀態

重要：
這版除了 index.html，還要一起上傳：
- manifest.webmanifest
- service-worker.js
- icons 資料夾

不用跑 SQL。
