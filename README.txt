億家 App v0.10.9.7 Member Point Identity Sync

修正重點：
- 解決 App 仍顯示 0 點。
- 會員比對不再只看 phone/auth_user_id。
- 會同步比對：
  1. authUserId / auth_user_id
  2. id
  3. phone
  4. memberNo / code
  5. YJ + 手機號碼
- 若 HQ yj4_members 找不到，會再讀 yijia_member_point_sync_events 最新 balance_after。
- 找到後直接寫回 app_points。

這版 App 仍沿用原本每 5 秒自動同步。
先執行 member_point_identity_sync_backend.sql，再上傳 index.html。
