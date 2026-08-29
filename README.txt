億家 App v0.10.17.0 Return Request Record Fix

修正使用者實機回報：
「YR 已建立，但正式退貨申請紀錄尚未寫入」

原因：
RPC 已經回傳有效 YR，但 App 隨即再次讀 yijia_app_return_requests，
若該筆 JSON 狀態尚未立刻可讀，前端就把整筆判定成失敗。
這會造成很危險的假失敗：實際 YR 已建立，使用者卻可能再次送出。

本版修正：
- RPC 回傳有效 YR 後，最多等待約 3 秒重新確認退貨申請紀錄
- 可用 returnCode / requestId / memberProductId 三種方式比對
- 若 3 秒內仍未讀到，但後端已回傳有效 YR：
  - 不再把整筆判定為失敗
  - 直接顯示 YR 條碼
  - 顯示「申請紀錄正在同步」
  - 避免使用者重複送出退貨
- 不修改退貨資格規則
- 不修改 7 天退貨規則
- 不修改原付款門市限制

此版不用跑 SQL。

PWA 檔案需一起上傳：
- index.html
- manifest.webmanifest
- service-worker.js
- icons/
