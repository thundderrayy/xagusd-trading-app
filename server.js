const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// TwelveData API Key
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'b1293a711f704075b88e08ca871f235f';

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', time: new Date().toISOString() });
});

app.get('/api/price', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVE_DATA_KEY}`,
            { timeout: 5000 }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch price' });
    }
});

app.get('/api/historical', async (req, res) => {
    try {
        const { interval = '30min' } = req.query;
        const response = await axios.get(
            `https://api.twelvedata.com/time_series?symbol=XAG/USD&interval=${interval}&outputsize=200&apikey=${TWELVE_DATA_KEY}`,
            { timeout: 10000 }
        );
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch historical data' });
    }
});

// Mock news endpoint (until we fix scraper)
app.get('/api/news', (req, res) => {
    res.json({
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
            }
        ]
    });
});

// MT5 mock endpoints
app.post('/mt5/connect', (req, res) => {
    res.json({ success: true, message: 'MT5 connection simulated' });
});

app.post('/trade/execute', (req, res) => {
    res.json({ success: true, message: 'Trade executed', ticket: Math.floor(Math.random() * 1000000) });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
