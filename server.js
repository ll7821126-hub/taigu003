// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const yahooFinance = require('yahoo-finance2').default;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------- Middleware ----------------------
app.use(cors());
app.use(bodyParser.json());

// ---------------------- 靜態檔案 ------------------------
// 讓 /public 裡面的檔案可以直接被訪問，例如 /admin.html
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------- MongoDB 連線 --------------------
mongoose
  .connect(
    'mongodb+srv://admin:admin112233@cluster0.is84pny.mongodb.net/stock_app?retryWrites=true&w=majority&appName=Cluster0'
  )
  .then(() => console.log('✅ MongoDB 連接成功'))
  .catch((err) => console.error('❌ MongoDB 連接失敗:', err));

// ---------------------- 資料 Schema ---------------------
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
// 0. Admin 登入（寫死帳號密碼） POST /api/admin/login
// ======================================================
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};

  // 固定帳號密碼（和 admin.html 保持一致）
  const FIXED_USER = 'admin';
  const FIXED_PASS = 'Qq112233.';

  if (username === FIXED_USER && password === FIXED_PASS) {
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

// ======================================================
// 共用：向 Yahoo 抓即時價格（若失敗則回傳 null）
// ======================================================
async function getRealStockPrice(code) {
  if (!yahooFinance) return null;
  if (!code) return null;

  try {
    let symbol = code.trim();

    // 如果是純數字，就當作台股，加上 .TW
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
    // 這裡會看到你 log 裡的 "Too Many Requests"
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

    const query = userId ? { userId } : {};
    const holdings = await Holding.find(query).sort({ createdAt: -1 });

    return res.json(holdings);
  } catch (err) {
    console.error('❌ /api/get_data 錯誤:', err);
    return res.status(500).json({ error: '伺服器錯誤' });
  }
});

// ======================================================
// 2. 儲存持倉 POST /api/save_data
// ======================================================
app.post('/api/save_data', async (req, res) => {
  try {
    const {
      userId,
      client,
      stockName,
      code,
      quantity,
      cost,
      stopLoss,
      takeProfit,
      recommendType
    } = req.body || {};

    const holding = new Holding({
      userId,
      client,
      stockName,
      code,
      quantity,
      cost,
      stopLoss,
      takeProfit,
      recommendType
    });

    await holding.save();

    return res.json({ success: true, message: '儲存成功' });
  } catch (err) {
    console.error('❌ /api/save_data 錯誤:', err);
    return res.status(500).json({ success: false, message: '儲存失敗' });
  }
});

// ======================================================
// 健康檢查 (方便測試 Render 是否活著)
// ======================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ======================================================
// 啟動伺服器
// ======================================================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
