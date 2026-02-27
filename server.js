const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// TwelveData API Key
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'b1293a711f704075b88e08ca871f235f';

// ==========================================
// ROUTES
// ==========================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        time: new Date().toISOString(),
        service: 'XAGUSD Pro Backend'
    });
});

// Real-time price
app.get('/api/price', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVE_DATA_KEY}`,
            { timeout: 5000 }
        );
        res.json(response.data);
    } catch (error) {
        console.error('Price fetch error:', error.message);
        res.status(500).json({ error: 'Failed to fetch price' });
    }
});

// Historical data
app.get('/api/historical', async (req, res) => {
    try {
        const { interval = '30min' } = req.query;
        const response = await axios.get(
            `https://api.twelvedata.com/time_series?symbol=XAG/USD&interval=${interval}&outputsize=200&apikey=${TWELVE_DATA_KEY}`,
            { timeout: 10000 }
        );
        res.json(response.data);
    } catch (error) {
        console.error('Historical data error:', error.message);
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// Mock news (working version - no scraper yet)
app.get('/api/news', (req, res) => {
    res.json({
        status: 'success',
        data: [
            {
                time: '15:30 GMT',
                title: 'US Non-Farm Payrolls',
                impact: 'High',
                currency: 'USD',
                forecast: '200K',
                previous: '180K'
            },
            {
                time: '17:00 GMT',
                title: 'ISM Manufacturing PMI',
                impact: 'High',
                currency: 'USD',
                forecast: '47.5',
                previous: '46.7'
            },
            {
                time: 'Tomorrow 14:00',
                title: 'FOMC Interest Rate Decision',
                impact: 'High',
                currency: 'USD',
                forecast: '5.50%',
                previous: '5.50%'
            }
        ],
        source: 'Mock Data (Forex Factory scraper disabled)'
    });
});

// MT5 mock endpoints
app.post('/mt5/connect', (req, res) => {
    const { account } = req.body;
    res.json({ 
        success: true, 
        message: 'MT5 connection simulated',
        account: account || 'unknown',
        timestamp: new Date().toISOString()
    });
});

app.post('/trade/execute', (req, res) => {
    const { symbol, type, entry, sl, tp, lots } = req.body;
    res.json({ 
        success: true, 
        message: 'Trade executed (simulated)',
        ticket: Math.floor(Math.random() * 1000000),
        details: { symbol, type, entry, sl, tp, lots },
        timestamp: new Date().toISOString()
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 XAGUSD Pro Server running on port ${PORT}`);
    console.log(`📊 TwelveData API: ${TWELVE_DATA_KEY ? 'Connected' : 'Missing Key'}`);
});
