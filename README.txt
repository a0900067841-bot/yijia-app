億家 App v0.10.13.14 Member Barcode HQ Sync

修正 v0.10.13.13 的錯誤：
- 會員條碼不能使用手機號碼。
- App 會員條碼要與 TM / HQ 正式會員編號完全一致。
- 例如正式會員編號是 M0143946，App 就必須顯示/產生 M0143946 的 Code128。

本版改成：
- 登入後呼叫既有 app_current_member_json()
- 從 HQ / TM 共用會員資料取得正式 memberNo
- 把 memberNo 合併到 App 當前會員資料
- 首頁會員條碼、放大會員條碼、儲值頁會員條碼、點數折抵會員條碼全部使用正式 memberNo
- 不再以 phone / 手機號碼作為會員條碼備援
- 如果正式 memberNo 尚未同步，畫面會顯示「尚未同步」，不會錯用手機號碼產生條碼

此版純前端。
不用跑 SQL，只上傳新的 index.html。
