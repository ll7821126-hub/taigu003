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

  // ⭐ 客戶檔案（和前端 profile 欄位對應）
  clientProfile: {
    gender: String,
    age: String,
    experience: String,
    style: String,
    hobbies: String,
    family: String,
    note: String
  },

  createdAt: { type: Date, default: Date.now }
});

const Holding = mongoose.model('Holding', holdingSchema);

// ======================================================
// 0. Admin 登入（寫死帳號密碼） POST /api/admin/login
// ======================================================
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};

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
// 0.5 取得多檔股票即時價格  POST /api/prices
// ======================================================
app.post('/api/prices', async (req, res) => {
  try {
    const { codes } = req.body || {};
    if (!Array.isArray(codes) || codes.length === 0) {
      return res.json({});
    }

    const result = {};

    for (const raw of codes) {
      if (!raw) continue;
      const code = String(raw);
      const price = await getRealStockPrice(code);
      result[code] = price; // 可能是 number 或 null
    }

    return res.json(result);
  } catch (err) {
    console.error('❌ /api/prices 錯誤:', err);
    return res.status(500).json({});
  }
});

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
      recommendType,
      clientProfile          // ⭐ 新增／接收客戶檔案
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
      recommendType,
      clientProfile          // ⭐ 寫進 MongoDB
    });

    await holding.save();

    return res.json({ success: true, message: '儲存成功' });
  } catch (err) {
    console.error('❌ /api/save_data 錯誤:', err);
    return res.status(500).json({ success: false, message: '儲存失敗' });
  }
});

// ======================================================
// 2.5 更新 / 合併持倉 POST /api/update_position
// ======================================================
app.post('/api/update_position', async (req, res) => {
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
      recommendType,
      clientProfile          // ⭐ 同樣接收
    } = req.body || {};

    if (!userId || !client || !code) {
      return res
        .status(400)
        .json({ success: false, message: 'userId、client、code 為必填' });
    }

    const updateFields = {
      stockName,
      quantity,
      cost,
      stopLoss,
      takeProfit,
      recommendType,
      clientProfile          // ⭐ 更新時也一併寫入
    };

    // 移除 undefined 欄位，避免覆蓋成 undefined
    Object.keys(updateFields).forEach((k) => {
      if (updateFields[k] === undefined) delete updateFields[k];
    });

    // 先嘗試更新既有持倉
    const updated = await Holding.findOneAndUpdate(
      { userId, client, code },
      { $set: updateFields },
      { new: true }
    );

    // 如果找不到就新增一筆
    if (!updated) {
      const holding = new Holding({
        userId,
        client,
        stockName,
        code,
        quantity,
        cost,
        stopLoss,
        takeProfit,
        recommendType,
        clientProfile
      });
      await holding.save();
    }

    return res.json({ success: true, message: '更新成功' });
  } catch (err) {
    console.error('❌ /api/update_position 錯誤:', err);
    return res.status(500).json({ success: false, message: '更新失敗' });
  }
});

// ======================================================
// 2.6 刪除持倉 POST /api/delete_position
// ======================================================
app.post('/api/delete_position', async (req, res) => {
  try {
    const { userId, client, code } = req.body || {};
    if (!userId || !client || !code) {
      return res
        .status(400)
        .json({ success: false, message: 'userId、client、code 為必填' });
    }

    await Holding.deleteOne({ userId, client, code });
    return res.json({ success: true, message: '刪除成功' });
  } catch (err) {
    console.error('❌ /api/delete_position 錯誤:', err);
    return res.status(500).json({ success: false, message: '刪除失敗' });
  }
});

// ======================================================
// 健康檢查
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
