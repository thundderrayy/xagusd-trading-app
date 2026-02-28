const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURATION
// ==========================================
const CONFIG = {
    API_KEY: process.env.TWELVE_DATA_API_KEY,
    SYMBOL: 'XAG/USD',
    CACHE_DURATION_PRICE: 30000,       // 30s
    CACHE_DURATION_HISTORICAL: 60000,  // 1m
    CACHE_DURATION_INDICATORS: 60000,  // 1m
    RATE_LIMIT: {
        windowMs: 15 * 60 * 1000,
        max: 100
    }
};

// Ensure API key exists
if (!CONFIG.API_KEY) {
    console.error("❌ TWELVE_DATA_API_KEY is missing in environment variables");
    process.exit(1);
}

// ==========================================
// AXIOS INSTANCE (Reusable)
// ==========================================
const twelveData = axios.create({
    baseURL: 'https://api.twelvedata.com',
    timeout: 8000,
    params: {
        apikey: CONFIG.API_KEY
    }
});

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*', methods: ['GET'] }));

app.use('/api/', rateLimit({
    windowMs: CONFIG.RATE_LIMIT.windowMs,
    max: CONFIG.RATE_LIMIT.max
}));

app.use(express.static(__dirname));

// ==========================================
// SIMPLE MEMORY CACHE
// ==========================================
const cache = new Map();

function getCache(key) {
    const item = cache.get(key);
    if (!item || Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    return item.data;
}

function setCache(key, data, ttl) {
    cache.set(key, {
        data,
        expiry: Date.now() + ttl
    });
}

// ==========================================
// SHARED FETCH FUNCTION
// ==========================================
async function fetchFromTwelve(endpoint, params = {}) {
    try {
        const response = await twelveData.get(endpoint, { params });

        if (response.data.status === "error") {
            throw new Error(response.data.message);
        }

        return response.data;
    } catch (error) {
        throw new Error(error.response?.data?.message || error.message);
    }
}

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        symbol: CONFIG.SYMBOL,
        uptime: process.uptime(),
        cacheSize: cache.size,
        timestamp: new Date().toISOString()
    });
});

// ==========================================
// PRICE
// ==========================================
app.get('/api/price', async (req, res) => {
    const cacheKey = 'price';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await fetchFromTwelve('/price', {
            symbol: CONFIG.SYMBOL
        });

        const result = {
            price: parseFloat(data.price),
            symbol: CONFIG.SYMBOL,
            timestamp: new Date().toISOString()
        };

        setCache(cacheKey, result, CONFIG.CACHE_DURATION_PRICE);
        res.json(result);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// HISTORICAL
// ==========================================
app.get('/api/historical', async (req, res) => {
    const { interval = '30min', outputsize = 200 } = req.query;
    const cacheKey = `historical_${interval}_${outputsize}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await fetchFromTwelve('/time_series', {
            symbol: CONFIG.SYMBOL,
            interval,
            outputsize
        });

        setCache(cacheKey, data, CONFIG.CACHE_DURATION_HISTORICAL);
        res.json(data);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// QUOTE
// ==========================================
app.get('/api/quote', async (req, res) => {
    const cacheKey = 'quote';
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await fetchFromTwelve('/quote', {
            symbol: CONFIG.SYMBOL
        });

        setCache(cacheKey, data, CONFIG.CACHE_DURATION_PRICE);
        res.json(data);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// INDICATORS
// ==========================================
app.get('/api/indicators/:indicator', async (req, res) => {
    const indicator = req.params.indicator.toUpperCase();
    const { interval = '1h', time_period = 14, series_type = 'close' } = req.query;

    const allowed = ['RSI','MACD','EMA','SMA','BBANDS','STOCH','ADX'];
    if (!allowed.includes(indicator)) {
        return res.status(400).json({ error: "Invalid indicator" });
    }

    const cacheKey = `ind_${indicator}_${interval}_${time_period}`;
    const cached = getCache(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await fetchFromTwelve(`/${indicator}`, {
            symbol: CONFIG.SYMBOL,
            interval,
            time_period,
            series_type
        });

        setCache(cacheKey, data, CONFIG.CACHE_DURATION_INDICATORS);
        res.json(data);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log("=================================");
    console.log("🚀 XAGUSD Live Server Running");
    console.log("=================================");
    console.log(`Port: ${PORT}`);
    console.log(`Symbol: ${CONFIG.SYMBOL}`);
    console.log("Environment: Production Ready");
    console.log("=================================");
});
