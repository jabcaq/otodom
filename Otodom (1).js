const { chromium } = require('playwright');
const axios = require('axios');

async function scrapeOtodom(url, context) {
  const page = await context.newPage();
  const otodomResults = [];

  await page.goto(url);

  // Akceptacja ciasteczek
  try {
    await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 2000 });
    await page.click('#onetrust-accept-btn-handler');
    console.log('Zaakceptowano ciasteczka');
  } catch (error) {
    console.log('Nie znaleziono przycisku akceptacji ciasteczek lub już zaakceptowano');
  }

  await page.waitForSelector('[data-cy="listing-item-link"]');

  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-cy="listing-item-link"]')).map(link => link.href);
  });

  const linksToScrape = links.slice(0, 48); // Bierzemy pierwsze 48 linków

  for (const link of linksToScrape) {
    await page.goto(link);
    await page.waitForSelector('[data-cy="adPageAdTitle"]');
    
    // Sprawdzenie i kliknięcie przycisku OK, jeśli istnieje
    try {
      await page.waitForSelector('#laq-next-eXkFTQJyzs9L', { timeout: 1000 });
      await page.click('#laq-next-eXkFTQJyzs9L');
      console.log('Kliknięto przycisk OK');
    } catch (error) {
      console.log('Nie znaleziono przycisku OK lub nie było potrzeby klikać');
    }

    // Próba odsłonięcia numeru telefonu
    let phoneNumberRevealed = false;
    for (let i = 0; i < 3; i++) {
      try {
        await page.click('span.n-button-text-wrapper:has-text("Pokaż numer")');
        await page.waitForSelector('a[href^="tel:"]', { state: 'visible', timeout: 1000 });
        phoneNumberRevealed = true;
        console.log('Numer telefonu został odsłonięty');
        break;
      } catch (error) {
        console.log(`Próba ${i+1} odsłonięcia numeru telefonu nie powiodła się`);
        await page.waitForTimeout(1000);
      }
    }

    if (!phoneNumberRevealed) {
      console.log('Nie udało się odsłonić numeru telefonu po 3 próbach');
    }

    const propertyData = await page.evaluate((currentUrl) => {
      const getTextContent = (selector) => {
        const element = document.querySelector(selector);
        return element ? element.textContent.trim() : null;
      };

      const getFloor = () => {
        const floorElement = document.querySelector('p.etn78ea3.css-1airkmu');
        return floorElement ? floorElement.textContent.trim() : null;
      };

      const getImageUrl = () => {
        const imgElement = document.querySelector('img[src^="https://ireland.apollo.olxcdn.com/"]');
        if (imgElement) {
          const src = imgElement.src;
          return src.split('?')[0];
        }
        return 'Nie znaleziono';
      };

      const getDescription = () => {
        const descriptionElement = document.querySelector('[data-cy="adPageAdDescription"]');
        return descriptionElement ? descriptionElement.innerHTML : null;
      };

      const getTransactionType = () => {
        if (currentUrl.includes('/wynajem/')) return 'wynajem';
        if (currentUrl.includes('/sprzedaz/')) return 'sprzedaż';
        
        const pageContent = document.body.innerText.toLowerCase();
        if (pageContent.includes('do wynajęcia') || pageContent.includes('wynajmę')) return 'wynajem';
        if (pageContent.includes('na sprzedaż') || pageContent.includes('sprzedam')) return 'sprzedaż';
        
        return null;
      };

      const getLocation = () => {
        const newLocationElement = document.querySelector('div.css-70qvj9.e42rcgs0 a');
        if (newLocationElement) {
          const locationText = newLocationElement.textContent
            .split('>')
            .pop()
            .trim();
          
          const locationParts = locationText.split(',').map(part => part.trim());
          const cityIndex = locationParts.length === 4 ? 2 : 1;
          
          return {
            full: locationText,
            street: locationParts.length === 4 ? locationParts[0] : null,
            district: locationParts.length === 4 ? locationParts[1] : locationParts[0],
            city: locationParts[cityIndex] || null,
            province: locationParts[locationParts.length - 1] || null
          };
        }

        const locationElement = document.querySelector('div.css-pla15i.e5h9f1b2');
        if (locationElement) {
          const locationText = locationElement.textContent.replace(/^[^a-zA-Z]+/, '').trim();
          const locationParts = locationText.split(',').map(part => part.trim());
          const cityIndex = locationParts.length === 4 ? 2 : 1;
          
          return {
            full: locationText,
            street: locationParts.length === 4 ? locationParts[0] : null,
            district: locationParts.length === 4 ? locationParts[1] : locationParts[0],
            city: locationParts[cityIndex] || null,
            province: locationParts[locationParts.length - 1] || null
          };
        }

        return {
          full: null,
          street: null,
          district: null,
          city: null,
          province: null
        };
      };

      const location = getLocation();

      return {
        source: 'otodom',
        title: getTextContent('[data-cy="adPageAdTitle"]'),
        price: getTextContent('[data-cy="adPageHeaderPrice"]'),
        location: location,
        details: {
          area: getTextContent('.css-1ftqasz'),
          rooms: getTextContent('.css-1ftqasz + div'),
          floor: getFloor()
        },
        description: getDescription(),
        offerType: 'private',
        transactionType: getTransactionType(),
        image: getImageUrl(),
        phoneNumber: getTextContent('a[href^="tel:"]'),
        sourceUrl: currentUrl,
        contactPerson: getTextContent('.e1xpjavj1.css-11kgwwy'),
        agencyName: getTextContent('strong[aria-label="Nazwa agencji"]'),
        agencyAddress: getTextContent('div[aria-label="Adres agencji"]'),
        address: location.full
      };
    }, page.url());

    otodomResults.push(propertyData);
    console.log(`Zebrano dane z ogłoszenia: ${propertyData.title}`);
  }

  console.log(`Przygotowanie do wysłania danych Otodom do webhooka. Liczba elementów: ${otodomResults.length}`);
  await sendDataToWebhook(otodomResults);

  return otodomResults;
}

async function sendDataToWebhook(data) {
  const webhookUrl = 'https://hook.eu1.make.com/nfsdwuaokhogxur4lobr364mru89vere';
  try {
    console.log('Próba wysłania danych do webhooka. Liczba elementów:', data.length);
    const response = await axios.post(webhookUrl, { properties: data });
    console.log('Dane wysłane do webhooka. Status:', response.status);
    console.log('Odpowiedź:', response.data);
  } catch (error) {
    console.error('Błąd podczas wysyłania danych do webhooka:', error.message);
    if (error.response) {
      console.error('Status odpowiedzi:', error.response.status);
      console.error('Dane odpowiedzi:', error.response.data);
    }
  }
}

async function scrapeRealEstate() {
  const urls = [
    'https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie,rynek-wtorny/podlaskie/bialystok/bialystok/bialystok?distanceRadius=15&limit=36&ownerTypeSingleSelect=PRIVATE&by=DEFAULT&direction=DESC&viewType=listing',
    'https://www.otodom.pl/pl/wyniki/sprzedaz/mieszkanie/pomorskie/sopot/sopot/sopot?limit=48&ownerTypeSingleSelect=PRIVATE&by=DEFAULT&direction=DESC&viewType=listing'
  ];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    for (const url of urls) {
      console.log(`\nRozpoczynam scraping dla URL: ${url}`);
      await scrapeOtodom(url, context);
      console.log(`Zakończono scraping dla URL: ${url}\n`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (error) {
    console.error('Błąd podczas scrapowania Otodom:', error);
  } finally {
    await browser.close();
  }
}

// Wywołanie funkcji w środowisku Leapcell
scrapeRealEstate().catch(console.error);

module.exports = { scrapeOtodom };
