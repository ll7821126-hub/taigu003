const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors'); 

const app = express();
app.use(cors()); 
app.use(express.json());

// ==========================================
// 1. 中間件設定 (Middleware)
// ==========================================
// ✅ 啟用跨域 (解決 Network Error 關鍵)
// ✅ 解析 JSON 數據
app.use(express.json()); 

// ==========================================
// 2. 資料庫連線 (MongoDB Connection)
// ==========================================
// ⚠️ 注意：請確保下面的連線字串是你完整的 MongoDB 地址
// 範例：注意 @ 後面的 cluster0.xxxxx 才是正確的
const MONGO_URI = "mongodb+srv://admin:admin112233@cluster0.is84pny.mongodb.net/stock-app?retryWrites=true&w=majority";


mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB 連線成功'))
    .catch(err => console.error('❌ MongoDB 連線失敗:', err));

// ==========================================
// 3. 定義資料模型 (Schema)
// ==========================================
// 這裡必須跟你的前端表單欄位一致
const StockSchema = new mongoose.Schema({
    client: String,    // 客戶姓名
    name: String,      // 股票名稱
    code: String,      // 股票代號
    shares: Number,    // 持有股數
    price: Number,     // 買入價格
    stopLoss: Number,  // 止損價
    date: { type: Date, default: Date.now } // 建立時間
});

const Stock = mongoose.model('Stock', StockSchema);

// ==========================================
// 4. API 路由 (Routes)
// ==========================================

// 測試路由：確認後端是否活著
app.get('/', (req, res) => {
    res.send('Backend is running correctly!');
});

// 🟢 [新增] 管理員登錄接口
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;

    // 👇 這裡設定你的後台帳號密碼
    // 目前設定為：帳號 admin / 密碼 123456
    if (username === 'admin' && password === '123456') {
        res.json({ success: true, token: 'admin-secret-token' });
    } else {
        res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }
});

// 🔵 獲取所有持倉 (Read) - 用於後台顯示列表
app.get('/api/stocks', async (req, res) => {
    try {
        const stocks = await Stock.find().sort({ date: -1 }); // 按時間倒序排列
        res.json(stocks);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 🟠 新增持倉 (Create) - 用於前端表單提交
app.post('/api/stocks', async (req, res) => {
    try {
        const newStock = new Stock(req.body);
        const savedStock = await newStock.save();
        res.status(201).json(savedStock);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// 🔴 刪除持倉 (Delete) - 用於後台刪除數據
app.delete('/api/stocks/:id', async (req, res) => {
    try {
        await Stock.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// ==========================================
// 5. 啟動伺服器
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server is running on port ${PORT}`);
});
