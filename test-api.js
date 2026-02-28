const https = require('https');
https.get('https://api.gg.deals/v1/prices/by-steam-app-id/1419850,1091500?key=sqz5OjdsyxNW2e0i3aF5BA0p5rpd0fHU', res => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => console.log(body.substring(0, 500)));
});
