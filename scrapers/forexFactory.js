const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeForexFactory() {
  try {
    // Note: In production, use a proxy service to avoid IP bans
    const response = await axios.get('https://www.forexfactory.com/calendar.php', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });
    
    const $ = cheerio.load(response.data);
    const events = [];
    
    $('.calendar_row').each((i, elem) => {
      const $row = $(elem);
      
      const time = $row.find('.calendar__time').text().trim();
      const currency = $row.find('.calendar__currency').text().trim();
      const impact = $row.find('.calendar__impact span').attr('title') || 'Low';
      const title = $row.find('.calendar__event-title').text().trim();
      const actual = $row.find('.calendar__actual').text().trim();
      const forecast = $row.find('.calendar__forecast').text().trim();
      const previous = $row.find('.calendar__previous').text().trim();
      
      if (title && (currency === 'USD' || currency === 'ALL')) {
        events.push({
          time: time || 'TBD',
          currency,
          impact: impact.includes('High') ? 'High' : impact.includes('Medium') ? 'Medium' : 'Low',
          title,
          actual: actual || null,
          forecast: forecast || null,
          previous: previous || null,
          timestamp: new Date().toISOString()
        });
      }
    });
    
    return events.slice(0, 20); // Return top 20 events
  } catch (error) {
    console.error('Forex Factory scrape error:', error);
    // Return mock data if scrape fails
    return getMockNews();
  }
}

function getMockNews() {
  return [
    {
      time: '15:30',
      title: 'Non-Farm Employment Change',
      impact: 'High',
      currency: 'USD',
      forecast: '200K',
      previous: '180K'
    },
    {
      time: '15:30',
      title: 'Unemployment Rate',
      impact: 'High',
      currency: 'USD',
      forecast: '3.7%',
      previous: '3.8%'
    }
  ];
}

module.exports = { scrapeForexFactory };
