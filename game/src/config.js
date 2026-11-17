/* Central tuning and authored city data for Coral Bay. Every number lives here;
   no other module hard-codes a tuning constant of its own. */
var GAME_CONFIG = {
  city: { width: 3200, height: 2400, block: 180, road: 28, sidewalk: 8, beach: 190, cycle: 600, seed: 731942 },
  player: { walk: 4.5, run: 7.5, radius: 8 },
  camera: { height: 180, follow: 4.2 },
  districts: [
    { name: 'Mangrove Outskirts', x: 0, y: 1170, width: 1300, height: 1230, color: '#526e54' },
    { name: 'Downtown', x: 780, y: 0, width: 1250, height: 1510, color: '#d3a36c' },
    { name: 'Boardwalk', x: 2030, y: 0, width: 1170, height: 1120, color: '#e6c58c' },
    { name: 'Marina', x: 1690, y: 1120, width: 1510, height: 1280, color: '#bdad80' }
  ],
  shops: ['Palmetto Pawn', 'Casa Sirena', 'Voss & Sons Motors', 'Coral Crown', 'Blue Current', 'Sunline Pharmacy', 'Lucky Pelican', 'Citrus Exchange', 'Marea Market', 'Southpoint Deli', 'Gilded Gull Office', 'Bayview Records', 'Tideglass Cafe', 'Marlin Supply', 'Last Light Lounge', 'Crown Laundry', 'Rook Auto Glass', 'Salt & Lime', 'Marina Tax', 'Seabreeze Hotel', 'Little Havana Bakery', 'Coastline Credit', 'Driftwood Florist', 'Neon Palm', 'Gulf Star Travel', 'Coral Key Realty', 'Dockside Bait', 'Mango House'],
  palette: { ink: '#132529', paper: '#fff5df', coral: '#ff735d', teal: '#42aeb0', water: '#3199a1', deepWater: '#247d88', road: '#555c58', roadLine: '#e8d39c', building: ['#d98260', '#efb76c', '#6aa3a0', '#d8c6a0', '#da8c70', '#84a48c', '#d4a375'], roof: ['#b95f4f', '#cf8656', '#467e7b', '#a99a78'] }
};
