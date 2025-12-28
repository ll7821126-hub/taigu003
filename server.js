// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const yahooFinance = require('yahoo-finance2').default;
const path = require('path');
const fetch = require('node-fetch'); // TWSE / TPEx 用

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

// ---------------------- Admin 登入 ----------------------
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  const FIXED_USER = 'admin';
  const FIXED_PASS = 'Qq112233.';

  if (username === FIXED_USER && password === FIXED_PASS) {
    const token = 'admin-fixed-token';
    return res.json({ success: true, token, message: '登入成功' });
  } else {
    return res.json({ success: false, message: '帳號或密碼錯誤' });
  }
});

// ======================================================
// 工具：代碼正規化（去空白、全形→半形）
// ======================================================
function toHalfWidth(str) {
  return str.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  );
}
function normalizeCode(code) {
  if (!code) return '';
  return toHalfWidth(String(code).trim());
}

// ======================================================
// 0. 共用：向 Yahoo 抓「單檔」價格（多欄位 fallback）
// ======================================================
async function getRealStockPriceFromYahoo(singleCode) {
  if (!yahooFinance) return null;
  if (!singleCode) return null;

  try {
    let symbol = normalizeCode(singleCode);

    // 純數字則視為台股，補 .TW
    if (/^\d+$/.test(symbol)) {
      symbol = symbol + '.TW';
    }

    console.log(`🔍 向 Yahoo 查詢: [${symbol}]`);

    // validateResult:false 可避免因為缺欄位就 throw
    const quote = await yahooFinance.quote(symbol, { validateResult: false });

    if (!quote || typeof quote !== 'object') {
      console.log(`⚠️ Yahoo 回傳格式異常: [${symbol}]`, quote);
      return null;
    }

    // ✅ 核心：多欄位依序 fallback
    const price =
      quote.regularMarketPrice ??
      quote.postMarketPrice ??
      quote.preMarketPrice ??
      quote.previousClose ??
      quote.close;

    if (price != null && !Number.isNaN(price)) {
      const num = Number(price);
      console.log(
        `✅ Yahoo 價格 [${symbol}]: ${num} (幣種: ${quote.currency})`
      );
      return num;
    }

    console.log('⚠️ Yahoo 有回應但無價格:', `[${symbol}]`, {
      regularMarketPrice: quote.regularMarketPrice,
      postMarketPrice: quote.postMarketPrice,
      preMarketPrice: quote.preMarketPrice,
      previousClose: quote.previousClose,
      close: quote.close
    });
    return null;
  } catch (error) {
    console.log(`❌ Yahoo 抓取報錯 [${singleCode}]:`, error.message || error);
    return null;
  }
}

// ======================================================
// 0.1 多檔：優先用 Yahoo，再用 TWSE / TPEx 補昨收
// ======================================================

// TWSE：上市（含 ETF、多數權證）昨收價
async function fetchTwseClosingPriceMap(codes) {
  const map = {};
  if (!codes.length) return map;

  const url = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL';
  try {
    const res = await fetch(url);
    const arr = await res.json(); // [{Code, ClosingPrice, ...}, ...]
    const set = new Set(codes);

    arr.forEach((row) => {
      const c = normalizeCode(row.Code);
      if (!set.has(c)) return;
      const p = Number(row.ClosingPrice);
      if (!Number.isNaN(p)) map[c] = p;
    });
  } catch (err) {
    console.error('❌ 抓 TWSE 價格失敗:', err.message || err);
  }

  return map;
}

// TPEx：上櫃 / 興櫃 昨收價
async function fetchTpexClosingPriceMap(codes) {
  const map = {};
  if (!codes.length) return map;

  // ✅ 修正：必須是 /web/openapi/...
  const url = 'https://www.tpex.org.tw/web/openapi/v1/tpex_main_board_quotes';

  try {
    const res = await fetch(url);
    const arr = await res.json();
    const set = new Set(codes);

    arr.forEach((row) => {
      const c = normalizeCode(
        row.Code || row.SecuritiesCode || row['股票代號']
      );
      if (!set.has(c)) return;
      const p = Number(row.ClosePrice || row.ClosingPrice || row['收盤價']);
      if (!Number.isNaN(p)) map[c] = p;
    });
  } catch (err) {
    console.error('❌ 抓 TPEx 價格失敗:', err.message || err);
  }

  return map;
}

// 主整合：先 Yahoo，再 TWSE / TPEx
async function getTaiwanPriceMap(codes) {
  const normCodes = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  if (!normCodes.length) return {};

  const result = {};

  // 1) 優先用 Yahoo (即時價 / 昨收) —— 逐檔查
  for (const code of normCodes) {
    const p = await getRealStockPriceFromYahoo(code);
    if (typeof p === 'number') {
      result[code] = p;
    }
  }

  // 2) 找出尚未取得價格的代碼
  const missing = normCodes.filter((c) => typeof result[c] !== 'number');
  if (!missing.length) return result;

  console.log('⛏ 需用 TWSE / TPEx 補價的代碼:', missing);

  // 3) TWSE + TPEx 補昨收
  const [twseMap, tpexMap] = await Promise.all([
    fetchTwseClosingPriceMap(missing),
    fetchTpexClosingPriceMap(missing)
  ]);

  missing.forEach((c) => {
    if (typeof twseMap[c] === 'number') result[c] = twseMap[c];
    else if (typeof tpexMap[c] === 'number') result[c] = tpexMap[c];
    // 兩邊都沒有就放著，前端會顯示無價格
  });

  return result;
}

// ======================================================
// 0.5 取得多檔股票價格  POST /api/prices
// ======================================================
app.post('/api/prices', async (req, res) => {
  try {
    const rawCodes = Array.isArray(req.body?.codes) ? req.body.codes : [];
    const codes = rawCodes.map(normalizeCode).filter(Boolean);

    if (!codes.length) {
      return res.json({});
    }

    console.log('📥 /api/prices 收到 codes:', codes);

    const priceMap = await getTaiwanPriceMap(codes);

    const missing = codes.filter((c) => typeof priceMap[c] !== 'number');
    if (missing.length) {
      console.warn('⚠️ 目前抓不到價格的代碼:', missing);
    }

    console.log('📤 /api/prices 回傳 keys:', Object.keys(priceMap));
    return res.json(priceMap);
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
      clientProfile
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
      clientProfile
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
      clientProfile
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
      clientProfile
    };

    Object.keys(updateFields).forEach((k) => {
      if (updateFields[k] === undefined) delete updateFields[k];
    });

    const updated = await Holding.findOneAndUpdate(
      { userId, client, code },
      { $set: updateFields },
      { new: true }
    );

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
// 2.7 更新客戶檔案 POST /api/update_client_profile
// ======================================================
app.post('/api/update_client_profile', async (req, res) => {
  try {
    const { userId, client, clientProfile } = req.body || {};

    if (!userId || !client || !clientProfile) {
      return res.status(400).json({
        success: false,
        message: 'userId、client、clientProfile 為必填'
      });
    }

    const result = await Holding.updateMany(
      { userId, client },
      { $set: { clientProfile } }
    );

    return res.json({
      success: true,
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('❌ /api/update_client_profile 錯誤:', err);
    return res.status(500).json({
      success: false,
      message: '更新客戶檔案失敗'
    });
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
