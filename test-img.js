fetch('https://api.gg.deals/v1/prices/by-steam-app-id/1419850?key=sqz5OjdsyxNW2e0i3aF5BA0p5rpd0fHU')
    .then(res => res.json())
    .then(res => console.log(JSON.stringify(res['1419850']?.info, null, 2)));
