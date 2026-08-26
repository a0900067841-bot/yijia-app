億家 App v0.10.9.3 Point Reward QR

新增：
1. 點數兌換成功後，不再只跳文字代碼。
2. App 直接開啟 PR 點數兌換券 QR Code。
3. 「我的點數兌換」可再次開啟尚未使用的兌換 QR。
4. TM 掃 PR 後可取得 rewardName / quantity / payload。
5. TM 實際交付成功後才標記 fulfillment_status=used。
6. App 約每 3 秒同步兌換券狀態，完成後顯示「點數兌換完成」。

重要：
- 不改 300 點折 1 元等既有點數規則。
- 不改 tm_sync_member_points()。
- app_point_reward_redemptions.status 仍維持 completed，
  避免影響既有每會員限量統計。
- 使用 fulfillment_status 另外管理「兌換券是否已使用」。

更新順序：
1. 執行 point_reward_ticket_backend.sql。
2. 上傳新的 index.html。
