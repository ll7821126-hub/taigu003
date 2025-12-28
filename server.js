const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fetch = require('node-fetch');

// Yahoo Finance 实例
const { YahooFinance } = require('yahoo-finance2');
const yahooFinance = new YahooFinance();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------- Middleware ----------------------
app.use(cors());
app.use(bodyParser.json());

// ---------------------- 静态档案 ------------------------
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------- MongoDB 连线 --------------------
mongoose
  .connect(
    'mongodb+srv://admin:admin112233@cluster0.is84pny.mongodb.net/stock_app?retryWrites=true&w=majority&appName=Cluster0'
  )
  .then(() => console.log('✅ MongoDB 连接成功'))
  .catch((err) => console.error('❌ MongoDB 连接失败:', err));

// ---------------------- 资料 Schema ---------------------
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

// ---------------------- 价格缓存机制 --------------------
const priceCache = new Map();
const CACHE_DURATION = 10000; // 10秒缓存

// ---------------------- Admin 登录 ----------------------
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body || {};
  const FIXED_USER = 'admin';
  const FIXED_PASS = 'Qq112233.';

  if (username === FIXED_USER && password === FIXED_PASS) {
    const token = 'admin-fixed-token';
    return res.json({ success: true, token, message: '登录成功' });
  } else {
    return res.json({ success: false, message: '帐号或密码错误' });
  }
});

// ======================================================
// 工具：代码正规化（去空白、全形→半形）
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
// TWSE 实时价格获取（上市股票）
// ======================================================
async function getTwseRealTimePrice(code) {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=tse_${code}.tw`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.msgArray && data.msgArray.length > 0) {
      const stock = data.msgArray[0];
      // 优先使用实时价格，如果没有则使用收盘价
      const price = stock.z ? parseFloat(stock.z) : 
                   stock.y ? parseFloat(stock.y) : null;
      return price;
    }
    return null;
  } catch (error) {
    console.log(`❌ TWSE实时价格获取失败 [${code}]:`, error.message);
    return null;
  }
}

// ======================================================
// TPEx 实时价格获取（上柜/兴柜股票）
// ======================================================
async function getTpexRealTimePrice(code) {
  try {
    const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?json=1&delay=0&ex_ch=otc_${code}.tw`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.msgArray && data.msgArray.length > 0) {
      const stock = data.msgArray[0];
      const price = stock.z ? parseFloat(stock.z) : 
                   stock.y ? parseFloat(stock.y) : null;
      return price;
    }
    return null;
  } catch (error) {
    console.log(`❌ TPEx实时价格获取失败 [${code}]:`, error.message);
    return null;
  }
}

// ======================================================
// Yahoo Finance 作为备用数据源
// ======================================================
async function getRealStockPriceFromYahoo(singleCode) {
  if (!singleCode) return null;

  try {
    let symbol = normalizeCode(singleCode);

    // 纯数字则视为台股，补 .TW
    if (/^\d+$/.test(symbol)) {
      symbol = symbol + '.TW';
    }

    const quote = await yahooFinance.quote(symbol, { validateResult: false }).catch(() => null);

    if (!quote || typeof quote !== 'object') {
      return null;
    }

    // 多字段依次 fallback
    const price =
      quote.regularMarketPrice ??
      quote.postMarketPrice ??
      quote.preMarketPrice ??
      quote.previousClose ??
      quote.close;

    if (price != null && !Number.isNaN(price)) {
      return Number(price);
    }

    return null;
  } catch (error) {
    console.log(`❌ Yahoo 抓取报错 [${singleCode}]:`, error.message);
    return null;
  }
}

// ======================================================
// 主要价格获取函数（优先TWSE/TPEx，备用Yahoo）
// ======================================================
async function getRealStockPrice(singleCode) {
  if (!singleCode) return null;

  try {
    const symbol = normalizeCode(singleCode);
    
    // 检查缓存
    const cacheKey = symbol;
    if (priceCache.has(cacheKey)) {
      const cached = priceCache.get(cacheKey);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.price;
      }
    }

    let price = null;

    // 1. 优先使用TWSE（上市股票）
    if (/^\d{4}$/.test(symbol)) {
      price = await getTwseRealTimePrice(symbol);
    }
    
    // 2. 如果TWSE没有找到，尝试TPEx（上柜/兴柜）
    if (price === null) {
      price = await getTpexRealTimePrice(symbol);
    }

    // 3. 如果官方API都没有，才使用Yahoo作为备用
    if (price === null) {
      price = await getRealStockPriceFromYahoo(symbol);
    }

    // 更新缓存
    if (price !== null) {
      priceCache.set(cacheKey, { price, timestamp: Date.now() });
    }

    return price;
  } catch (error) {
    console.log(`❌ 获取价格报错 [${singleCode}]:`, error.message);
    return null;
  }
}

// ======================================================
// 重试机制的价格获取
// ======================================================
async function getRealStockPriceWithRetry(code, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const price = await getRealStockPrice(code);
      if (price !== null) return price;
    } catch (error) {
      if (i === retries - 1) {
        console.log(`❌ 重试 ${retries} 次后仍然失败 [${code}]:`, error.message);
        return null;
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  return null;
}

// ======================================================
// 取得多档股票价格
// ======================================================
async function getTaiwanPriceMap(codes) {
  const normCodes = [...new Set((codes || []).map(normalizeCode).filter(Boolean))];
  if (!normCodes.length) return {};

  const result = {};
  const batchSize = 10; // 分批处理，避免同时太多请求
  const batches = [];

  // 分批处理
  for (let i = 0; i < normCodes.length; i += batchSize) {
    batches.push(normCodes.slice(i, i + batchSize));
  }

  // 逐批处理
  for (const batch of batches) {
    const batchPromises = batch.map(async (code) => {
      const price = await getRealStockPriceWithRetry(code);
      return { code, price };
    });

    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(({ code, price }) => {
      if (typeof price === 'number') {
        result[code] = price;
      }
    });

    // 批次间延迟，避免被API限制
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('📊 价格获取完成:', Object.keys(result).length + '/' + normCodes.length);
  return result;
}

// ======================================================
// 0.5 取得多档股票价格  POST /api/prices
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
      console.warn('⚠️ 目前抓不到价格的代码:', missing);
    }

    console.log('📤 /api/prices 回传 keys:', Object.keys(priceMap));
    return res.json(priceMap);
  } catch (err) {
    console.error('❌ /api/prices 错误:', err);
    return res.status(500).json({});
  }
});

// ======================================================
// 1. 取得云端持仓 GET /api/get_data?userId=xxx
// ======================================================
app.get('/api/get_data', async (req, res) => {
  try {
    const { userId } = req.query;
    const query = userId ? { userId } : {};
    const holdings = await Holding.find(query).sort({ createdAt: -1 });
    return res.json(holdings);
  } catch (err) {
    console.error('❌ /api/get_data 错误:', err);
    return res.status(500).json({ error: '服务器错误' });
  }
});

// ======================================================
// 2. 储存持仓 POST /api/save_data
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

    return res.json({ success: true, message: '储存成功' });
  } catch (err) {
    console.error('❌ /api/save_data 错误:', err);
    return res.status(500).json({ success: false, message: '储存失败' });
  }
});

// ======================================================
// 2.5 更新 / 合并持仓 POST /api/update_position
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
        .json({ success: false, message: 'userId、client、code 为必填' });
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
    console.error('❌ /api/update_position 错误:', err);
    return res.status(500).json({ success: false, message: '更新失败' });
  }
});

// ======================================================
// 2.7 更新客户档案 POST /api/update_client_profile
// ======================================================
app.post('/api/update_client_profile', async (req, res) => {
  try {
    const { userId, client, clientProfile } = req.body || {};

    if (!userId || !client || !clientProfile) {
      return res.status(400).json({
        success: false,
        message: 'userId、client、clientProfile 为必填'
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
    console.error('❌ /api/update_client_profile 错误:', err);
    return res.status(500).json({
      success: false,
      message: '更新客户档案失败'
    });
  }
});

// ======================================================
// 2.6 删除持仓 POST /api/delete_position
// ======================================================
app.post('/api/delete_position', async (req, res) => {
  try {
    const { userId, client, code } = req.body || {};
    if (!userId || !client || !code) {
      return res
        .status(400)
        .json({ success: false, message: 'userId、client、code 为必填' });
    }

    await Holding.deleteOne({ userId, client, code });
    return res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('❌ /api/delete_position 错误:', err);
    return res.status(500).json({ success: false, message: '删除失败' });
  }
});

// ======================================================
// 健康检查
// ======================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cacheSize: priceCache.size });
});

// ======================================================
// 清除缓存端点（用于调试）
// ======================================================
app.post('/api/clear-cache', (req, res) => {
  priceCache.clear();
  res.json({ success: true, message: '缓存已清除' });
});

// ======================================================
// 启动服务器
// ======================================================
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log('✅ 使用 TWSE/TPEx 官方API + Yahoo Finance 备用方案');
});
