const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
// 👇 1. 新增這一行：引入 Yahoo Finance 套件
const yahooFinance = require('yahoo-finance2').default; 

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB 連接 (請確保這裡是你自己的連接字串)
mongoose.connect('mongodb+srv://admin:admin112233@cluster0.mongodb.net/stock_app?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => console.log('✅ MongoDB 連接成功'))
    .catch(err => console.error('❌ MongoDB 連接失敗:', err));

// 定義資料結構
const stockSchema = new mongoose.Schema({
    client: String,
    name: String,
    code: String,
    shares: Number,
    price: Number,
    stopLoss: Number,
    date: { type: Date, default: Date.now }
});
const Stock = mongoose.model('Stock', stockSchema);

// 定義刷新數據的函數
async function realRefresh() {
    try {
        // 👇 關鍵修改：這裡加上了 /api
        const response = await fetch('https://taigu003.onrender.com/api/stocks'); 
        
        if (!response.ok) {
            throw new Error(`伺服器回應錯誤: ${response.status}`);
        }

        const data = await response.json();
        
        // 如果後端回傳空數據
        if (!data || data.length === 0) {
            console.log("目前沒有持倉數據");
            return;
        }

        // 這裡放你原本渲染畫面的邏輯...
        // 例如：renderStockList(data); 
        // 因為我看不到你完整的渲染代碼，所以請確保這裡接上你原本的顯示邏輯
        console.log("數據刷新成功", data);
        
        // 假設你有一個渲染函數叫做 renderTable 或 updateUI
        if (typeof renderTable === 'function') {
            renderTable(data);
        } else {
            // 如果沒有封裝函數，這裡可能需要重寫你的 DOM 更新邏輯
            // 但通常只要解決 fetch 的網址，下面的代碼就能跑了
            location.reload(); // 最簡單的暴力解法：抓到數據後刷新頁面 (可選)
        }

    } catch (error) {
        console.error("刷新失敗:", error);
        // alert("無法連接後端，請檢查 Render 是否喚醒");
    }
}


// API: 同步數據 (寫入資料庫)
app.post('/api/sync_data', async (req, res) => {
    try {
        const { clientName, holdings } = req.body;
        console.log(`📥 收到同步請求: ${clientName}`);
        
        if (!holdings || !Array.isArray(holdings)) {
            return res.json({ success: true, message: "無數據" });
        }

        await Stock.deleteMany({ client: clientName });

        // 在寫入前，先嘗試抓一次最新價格
        const newStocks = await Promise.all(holdings.map(async (item) => {
            const livePrice = await getRealStockPrice(item.code);
            return {
                client: clientName,
                name: item.name,
                code: item.code,
                shares: Number(item.shares),
                price: livePrice || Number(item.price), // 優先用即時股價
                stopLoss: Number(item.stopLoss),
                date: new Date()
            };
        }));

        if (newStocks.length > 0) {
            await Stock.insertMany(newStocks);
        }

        res.json({ success: true, message: "同步成功" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// API: 管理員登錄
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === '123456') {
        res.json({ success: true, token: 'admin-secret-token' });
    } else {
        res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
    }
});

// API: 刪除
app.delete('/api/stocks/:id', async (req, res) => {
    try {
        await Stock.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
