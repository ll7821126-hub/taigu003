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

/**
 * 後端資料結構，對齊前端 holdings
 * 前端欄位：
 *  id, userId, client, stockName, code,
 *  quantity, cost, currentPrice, stopLoss, takeProfit, recommendType
 */
const holdingSchema = new mongoose.Schema({
  userId: String,          // 對應前端 localStorage 的 userId
  client: String,
  stockName: String,
  code: String,
  quantity: Number,
  cost: Number,            // 成本價
  currentPrice: Number,    // 目前市價
  stopLoss: Number,
  takeProfit: Number,
  recommendType: { type: String, default: 'no' },
  createdAt: { type: Date, default: Date.now }
});

const Holding = mongoose.model('Holding', holdingSchema);

// ------------------------------------------------------
// 共用：抓 Yahoo 股價（保持你原本的寫法）
// ------------------------------------------------------
async function getRealStockPrice(code) {
  if (!yahooFinance) return null;
  if (!code) return null;

  try {
    let symbol = code.trim();

    // 台灣股票邏輯：純數字加 .TW
    if (/^\d+$/.test(symbol)) {
      symbol = symbol + '.TW';
    }

    console.log(`🔍 正在向 Yahoo 查詢: [${symbol}]`);

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

// ======================================================
// 1. 取得雲端持倉（給前端初始化用） GET /api/get_data
//    前端呼叫：/api/get_data?userId=xxx
// ======================================================
app.get('/api/get_data', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.json({ holdings: [] });
    }

    const holdings = await Holding.find({ userId }).lean();
    return res.json({ holdings });
  } catch (error) {
    console.error('❌ get_data 錯誤:', error);
    res.status(500).json({ holdings: [], error: 'get_data error' });
  }
});

// ======================================================
// 2. 刷新行情 POST /api/prices
//    前端傳：{ codes: ["2330","2317",...] }
//    回傳：{ "2330": 1510, "2317": 225.5, ... }
// ======================================================
app.post('/api/prices', async (req, res) => {
  try {
    const { codes } = req.body;
    if (!Array.isArray(codes) || !codes.length) {
      return res.json({});
    }

    const prices = {};

    // 逐檔查 Yahoo 價格
    for (const code of codes) {
      const latestPrice = await getRealStockPrice(code);
      if (typeof latestPrice === 'number') {
        prices[code] = latestPrice;
      }
    }

    console.log('📦 刷新成功，回傳價格物件:', prices);
    return res.json(prices);
  } catch (error) {
    console.error('❌ /api/prices 錯誤:', error);
    res.status(500).json({ message: '更新行情失敗' });
  }
});

// ======================================================
// 3. 同步數據（保存/更新持倉）POST /api/sync_data
//    前端傳：{ userId, clientName, holdings }
//    holdings 的結構就是前端 localStorage 裡那一份
// ======================================================
app.post('/api/sync_data', async (req, res) => {
  try {
    const { userId, clientName, holdings } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: '缺少 userId' });
    }

    if (!holdings || !Array.isArray(holdings)) {
      return res.json({ success: true, message: '無數據' });
    }

    // 這裡目前的設計是：以 userId 為主，清空後重建一份
    // 如果你想針對單一 clientName 清，就改成 { userId, client: clientName }
    await Holding.deleteMany({ userId });

    const docs = holdings.map(h => ({
      userId,
      client: h.client,
      stockName: h.stockName,
      code: h.code,
      quantity: Number(h.quantity) || 0,
      cost: Number(h.cost) || 0,
      currentPrice: typeof h.currentPrice === 'number'
        ? h.currentPrice
        : Number(h.cost) || 0,
      stopLoss: Number(h.stopLoss) || 0,
      takeProfit: Number(h.takeProfit) || 0,
      recommendType: h.recommendType || 'no'
    }));

    if (docs.length > 0) {
      await Holding.insertMany(docs);
    }

    console.log(`☁️ 同步成功，userId=${userId}，筆數=${docs.length}`);
    res.json({ success: true, message: '同步成功' });
  } catch (err) {
    console.error('❌ /api/sync_data 錯誤:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ======================================================
// 4. （可選）取得所有持倉（除錯用） GET /api/stocks
// ======================================================
app.get('/api/stocks', async (req, res) => {
  try {
    const list = await Holding.find().lean();
    res.json(list);
  } catch (err) {
    console.error('❌ /api/stocks 錯誤:', err);
    res.status(500).json({ message: err.message });
  }
});

// ======================================================
// 5. 刪除持倉（若需要） DELETE /api/stocks/:id
// ======================================================
app.delete('/api/stocks/:id', async (req, res) => {
  try {
    await Holding.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ 刪除錯誤:', err);
    res.status(500).json({ message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
