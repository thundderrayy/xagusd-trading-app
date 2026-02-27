require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');
const cron = require('node-cron');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { scrapeForexFactory } = require('./scrapers/forexFactory');
const { MT5Bridge } = require('./mt5/bridge');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

app.use(express.json());

// TwelveData API Key (from environment variable)
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'b1293a711f704075b88e08ca871f235f';

// MT5 Bridge Instance
let mt5Bridge = null;

// Cache for market data
const cache = {
  price: null,
  news: [],
  lastUpdate: null
};

// ==========================================
// TWELVEDATA PROXY ROUTES
// ==========================================

// Real-time price endpoint
app.get('/api/price', async (req, res) => {
  try {
    const { symbol = 'XAG/USD' } = req.query;
    const response = await axios.get(
      `https://api.twelvedata.com/price?symbol=${symbol}&apikey=${TWELVE_DATA_KEY}`,
      { timeout: 5000 }
    );
    
    cache.price = {
      ...response.data,
      timestamp: Date.now()
    };
    
    res.json(response.data);
  } catch (error) {
    console.error('Price fetch error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch price',
      cached: cache.price 
    });
  }
});

// Historical data endpoint
app.get('/api/historical', async (req, res) => {
  try {
    const { 
      symbol = 'XAG/USD', 
      interval = '30min',
      outputsize = 200 
    } = req.query;
    
    const response = await axios.get(
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_DATA_KEY}`,
      { timeout: 10000 }
    );
    
    res.json(response.data);
  } catch (error) {
    console.error('Historical data error:', error.message);
    res.status(500).json({ error: 'Failed to fetch historical data' });
  }
});

// Quote endpoint (detailed)
app.get('/api/quote', async (req, res) => {
  try {
    const { symbol = 'XAG/USD' } = req.query;
    const response = await axios.get(
      `https://api.twelvedata.com/quote?symbol=${symbol}&apikey=${TWELVE_DATA_KEY}`,
      { timeout: 5000 }
    );
    
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// ==========================================
// FOREX FACTORY NEWS SCRAPER
// ==========================================

app.get('/api/news', async (req, res) => {
  try {
    // Return cached news if fresh (< 5 minutes)
    if (cache.news.length > 0 && Date.now() - cache.lastUpdate < 300000) {
      return res.json({ 
        data: cache.news,
        cached: true,
        lastUpdate: cache.lastUpdate 
      });
    }
    
    const news = await scrapeForexFactory();
    cache.news = news;
    cache.lastUpdate = Date.now();
    
    res.json({ 
      data: news,
      cached: false 
    });
  } catch (error) {
    console.error('News scrape error:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch news',
      data: cache.news // Return stale cache if available
    });
  }
});

// High impact news filter
app.get('/api/news/high-impact', async (req, res) => {
  try {
    const news = await scrapeForexFactory();
    const highImpact = news.filter(n => 
      n.impact === 'High' && 
      (n.currency === 'USD' || n.currency === 'ALL')
    );
    
    res.json({ data: highImpact });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch high impact news' });
  }
});

// ==========================================
// MT5 BRIDGE ROUTES
// ==========================================

app.post('/mt5/connect', async (req, res) => {
  try {
    const { account, password, server } = req.body;
    
    if (!mt5Bridge) {
      mt5Bridge = new MT5Bridge();
    }
    
    const result = await mt5Bridge.connect(account, password, server);
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('MT5 Connect error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/mt5/disconnect', async (req, res) => {
  try {
    if (mt5Bridge) {
      await mt5Bridge.disconnect();
      mt5Bridge = null;
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/mt5/status', (req, res) => {
  res.json({
    connected: mt5Bridge ? mt5Bridge.isConnected() : false,
    account: mt5Bridge ? mt5Bridge.getAccountInfo() : null
  });
});

// Execute trade
app.post('/trade/execute', async (req, res) => {
  try {
    if (!mt5Bridge || !mt5Bridge.isConnected()) {
      return res.status(400).json({ 
        success: false, 
        error: 'MT5 not connected' 
      });
    }
    
    const { symbol, type, entry, sl, tp, lots } = req.body;
    
    const result = await mt5Bridge.executeTrade({
      symbol: symbol || 'XAGUSD',
      type: type.toUpperCase(), // BUY or SELL
      volume: parseFloat(lots),
      price: entry,
      sl: sl,
      tp: tp,
      comment: 'XAGUSD Pro Bot'
    });
    
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Trade execution error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get open positions
app.get('/trade/positions', async (req, res) => {
  try {
    if (!mt5Bridge) {
      return res.json({ positions: [] });
    }
    
    const positions = await mt5Bridge.getPositions();
    res.json({ positions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// WEBSOCKET SERVER FOR REAL-TIME DATA
// ==========================================

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  
  // Send initial data
  if (cache.price) {
    ws.json(cache.price);
  }
  
  // Subscribe to price updates
  const priceInterval = setInterval(async () => {
    try {
      const response = await axios.get(
        `https://api.twelvedata.com/price?symbol=XAG/USD&apikey=${TWELVE_DATA_KEY}`,
        { timeout: 3000 }
      );
      
      if (response.data.price) {
        ws.send(JSON.stringify({
          type: 'price',
          data: response.data,
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('WS price fetch error:', error.message);
    }
  }, 5000); // Every 5 seconds
  
  ws.on('close', () => {
    clearInterval(priceInterval);
    console.log('Client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// ==========================================
// BACKGROUND JOBS
// ==========================================

// Scrape news every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  try {
    console.log('Scraping Forex Factory news...');
    const news = await scrapeForexFactory();
    cache.news = news;
    cache.lastUpdate = Date.now();
    console.log(`Cached ${news.length} news items`);
  } catch (error) {
    console.error('Scheduled news scrape failed:', error);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mt5Connected: mt5Bridge ? mt5Bridge.isConnected() : false,
    cacheAge: cache.lastUpdate ? Date.now() - cache.lastUpdate : null
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`🚀 XAGUSD Pro Server running on port ${PORT}`);
  console.log(`📊 TwelveData API: ${TWELVE_DATA_KEY ? 'Connected' : 'Missing Key'}`);
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
