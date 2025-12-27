const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MongoDB 連接
mongoose.connect('mongodb+srv://admin:admin112233@cluster0.is84pny.mongodb.net/stock_app?retryWrites=true&w=majority&appName=Cluster0')
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

// 🕵️‍♂️ 偵探版：獲取股價函數 (帶詳細日誌)
async function getRealStockPrice(code) {
    if (!yahooFinance) return null;
    if (!code) return null;

    try {
        let symbol = code.trim();
        
        // 台灣股票邏輯：如果是純數字 (如 2330)，加上 .TW
        // ⚠️ 注意：如果你玩的是港股，可能需要改成 .HK
        if (/^\d+$/.test(symbol)) {
            symbol = symbol + '.TW';
        }

        console.log(`🔍 正在向 Yahoo 查詢: [${symbol}]`); // 讓我們看看它到底查了什麼代碼

        const quote = await yahooFinance.quote(symbol, { validateResult: false });
        
        if (quote && typeof quote.regularMarketPrice === 'number') {
            console.log(`✅ Yahoo 回傳 [${symbol}]: ${quote.regularMarketPrice} (幣種: ${quote.currency})`);
            return quote.regularMarketPrice;
        } else {
            console.log(`⚠️ Yahoo 有回應，但沒有價格數據: [${symbol}]`, quote);
            return null;
        }
    } catch (error) {
        console.log(`❌ 抓取報錯 [${code}]:`, error.message);
        return null;
    }
}
// ==========================================
// 👇 新增：專門應對前端 "刷新行情" 的 API
// ==========================================
app.post('/api/prices', async (req, res) => {
    try {
        // 1. 找出資料庫所有股票
        const stocks = await Stock.find();
        
        // 2. 重新抓取最新價格
        const updatedStocks = await Promise.all(stocks.map(async (stock) => {
            const currentPrice = await getRealStockPrice(stock.code);
            return {
                ...stock.toObject(),
                price: currentPrice !== null ? currentPrice : stock.price
            };
        }));

        // 3. 回傳給前端
        res.json(updatedStocks);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// API: 獲取所有持倉 (GET)
app.get('/api/stocks', async (req, res) => {
    try {
        const stocks = await Stock.find();
        const updatedStocks = await Promise.all(stocks.map(async (stock) => {
            const currentPrice = await getRealStockPrice(stock.code);
            return {
                ...stock.toObject(),
                price: currentPrice !== null ? currentPrice : stock.price
            };
        }));
        res.json(updatedStocks);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// API: 同步數據 (POST)
app.post('/api/sync_data', async (req, res) => {
    try {
        const { clientName, holdings } = req.body;
        
        if (!holdings || !Array.isArray(holdings)) {
            return res.json({ success: true, message: "無數據" });
        }

        await Stock.deleteMany({ client: clientName });

        const newStocks = await Promise.all(holdings.map(async (item) => {
            const livePrice = await getRealStockPrice(item.code);
            let finalPrice = livePrice;
            
            if (finalPrice === null) finalPrice = parseFloat(item.price);
            if (isNaN(finalPrice)) finalPrice = 0;

            return {
                client: clientName,
                name: item.name,
                code: item.code,
                shares: Number(item.shares) || 0,
                price: finalPrice,
                stopLoss: Number(item.stopLoss) || 0,
                date: new Date()
            };
        }));

        if (newStocks.length > 0) {
            await Stock.insertMany(newStocks);
        }

        res.json({ success: true, message: "同步成功" });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
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
