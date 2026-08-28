億家 App v0.10.15.4 Member Identity Formal Flow

第十五個主功能正式接通：
會員身份 / 會員條碼

正式來源：
- app_current_member_json()
- HQ yj4_members

規則：
- 第一優先 tmMemberNo
- 第二優先 memberNo
- 禁止手機號碼當會員條碼
- 禁止 YJ + 手機號碼當會員條碼

本版完成：
- 我的 → 會員條碼
- 顯示正式會員姓名 / 會員編號 / CODE128
- 顯示手機登入帳號
- 可重新同步正式會員資料
- 同步後重繪首頁 / 放大會員條碼 / 儲值條碼 / 點數折抵會員碼
- 會員條碼只做會員識別 / 累點，不能當億家Pay付款碼

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
