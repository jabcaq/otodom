const express = require('express');
const cors = require('cors');
const { scrapeOtodom } = require('./Otodom (1).js');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Basic security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.get('/', (req, res) => {
  res.send('Otodom Scraper is running!');
});

app.get('/scrape', async (req, res) => {
  try {
    const url = req.query.url || 'https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie,rynek-wtorny/podlaskie/bialystok/bialystok/bialystok?distanceRadius=15&limit=36&ownerTypeSingleSelect=PRIVATE&by=DEFAULT&direction=DESC&viewType=listing';
    
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ],
      executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome'
    });

    const timeout = setTimeout(() => {
      browser.close();
      res.status(504).json({ success: false, error: 'Request timeout' });
    }, 300000);

    const results = await scrapeOtodom(url, browser);
    clearTimeout(timeout);
    await browser.close();

    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error during scraping:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 