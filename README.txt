億家 App v0.10.16.0 PWA Update Reliability Flow

本版完成：
- App 有新版本時顯示更新提示
- 「App 資訊」可手動檢查更新
- 新版 service worker 不再自動搶接手
- 使用者點「立即更新」後才切換新版並重新載入
- 避免付款、兌換、退貨流程中途被 service worker 自動刷新
- 網路離線時顯示「目前離線」
- 恢復連線後重新同步一般正式資料
- 恢復連線不會建立 / 更新億家Pay付款碼
- Service Worker cache 更新到 v0.10.16.0
- API / Supabase 仍不離線快取

這版不用跑 SQL。

需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons 資料夾
