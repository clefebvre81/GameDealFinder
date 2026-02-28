const https = require('https');
https.get('https://api.gg.deals/v1/bundles/active?key=sqz5OjdsyxNW2e0i3aF5BA0p5rpd0fHU', res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => console.log(JSON.stringify(JSON.parse(body).data.bundles.slice(0, 2), null, 2)));
});
