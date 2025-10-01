{
  ('signals');
  [
    {
      symbol: 'AAPL',
      timestamp: '2025-09-30T20:00:00Z',
      action: 'buy',
      confidence: 0.78,
      reason: 'momentum>threshold',
    },
    { symbol: 'MSFT', timestamp: '2025-09-30T20:00:00Z', action: 'hold', confidence: 0.55 },
    {
      symbol: 'NVDA',
      timestamp: '2025-09-30T20:00:00Z',
      action: 'sell',
      confidence: 0.62,
      reason: 'overextended',
    },
  ];
}
