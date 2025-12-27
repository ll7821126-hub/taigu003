const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
app.use(cors());
app.use(express.json());

// 1. 連接 MongoDB 資料庫 (請替換為你的 MongoDB 連接字串)
// 如果在 Render 部署，通常使用環境變量 process.env.MONGO_URI
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://admin:admin112233@cluster0.is84pny.mongodb.net/?appName=Cluster0";

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// 2. 定義數據模型
const UserSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true }, // 瀏覽器唯一ID
  clientName: String, // 用戶填寫的客戶名稱
  holdings: Array,    // 持倉數據
  profiles: Object,   // 客戶檔案
  lastUpdated: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

// ================= API 路由 =================

// [POST] 用戶同步數據 (保存)
app.post('/api/sync_data', async (req, res) => {
  const { userId, clientName, holdings, profiles } = req.body;
  
  try {
    await User.findOneAndUpdate(
      { userId }, 
      { userId, clientName, holdings, profiles, lastUpdated: new Date() },
      { upsert: true, new: true }
    );
    res.json({ success: true, message: "同步成功" });
  } catch (error) {
    res.status(500).json({ error: "同步失敗" });
  }
});

// [GET] 管理員獲取所有數據 (簡單密碼保護)
app.get('/api/admin/all_data', async (req, res) => {
  const { pwd } = req.query;
  if (pwd !== 'admin888') { // ⚠️ 這裡設置你的管理員密碼
    return res.status(403).json({ error: "密碼錯誤" });
  }

  try {
    const allData = await User.find().sort({ lastUpdated: -1 });
    res.json(allData);
  } catch (error) {
    res.status(500).json({ error: "獲取數據失敗" });
  }
});

// [POST] 獲取即時股價 (爬蟲)
app.post('/api/prices', async (req, res) => {
  const { codes } = req.body;
  const prices = {};

  // 簡單並發爬取 Yahoo 股市
  const promises = codes.map(async (code) => {
    try {
      const url = `https://tw.stock.yahoo.com/quote/${code}`;
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);
      // 抓取股價的大字體 class (Yahoo 結構可能會變，需定期維護)
      const priceText = $('span[class*="Fz(32px)"]').first().text();
      if (priceText) {
        prices[code] = parseFloat(priceText.replace(/,/g, ''));
      }
    } catch (e) {
      console.error(`Error fetching ${code}`);
    }
  });

  await Promise.all(promises);
  res.json(prices);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
