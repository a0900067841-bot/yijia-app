億家 App v0.10.13.13 Member Barcode TM Sync

這版調整：
- 首頁會員條碼改成與 TM 相同的正式會員條碼格式
- 放大會員條碼視窗同步改成同一組正式會員條碼
- 點數折抵頁中的會員條碼同步改成同一組正式會員條碼
- 儲值頁會員條碼也統一改走同一個正式會員條碼來源
- 會員條碼優先讀取：
  1. memberNo
  2. member_no
  3. memberCode
  4. member_code
  5. memberId / member_id
  6. phone（最後備援）

說明：
- 這版是前端調整，不用新增 SQL
- 目的就是把 App 內的會員條碼顯示邏輯，統一成和 TM 一樣
