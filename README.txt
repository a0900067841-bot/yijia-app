億家 App v0.10.13.15 Member Barcode Official Fix

修正重點：
1. 會員條碼優先使用 TM / HQ 正式會員條碼，不使用手機號碼。
2. 條碼抓取邏輯擴充，會優先尋找：
   tm_member_no / tmMemberNo / member_barcode / memberBarcode / barcode / barcode_no / card_no / vip_no / member_no / memberNo。
3. 如果同時存在 M0143946 與 YJ0903114385，會優先選 M0143946 這種正式會員條碼。
4. 首頁、會員條碼彈窗、儲值頁、點數折抵頁都共用同一套正式條碼解析。

如果這版仍然顯示 YJ0903114385，代表目前 app_current_member_json / HQ 回傳給 App 的資料本身就沒有 M0143946，
那就需要在另一個 TM / SC 聊天室把正式會員條碼欄位下傳給 App。

此版不用跑 SQL，只上傳新的 index.html。
