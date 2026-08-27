億家 App v0.10.13.9 Pay Barcode Scan Fix

這版處理實機測試發現的問題：
- QR Code 可掃描
- Code128 付款條碼無法被 TM 掃描

修正：
- Code128 module width 改成整數 1px
- 高度提高到 100px
- 左右 quiet zone 增加
- 加入 shape-rendering: crispEdges
- 不再讓 Safari 對 Code128 SVG 做 max-width 縮放
- 避免長條碼被縮成小數像素產生反鋸齒
- QR Code 邏輯完全不動
- 付款 token / RPC / 60 秒規則完全不動

原因：
原本 Code128 使用 width 1.5，而且 SVG 受 max-width:95% 縮放。
長付款碼在 iPhone Safari 上可能再次被比例縮小，造成條紋寬度落在小數像素，
肉眼看正常，但實體掃描器可能無法穩定辨識。

此版純前端。
不用跑 SQL，只上傳新的 index.html。
