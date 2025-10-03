// src/app/core/http/market-error.interceptor.ts
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/** Consistent error envelope surfaced to the app */
export interface ApiError {
  message: string;
  statusCode: number;
  timestamp: string;
  path?: string;
  details?: any;
}

/** Small runtime helpers to stay SSR-safe */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
function safeIsOnline(): boolean | null {
  return isBrowser() && typeof navigator !== 'undefined' ? navigator.onLine : null;
}
function safeSetLocalStorage(key: string, value: string) {
  try {
    if (isBrowser() && typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    }
  } catch {
    /* ignore */
  }
}
function extractNestMessage(payload: any): string | undefined {
  // Nest often returns { message: string | string[], statusCode, error }
  const msg = payload?.message;
  if (Array.isArray(msg)) return msg.join(', ');
  if (typeof msg === 'string') return msg;
  return undefined;
}
function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const n = Number(headerValue);
  return Number.isFinite(n) ? n : undefined; // seconds
}

/**
 * Market Error Interceptor (Angular 18 functional style)
 * - Normalizes error responses
 * - SSR-safe (no direct navigator/window/localStorage access without guards)
 */
export const marketErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const apiError: ApiError = {
        message: 'An error occurred',
        statusCode: error.status ?? 0,
        timestamp: new Date().toISOString(),
        path: req.url,
      };

      // Prefer explicit message from server payloads (e.g., NestJS)
      const serverMsg = extractNestMessage(error?.error);
      if (serverMsg) apiError.message = serverMsg;

      switch (error.status) {
        case 400: {
          console.error('Validation error:', {
            url: req.url,
            method: req.method,
            params: req.params?.toString?.(),
            error: error.error,
          });
          if (!serverMsg) apiError.message = 'Invalid request parameters';
          apiError.details = error.error;
          break;
        }

        case 401: {
          console.error('Unauthorized access:', req.url);
          apiError.message = serverMsg ?? 'Authentication required';
          // Avoid redirect loops; store intended path for later
          if (!req.url.includes('/auth/')) {
            safeSetLocalStorage('redirectUrl', router.url);
            // router.navigate(['/login']); // enable when login route exists
          }
          break;
        }

        case 403: {
          console.error('Forbidden:', req.url);
          apiError.message = serverMsg ?? 'You do not have permission to access this resource';
          break;
        }

        case 404: {
          console.error('Not found:', req.url);
          apiError.message = serverMsg ?? 'The requested resource was not found';
          break;
        }

        case 429: {
          console.error('Rate limit exceeded:', req.url);
          apiError.message = serverMsg ?? 'Too many requests. Please try again later';
          const retryAfter = parseRetryAfter(error.headers?.get?.('Retry-After') ?? null);
          if (retryAfter !== undefined) {
            apiError.details = { ...(apiError.details ?? {}), retryAfter };
          }
          break;
        }

        case 500: {
          console.error('Server error:', { url: req.url, error: error.error });
          apiError.message = serverMsg ?? 'An internal server error occurred';
          break;
        }

        case 502:
        case 503:
        case 504: {
          console.error('Upstream service unavailable:', req.url);
          apiError.message = serverMsg ?? 'Service temporarily unavailable. Please try again';
          break;
        }

        case 0: {
          // CORS / network / unreachable host
          console.error('Network error:', { url: req.url, message: error.message });
          const online = safeIsOnline();
          if (online === false) {
            apiError.message = 'No internet connection';
          } else if (req.url.includes('localhost') || req.url.includes('127.0.0.1')) {
            apiError.message = 'Cannot connect to local server. Make sure your backend is running';
          } else {
            apiError.message = serverMsg ?? 'Unable to connect to the server';
          }
          break;
        }

        default: {
          console.error(`HTTP error ${error.status}:`, { url: req.url, error: error.error });
          if (!serverMsg) {
            apiError.message = error.message || apiError.message;
          }
        }
      }

      // Verbose log in local dev
      if (req.url.includes('localhost')) {
        console.group(`🔴 HTTP ${error.status} ${req.method} ${req.url}`);
        console.log('Params:', req.params?.toString?.());
        console.log('Payload:', error.error);
        console.groupEnd();
      }

      return throwError(() => apiError);
    }),
  );
};

/** Friendly error message for components */
export function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'statusCode' in (err as any)) {
    const e = err as ApiError;
    if (e.statusCode === 429 && e.details?.retryAfter) {
      return `${e.message}. Try again in ${e.details.retryAfter} seconds.`;
    }
    return e.message;
  }
  if (err && typeof err === 'object' && 'message' in (err as any)) {
    return String((err as any).message);
  }
  return 'An unexpected error occurred. Please try again.';
}

/** Indicates whether a request is worth retrying at all */
export function isRetryableError(err: unknown): boolean {
  if (!err || typeof err !== 'object' || !('statusCode' in (err as any))) return false;
  const status = (err as ApiError).statusCode;
  return [408, 429, 502, 503, 504, 0].includes(status);
}
