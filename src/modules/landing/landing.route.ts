import { Hono } from 'hono';

const landing = new Hono();

landing.get('/', async (c) => {
  // 1. Bilingual Handling (NF07)
  // Default to 'id' (Indonesian) if not specified
  const lang = c.req.query('lang') === 'en' ? 'en' : 'id';

  // 2. Static Data Simulation (To be replaced by DB call in BE-10)
  // We mock this now so Frontend can start building.
  const responseData = {
    meta: {
      lang: lang.toUpperCase(),
      generatedAt: new Date().toISOString()
    },
    hero: {
      title: lang === 'en' 
        ? "Leading Petroleum Geoscience to Fuel the Future" 
        : "Memimpin Geosains Minyak Bumi untuk Masa Depan",
      description: lang === 'en'
        ? "Wildcat AAPG ITB 2026 is an annual Petroleum Geoscience-themed competition."
        : "Wildcat AAPG ITB 2026 adalah kompetisi tahunan bertema Geosains Minyak Bumi."
    },
    announcement: null // No announcements yet
  };

  return c.json(responseData);
});

export default landing;