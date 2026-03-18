async function testFetch() {
    const symbol = "2330.TW";
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`;

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            console.log(`HTTP ${response.status}`);
            return;
        }

        const data = await response.json();
        const result = data.chart.result[0];
        const meta = result.meta;
        console.log(`Symbol: ${symbol}`);
        console.log(`Price: ${meta.regularMarketPrice}`);
        console.log(`Previous Close: ${meta.previousClose}`);
        console.log(`Ask: ${meta.ask || 'N/A'}`);
        console.log(`Bid: ${meta.bid || 'N/A'}`);
    } catch (err) {
        console.error(err);
    }
}

testFetch();
