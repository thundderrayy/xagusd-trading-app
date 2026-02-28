const express = require('express');
const cors = require('cors');
const axios = require('axios');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Load environment variables
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// CONFIGURATION - ONLY LIVE DATA
// ==========================================
const CONFIG = {
    TWELVE_DATA_KEY: process.env.TWELVE_DATA_API_KEY || 'b1293a711f704075b88e08ca871f235f',
    SYMBOL: 'XAG/USD',
    CACHE_DURATION: 30000, // 30 seconds
    RATE_LIMIT: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // limit each IP to 100 requests per windowMs
    }
};

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(helmet({
    contentSecurityPolicy: false,
}));

app.use(compression());

app.use(cors({
    origin: '*',
    methods: ['GET'],
    allowedHeaders: ['Content-Type']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: CONFIG.RATE_LIMIT.windowMs,
    max: CONFIG.RATE_LIMIT.max,
    message: { error: 'Too many requests, please try again later.' }
});

app.use('/api/', limiter);

// Serve static files from current directory
app.use(express.static(__dirname));

// Simple in-memory cache
const cache = new Map();

function getCached(key) {
    const item = cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
        cache.delete(key);
        return null;
    }
    return item.data;
}

function setCached(key, data, ttl = CONFIG.CACHE_DURATION) {
    cache.set(key, {
        data,
        expiry: Date.now() + ttl
    });
}

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        symbol: CONFIG.SYMBOL,
        cacheSize: cache.size,
        uptime: process.uptime()
    });
});

// ==========================================
// LIVE PRICE ENDPOINT
// ==========================================
app.get('/api/price', async (req, res) => {
    try {
        const cacheKey = 'price';
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await axios.get(
            `https://api.twelvedata.com/price?symbol=${CONFIG.SYMBOL}&apikey=${CONFIG.TWELVE_DATA_KEY}`,
            { timeout: 5000 }
        );
        
        if (response.data && response.data.price) {
            const data = {
                price: parseFloat(response.data.price),
                symbol: CONFIG.SYMBOL,
                timestamp: new Date().toISOString(),
                source: 'TwelveData'
            };
            setCached(cacheKey, data);
            res.json(data);
        } else {
            throw new Error('Invalid response from TwelveData');
        }
    } catch (error) {
        console.error('Price fetch error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch live price',
            details: error.message
        });
    }
});

// ==========================================
// LIVE HISTORICAL DATA ENDPOINT
// ==========================================
app.get('/api/historical', async (req, res) => {
    try {
        const { interval = '30min', outputsize = 200 } = req.query;
        
        const validIntervals = ['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h', '1day'];
        if (!validIntervals.includes(interval)) {
            return res.status(400).json({ error: 'Invalid interval' });
        }

        const cacheKey = `historical_${interval}_${outputsize}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await axios.get(
            `https://api.twelvedata.com/time_series?symbol=${CONFIG.SYMBOL}&interval=${interval}&outputsize=${outputsize}&apikey=${CONFIG.TWELVE_DATA_KEY}`,
            { timeout: 10000 }
        );
        
        if (response.data && response.data.values) {
            const data = {
                symbol: CONFIG.SYMBOL,
                interval: interval,
                values: response.data.values,
                timestamp: new Date().toISOString(),
                source: 'TwelveData'
            };
            setCached(cacheKey, data, 60000); // Cache for 1 minute
            res.json(data);
        } else {
            throw new Error('No historical data available');
        }
    } catch (error) {
        console.error('Historical data error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch historical data',
            details: error.message
        });
    }
});

// ==========================================
// LIVE QUOTE ENDPOINT
// ==========================================
app.get('/api/quote', async (req, res) => {
    try {
        const cacheKey = 'quote';
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await axios.get(
            `https://api.twelvedata.com/quote?symbol=${CONFIG.SYMBOL}&apikey=${CONFIG.TWELVE_DATA_KEY}`,
            { timeout: 5000 }
        );
        
        if (response.data) {
            const data = {
                ...response.data,
                timestamp: new Date().toISOString(),
                source: 'TwelveData'
            };
            setCached(cacheKey, data);
            res.json(data);
        } else {
            throw new Error('Invalid quote data');
        }
    } catch (error) {
        console.error('Quote error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch quote',
            details: error.message
        });
    }
});

// ==========================================
// LIVE TECHNICAL INDICATORS
// ==========================================
app.get('/api/indicators/:indicator', async (req, res) => {
    try {
        const { indicator } = req.params;
        const { interval = '1h', time_period = 14, series_type = 'close' } = req.query;
        
        const validIndicators = ['RSI', 'MACD', 'EMA', 'SMA', 'BBANDS', 'STOCH', 'ADX'];
        if (!validIndicators.includes(indicator.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid indicator' });
        }

        const cacheKey = `indicator_${indicator}_${interval}_${time_period}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const response = await axios.get(
            `https://api.twelvedata.com/${indicator}?symbol=${CONFIG.SYMBOL}&interval=${interval}&time_period=${time_period}&series_type=${series_type}&apikey=${CONFIG.TWELVE_DATA_KEY}`,
            { timeout: 5000 }
        );
        
        if (response.data) {
            const data = {
                ...response.data,
                timestamp: new Date().toISOString(),
                source: 'TwelveData'
            };
            setCached(cacheKey, data, 60000);
            res.json(data);
        } else {
            throw new Error('Invalid indicator data');
        }
    } catch (error) {
        console.error('Indicator error:', error.message);
        res.status(500).json({
            error: 'Failed to fetch indicator',
            details: error.message
        });
    }
});

// ==========================================
// MARKET STATUS
// ==========================================
app.get('/api/market/status', (req, res) => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    const sessions = {
        asia: {
            active: utcHour >= 0 && utcHour < 9,
            nextOpen: utcHour < 0 ? '00:00 UTC' : utcHour >= 9 ? 'tomorrow 00:00 UTC' : 'now'
        },
        london: {
            active: utcHour >= 8 && utcHour < 17,
            nextOpen: utcHour < 8 ? '08:00 UTC' : utcHour >= 17 ? 'tomorrow 08:00 UTC' : 'now'
        },
        newyork: {
            active: utcHour >= 13 && utcHour < 22,
            nextOpen: utcHour < 13 ? '13:00 UTC' : utcHour >= 22 ? 'tomorrow 13:00 UTC' : 'now'
        }
    };
    
    let currentSession = 'Closed';
    if (sessions.london.active) currentSession = 'London';
    else if (sessions.newyork.active) currentSession = 'New York';
    else if (sessions.asia.active) currentSession = 'Asia';
    
    res.json({
        currentSession,
        utcTime: now.toISOString(),
        sessions,
        isMarketOpen: currentSession !== 'Closed',
        timestamp: now.getTime()
    });
});

// ==========================================
// SERVE INDEX.HTML FOR ALL OTHER ROUTES
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ==========================================
// ERROR HANDLING
// ==========================================
app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({
        error: 'API endpoint not found',
        path: req.path
    });
});

// ==========================================
// START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log('=================================');
    console.log('🚀 XAGUSD Live Data Server');
    console.log('=================================');
    console.log(`📡 Port: ${PORT}`);
    console.log(`📊 Symbol: ${CONFIG.SYMBOL}`);
    console.log(`🔑 API Key: ${CONFIG.TWELVE_DATA_KEY.substring(0, 8)}...`);
    console.log('=================================');
    console.log('📡 Endpoints:');
    console.log(`   🌐 Web App: http://localhost:${PORT}`);
    console.log(`   💰 Price: http://localhost:${PORT}/api/price`);
    console.log(`   📈 Historical: http://localhost:${PORT}/api/historical?interval=30min`);
    console.log(`   📊 Quote: http://localhost:${PORT}/api/quote`);
    console.log(`   📉 Indicators: http://localhost:${PORT}/api/indicators/RSI`);
    console.log(`   🌍 Market Status: http://localhost:${PORT}/api/market/status`);
    console.log('=================================');
    console.log('✅ All data is LIVE from TwelveData');
    console.log('❌ No mock/simulated/demo data');
    console.log('=================================');
});
