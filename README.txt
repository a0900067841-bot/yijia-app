億家 App v0.10.10.6 Login Hotfix

修正：
- v0.10.10.5 新增點數折抵快速選擇時，
  在 openPointDiscount() 內重複宣告 const input，
  造成整份 JavaScript 無法載入。
- 因此登入按鈕看起來「按了沒反應」。
- 已移除重複宣告。
- 已重新執行 JavaScript 語法檢查，通過。
- v0.10.10.5 的點數折抵快速選擇功能全部保留。

此版純前端，不需 SQL。
直接上傳新的 index.html。
