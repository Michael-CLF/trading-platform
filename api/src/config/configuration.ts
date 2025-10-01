// Centralized, typed configuration for the API
// Export a default factory so ConfigModule.load can consume it.
export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '4000', 10),

  vendor: {
    // choose: alpha_vantage | polygon | finnhub | twelve_data
    provider: (process.env.MARKET_PROVIDER ?? 'alpha_vantage') as
      | 'alpha_vantage'
      | 'polygon'
      | 'finnhub'
      | 'twelve_data',
    apiKey: process.env.MARKET_API_KEY ?? '',
    baseUrl: process.env.MARKET_BASE_URL ?? '', // optional override
  },

  cache: {
    quoteTtl: parseInt(process.env.CACHE_TTL_QUOTE ?? '15', 10),
    intradayTtl: parseInt(process.env.CACHE_TTL_INTRADAY ?? '60', 10),
    dailyTtl: parseInt(process.env.CACHE_TTL_DAILY ?? '900', 10),
  },
});
