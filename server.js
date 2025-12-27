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

// 👇 2. 這是核心：獲取真實股價的函數
async function getRealStockPrice(code) {
    try {
        // 判斷是否為台股 (如果是純數字，例如 2330，就加上 .TW)
        let symbol = code;
        if (/^\d+$/.test(code)) {
            symbol = code + '.TW';
        }

        // 從 Yahoo Finance 抓取報價
        const quote = await yahooFinance.quote(symbol);
        
        if (quote && quote.regularMarketPrice) {
            return quote.regularMarketPrice; // 返回現價
        } else {
            return null; // 抓不到
        }
    } catch (error) {
        console.error(`無法獲取 ${code} 的股價:`, error.message);
        return null;
    }
}

// API: 獲取所有持倉 (並自動更新最新價格)
app.get('/api/stocks', async (req, res) => {
    try {
        const stocks = await Stock.find();
        
        // 這裡我們即時去抓最新價格，並更新回傳的數據 (不一定要存回資料庫，只顯示也可以)
        // 為了效能，我們用 Promise.all 平行抓取
        const updatedStocks = await Promise.all(stocks.map(async (stock) => {
            const currentPrice = await getRealStockPrice(stock.code);
            return {
                ...stock.toObject(),
                price: currentPrice || stock.price // 如果抓到了就用新價格，抓不到就用舊的
            };
        }));

        res.json(updatedStocks);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

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
