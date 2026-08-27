億家 App v0.10.14.2 Gift Claim Formal Flow

第三個主功能正式接通：
轉贈 / 社群轉贈 / YG領取

A. 直接手機轉贈
- 轉贈前先讀 app_get_gift_transfer_data()
- 確認來源商品仍存在
- 確認 remainingQuantity 足夠
- 呼叫 app_create_gift_transfer()
- 完成後再次讀正式轉贈資料
- 確認來源商品 remainingQuantity 已正式扣除
- 才顯示「直接轉贈完成」

B. 社群轉贈
- 呼叫 app_create_gift_transfer()
- 必須回傳 YG 開頭正式 giftCode
- 再從 app_get_gift_transfer_data() 找到相同 YG 正式紀錄
- 確認來源商品數量已正式扣除
- 才顯示 / 分享 YG 領取碼

C. 領取 YG
- 領取前先讀目前 app_get_member_products()
- 呼叫 app_claim_gift_transfer()
- 再讀 app_get_gift_transfer_data()
- 該 YG 必須正式標記為已領取 / 已完成
- 再讀 app_get_member_products()
- 確認商品已正式出現在領取人的「我的商品」
- 全部確認後才顯示領取成功

正式 RPC：
- app_get_gift_transfer_data
- app_create_gift_transfer
- app_claim_gift_transfer
- app_get_member_products

安全原則：
- App 不自己扣轉出人的商品數量
- App 不自己增加領取人的商品
- App 不建立假的轉贈紀錄
- App 只在正式後端結果完成後顯示成功

此版純前端，不用跑 SQL。
只需要上傳新的 index.html。
