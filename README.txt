億家 App v0.10.9.8 Point Ledger Sync

新增：
- 點數紀錄改為直接讀 TM / SC 正式同步事件。
- 一般消費累點、活動贈點、點數折抵、點數兌換、退貨扣點都會進同一份明細。
- 每筆可顯示異動後餘額。
- App 專屬點數交易仍保留，並以 source_id 避免重複。

更新：
1. 執行 point_ledger_sync_backend.sql
2. 上傳 index.html
