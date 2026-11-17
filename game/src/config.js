/* Central tuning and authored city data for Coral Bay. Every number lives here;
   no other module hard-codes a tuning constant of its own. */
var GAME_CONFIG = {
  city: { width: 3200, height: 2400, block: 180, road: 28, sidewalk: 8, beach: 190, cycle: 600, seed: 731942 },
  player: { walk: 4.5, run: 7.5, radius: 8 },
  /* Vehicle tuning (07: speeds lowered to the smaller city). Top speed in
     m/s; acceleration in m/s^2; grip steers how fast velocity follows the
     heading; durability is the health pool before smoke, then fire. */
  vehicles: {
    types: [
      { id: 'compact', name: 'Pinto', topSpeed: 30, acceleration: 7, grip: 3.2, durability: 60, colors: ['#d34e47', '#e6ca84', '#388a88'] },
      { id: 'sedan', name: 'Marlin', topSpeed: 34, acceleration: 8, grip: 3.4, durability: 70, colors: ['#f4f1df', '#415b67', '#d34e47'] },
      { id: 'suv', name: 'Gulfstar', topSpeed: 32, acceleration: 7.5, grip: 3.0, durability: 90, colors: ['#415b67', '#388a88', '#e6ca84'] },
      { id: 'pickup', name: 'Hauler', topSpeed: 31, acceleration: 7, grip: 2.9, durability: 85, colors: ['#d98260', '#6aa3a0', '#f4f1df'] },
      { id: 'sport', name: 'Coral GT', topSpeed: 46, acceleration: 11, grip: 4.2, durability: 55, colors: ['#ff735d', '#e6ca84', '#132529'] },
      { id: 'police', name: 'Interceptor', topSpeed: 40, acceleration: 9.5, grip: 3.8, durability: 100, colors: ['#1d3a4d'] }
    ],
    /* Active AI traffic target per district (03, per district, not per view). */
    density: { 'Downtown': 14, 'Boardwalk': 10, 'Marina': 6, 'Mangrove Outskirts': 2 },
    nightMultiplier: 0.6
  },
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
