import { HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { Observable } from 'rxjs';

/** Change these as needed later (envs/vars) */
const API_BASE = 'http://localhost:4000';
const MARKET_BASE = 'http://localhost:4000/market';

export function baseUrlInterceptor(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  // Only prefix relative URLs
  if (!/^https?:\/\//i.test(req.url)) {
    const isMarket = req.url.startsWith('/market/');
    const trimmed = isMarket ? req.url.replace('/market', '') : req.url;
    req = req.clone({ url: (isMarket ? MARKET_BASE : API_BASE) + trimmed });
  }
  return next(req);
}
