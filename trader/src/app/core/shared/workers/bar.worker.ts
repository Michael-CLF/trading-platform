// src/app/core/shared/workers/bar.worker.ts

/// <reference lib="webworker" />
import { aggregateTo15m } from '../utils/bars.utils';

addEventListener('message', ({ data }) => {
  const result = aggregateTo15m(data);
  postMessage(result);
});
