// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const yahooFinance = require('yahoo-finance2').default;
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------- Middleware ----------------------
app.use(cors());
app.use(bodyParser.json());

// ---------------------- 靜態檔案 (admin.html) -----------
// 讓 /public 裡面的檔案可以直接被訪問，例如 /admin.html
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------- MongoDB 連線 --------------------
mongoose
  .connect(
    'mongodb+srv://admin:admin112233@cluster0.is84pny.mongodb.net/stock_app?retryWrites=true&w=majority&appName=Cluster0'
  )
  .then(() => console.log('✅ MongoDB 連接成功'))
  .catch((err) => console.error('❌ MongoDB 連接失敗:', err));

/**
 * 資料結構：對齊前端 holdings
 */
const holdingSchema = new mongoose.Schema({
  userId: String,
  client: String,
  stockName: String,
  code: String,
  quantity: Number,
  cost: Number,
  currentPrice: Number,
  stopLoss: Number,
  takeProfit: Number,
  recommendType: { type: String, default: 'no' },
  createdAt: { type: Date, default: Date.now }
});

const Holding = mongoose.model('Holding', holdingSchema);

// ======================================================
// 0. Admin 安全登入（使用環境變數 + 雜湊密碼）
//    POST /api/admin/login
// ======================================================
i// 管理員登入（寫死帳號密碼）
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};

  // 這裡填你要固定的帳號密碼
  const FIXED_USER = 'admin';        
  const FIXED_PASS = 'Qq112233.';       

  // 檢查帳號密碼
  if (username === FIXED_USER && password === FIXED_PASS) {
    // 給一個簡單 token
    const token = 'admin-fixed-token';

    return res.json({
      success: true,
      token,
      message: '登入成功'
    });
  } else {
    return res.json({
      success: false,
      message: '帳號或密碼錯誤'
    });
  }
});


    // 1. 比對帳號
    if (username !== ADMIN_USER) {
      return res.json({ success: false, message: '帳號或密碼錯誤' });
    }

    // 2. 比對密碼（明碼 vs 雜湊）
    const ok = await bcrypt.compare(password || '', ADMIN_PASS_HASH);
    if (!ok) {
      return res.json({ success: false, message: '帳號或密碼錯誤' });
    }

    // 3. 通過：發一個簡單 token
    const token = `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return res.json({
      success: true,
      token,
      message: '登入成功'
    });
  } catch (err) {
    console.error('❌ /api/admin/login 錯誤:', err);
    return res.status(500).json({ success: false, message: '登入失敗' });
  }
});

// ======================================================
// 共用：向 Yahoo 抓即時價格
// ======================================================
async function getRealStockPrice(code) {
  if (!yahooFinance) return null;
  if (!code) return null;

  try {
    let symbol = code.trim();

    if (/^\d+$/.test(symbol)) {
      symbol = symbol + '.TW';
    }

    console.log(`🔍 正在向 Yahoo 查詢: [${symbol}]`);

    const quote = await yahooFinance.quote(symbol, { validateResult: false });

    if (quote && typeof quote.regularMarketPrice === 'number') {
      console.log(
        `✅ Yahoo 回傳 [${symbol}]: ${quote.regularMarketPrice} (幣種: ${quote.currency})`
      );
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
// 1. 取得雲端持倉 GET /api/get_data?userId=xxx
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
// ======================================================
app.post('/api/prices', async (req, res) => {
  try {
    const { codes } = req.body;

    if (!Array.isArray(codes) || !codes.length) {
      return res.json({});
    }

    const prices = {};

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
// 3. 同步持倉 POST /api/sync_data
// ======================================================
app.post('/api/sync_data', async (req, res) => {
  try {
    const { userId, clientName, holdings } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: '缺少 userId' });
    }

    if (!Array.isArray(holdings)) {
      return res.json({ success: true, message: '無數據' });
    }

    await Holding.deleteMany({ userId });

    const docs = holdings.map((h) => ({
      userId,
      client: h.client,
      stockName: h.stockName,
      code: h.code,
      quantity: Number(h.quantity) || 0,
      cost: Number(h.cost) || 0,
      currentPrice:
        typeof h.currentPrice === 'number'
          ? h.currentPrice
          : Number(h.cost) || 0,
      stopLoss: Number(h.stopLoss) || 0,
      takeProfit: Number(h.takeProfit) || 0,
      recommendType: h.recommendType || 'no'
    }));

    if (docs.length > 0) {
      await Holding.insertMany(docs);
    }

    console.log(
      `☁️ 同步成功，userId=${userId}，client=${clientName}，筆數=${docs.length}`
    );
    res.json({ success: true, message: '同步成功' });
  } catch (err) {
    console.error('❌ /api/sync_data 錯誤:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ======================================================
// 4. 管理端：取得所有持倉 GET /api/stocks
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
// 5. 管理端：刪除單筆持倉 DELETE /api/stocks/:id
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
  console.log(`🚀 Server is running on port ${PORT}`);
});
