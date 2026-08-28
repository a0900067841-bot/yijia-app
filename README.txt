億家 App v0.10.16.1 YijiaPay PIN Security Flow

正式新增：
進入億家Pay前必須輸入 4 位數安全密碼。

流程：
- 第一次進入億家Pay：建立 4 位數安全密碼並再次確認
- 後續每次重新進入億家Pay：先驗證 4 位數安全密碼
- 在億家Pay內切換錢包、點數折抵、付款紀錄、付款限額等頁面，不重複要求
- 一旦離開億家Pay區域，就重新鎖定
- 再次進入時必須重新輸入
- 登出時強制重新鎖定

後端安全：
- PIN 只保存 PostgreSQL crypt() 雜湊，不保存明碼
- 連續輸入錯誤會記錄失敗次數
- 5 次錯誤後暫時鎖定 5 分鐘
- 正確驗證後清除失敗次數

這版需要執行聊天中提供的 SQL。

PWA 檔案仍需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
