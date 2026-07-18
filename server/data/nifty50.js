const rawConstituents = [
  {
    name: "Adani Enterprises Ltd.",
    industry: "Metals & Mining",
    symbol: "ADANIENT",
  },
  {
    name: "Adani Ports and Special Economic Zone Ltd.",
    industry: "Services",
    symbol: "ADANIPORTS",
  },
  {
    name: "Apollo Hospitals Enterprise Ltd.",
    industry: "Healthcare",
    symbol: "APOLLOHOSP",
  },
  {
    name: "Asian Paints Ltd.",
    industry: "Consumer Durables",
    symbol: "ASIANPAINT",
  },
  {
    name: "Axis Bank Ltd.",
    industry: "Financial Services",
    symbol: "AXISBANK",
  },
  {
    name: "Bajaj Auto Ltd.",
    industry: "Automobile and Auto Components",
    symbol: "BAJAJ-AUTO",
  },
  {
    name: "Bajaj Finance Ltd.",
    industry: "Financial Services",
    symbol: "BAJFINANCE",
  },
  {
    name: "Bajaj Finserv Ltd.",
    industry: "Financial Services",
    symbol: "BAJAJFINSV",
  },
  {
    name: "Bharat Electronics Ltd.",
    industry: "Capital Goods",
    symbol: "BEL",
  },
  {
    name: "Bharti Airtel Ltd.",
    industry: "Telecommunication",
    symbol: "BHARTIARTL",
  },
  {
    name: "Cipla Ltd.",
    industry: "Healthcare",
    symbol: "CIPLA",
  },
  {
    name: "Coal India Ltd.",
    industry: "Oil Gas & Consumable Fuels",
    symbol: "COALINDIA",
  },
  {
    name: "Dr. Reddy's Laboratories Ltd.",
    industry: "Healthcare",
    symbol: "DRREDDY",
  },
  {
    name: "Eicher Motors Ltd.",
    industry: "Automobile and Auto Components",
    symbol: "EICHERMOT",
  },
  {
    name: "Eternal Ltd.",
    industry: "Consumer Services",
    symbol: "ETERNAL",
  },
  {
    name: "Grasim Industries Ltd.",
    industry: "Construction Materials",
    symbol: "GRASIM",
  },
  {
    name: "HCL Technologies Ltd.",
    industry: "Information Technology",
    symbol: "HCLTECH",
  },
  {
    name: "HDFC Bank Ltd.",
    industry: "Financial Services",
    symbol: "HDFCBANK",
  },
  {
    name: "HDFC Life Insurance Company Ltd.",
    industry: "Financial Services",
    symbol: "HDFCLIFE",
  },
  {
    name: "Hindalco Industries Ltd.",
    industry: "Metals & Mining",
    symbol: "HINDALCO",
  },
  {
    name: "Hindustan Unilever Ltd.",
    industry: "Fast Moving Consumer Goods",
    symbol: "HINDUNILVR",
  },
  {
    name: "ICICI Bank Ltd.",
    industry: "Financial Services",
    symbol: "ICICIBANK",
  },
  {
    name: "ITC Ltd.",
    industry: "Fast Moving Consumer Goods",
    symbol: "ITC",
  },
  {
    name: "Infosys Ltd.",
    industry: "Information Technology",
    symbol: "INFY",
  },
  {
    name: "InterGlobe Aviation Ltd.",
    industry: "Services",
    symbol: "INDIGO",
  },
  {
    name: "JSW Steel Ltd.",
    industry: "Metals & Mining",
    symbol: "JSWSTEEL",
  },
  {
    name: "Jio Financial Services Ltd.",
    industry: "Financial Services",
    symbol: "JIOFIN",
  },
  {
    name: "Kotak Mahindra Bank Ltd.",
    industry: "Financial Services",
    symbol: "KOTAKBANK",
  },
  {
    name: "Larsen & Toubro Ltd.",
    industry: "Construction",
    symbol: "LT",
  },
  {
    name: "Mahindra & Mahindra Ltd.",
    industry: "Automobile and Auto Components",
    symbol: "M&M",
  },
  {
    name: "Maruti Suzuki India Ltd.",
    industry: "Automobile and Auto Components",
    symbol: "MARUTI",
  },
  {
    name: "Max Healthcare Institute Ltd.",
    industry: "Healthcare",
    symbol: "MAXHEALTH",
  },
  {
    name: "NTPC Ltd.",
    industry: "Power",
    symbol: "NTPC",
  },
  {
    name: "Nestle India Ltd.",
    industry: "Fast Moving Consumer Goods",
    symbol: "NESTLEIND",
  },
  {
    name: "Oil & Natural Gas Corporation Ltd.",
    industry: "Oil Gas & Consumable Fuels",
    symbol: "ONGC",
  },
  {
    name: "Power Grid Corporation of India Ltd.",
    industry: "Power",
    symbol: "POWERGRID",
  },
  {
    name: "Reliance Industries Ltd.",
    industry: "Oil Gas & Consumable Fuels",
    symbol: "RELIANCE",
  },
  {
    name: "SBI Life Insurance Company Ltd.",
    industry: "Financial Services",
    symbol: "SBILIFE",
  },
  {
    name: "Shriram Finance Ltd.",
    industry: "Financial Services",
    symbol: "SHRIRAMFIN",
  },
  {
    name: "State Bank of India",
    industry: "Financial Services",
    symbol: "SBIN",
  },
  {
    name: "Sun Pharmaceutical Industries Ltd.",
    industry: "Healthcare",
    symbol: "SUNPHARMA",
  },
  {
    name: "Tata Consultancy Services Ltd.",
    industry: "Information Technology",
    symbol: "TCS",
  },
  {
    name: "Tata Consumer Products Ltd.",
    industry: "Fast Moving Consumer Goods",
    symbol: "TATACONSUM",
  },
  {
    name: "Tata Motors Passenger Vehicles Ltd.",
    industry: "Automobile and Auto Components",
    symbol: "TMPV",
  },
  {
    name: "Tata Steel Ltd.",
    industry: "Metals & Mining",
    symbol: "TATASTEEL",
  },
  {
    name: "Tech Mahindra Ltd.",
    industry: "Information Technology",
    symbol: "TECHM",
  },
  {
    name: "Titan Company Ltd.",
    industry: "Consumer Durables",
    symbol: "TITAN",
  },
  {
    name: "Trent Ltd.",
    industry: "Consumer Services",
    symbol: "TRENT",
  },
  {
    name: "UltraTech Cement Ltd.",
    industry: "Construction Materials",
    symbol: "ULTRACEMCO",
  },
  {
    name: "Wipro Ltd.",
    industry: "Information Technology",
    symbol: "WIPRO",
  },
];

const demoOpenOverrides = {
  RELIANCE: 2000,
  INFY: 1510,
  HDFCBANK: 1675,
  ICICIBANK: 1230,
  TCS: 3920,
  ITC: 438,
  SBIN: 812,
  LT: 3650,
  BHARTIARTL: 1425,
  SUNPHARMA: 1740,
  TITAN: 3360,
  MARUTI: 12950,
  AXISBANK: 1185,
  KOTAKBANK: 1835,
  HINDUNILVR: 2330,
  BAJFINANCE: 7060,
  BAJAJFINSV: 1660,
  BEL: 298,
  WIPRO: 482,
  TECHM: 1298,
};

function hashText(input) {
  return [...input].reduce((accumulator, character) => {
    return (accumulator * 31 + character.charCodeAt(0)) % 100000;
  }, 7);
}

function buildOpenPrice(symbol) {
  if (demoOpenOverrides[symbol]) {
    return demoOpenOverrides[symbol];
  }

  const value = 180 + (hashText(symbol) % 5600);
  return Number(value.toFixed(2));
}

export const nifty50Universe = rawConstituents.map((item) => ({
  ...item,
  exchange: "NSE",
  tokenHint: `NSE:${item.symbol}`,
  openPrice: buildOpenPrice(item.symbol),
}));

export function searchUniverse(query = "") {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return nifty50Universe.slice(0, 8);
  }

  return nifty50Universe
    .filter((item) => {
      const haystack = `${item.name} ${item.symbol} ${item.industry}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftStarts = left.symbol.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      const rightStarts = right.symbol.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;

      if (leftStarts !== rightStarts) {
        return leftStarts - rightStarts;
      }

      return left.symbol.localeCompare(right.symbol);
    })
    .slice(0, 8);
}
