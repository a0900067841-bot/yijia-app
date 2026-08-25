億家 App v0.9.5.4 — 動態 App 功能管理

- 讀取 SC App設定的 appBackend.featureManagement。
- 所有帶 data-feature-code 的 App 入口會依 SC 設定自動顯示／隱藏。
- 相容舊版 appBackend.prebuiltHidden。
- 已接入：億家 Pay、優惠券、我的訂單、通知中心、活動專區／更多活動。
- 未來新增可隱藏入口時，只要在 App 新功能入口加 data-feature-code="SC功能代碼"，不需再修改 SC 功能管理 UI。
- 功能本體仍需正常開發；功能管理只控制是否顯示入口。
- 保留 v0.9.5.3 既有隨買跨店取組數＋數量功能。
