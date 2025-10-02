import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

/**
 * Structure for consistent error responses
 */
export interface ApiError {
  message: string;
  statusCode: number;
  timestamp: string;
  path?: string;
  details?: any;
}

/**
 * Market Error Interceptor - Functional style for Angular 18
 * Handles all HTTP errors with special attention to market data validation errors
 */
export const marketErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // Create consistent error structure
      const apiError: ApiError = {
        message: 'An error occurred',
        statusCode: error.status,
        timestamp: new Date().toISOString(),
        path: req.url,
      };

      // Handle different error status codes
      switch (error.status) {
        case 400:
          // Bad Request - Validation errors (YOUR CURRENT ISSUE)
          console.error('Validation error:', {
            url: req.url,
            method: req.method,
            params: req.params.toString(),
            error: error.error,
          });

          // Extract validation messages from NestJS
          if (error.error?.message) {
            if (Array.isArray(error.error.message)) {
              apiError.message = error.error.message.join(', ');
            } else {
              apiError.message = error.error.message;
            }
          } else {
            apiError.message = 'Invalid request parameters';
          }
          apiError.details = error.error;
          break;

        case 401:
          // Unauthorized
          console.error('Unauthorized access:', req.url);
          apiError.message = 'Authentication required';

          // Don't redirect on login/register endpoints
          if (!req.url.includes('/auth/')) {
            localStorage.setItem('redirectUrl', router.url);
            // Uncomment when you have a login page
            // router.navigate(['/login']);
          }
          break;

        case 403:
          // Forbidden
          console.error('Forbidden access:', req.url);
          apiError.message = 'You do not have permission to access this resource';
          break;

        case 404:
          // Not Found
          console.error('Resource not found:', req.url);
          apiError.message = 'The requested resource was not found';
          break;

        case 429:
          // Too Many Requests - Rate limiting
          console.error('Rate limit exceeded:', req.url);
          apiError.message = 'Too many requests. Please try again later';

          const retryAfter = error.headers.get('Retry-After');
          if (retryAfter) {
            apiError.details = { retryAfter: parseInt(retryAfter, 10) };
          }
          break;

        case 500:
          // Internal Server Error
          console.error('Server error:', {
            url: req.url,
            error: error.error,
          });
          apiError.message = 'An internal server error occurred';
          break;

        case 502:
        case 503:
        case 504:
          // Gateway/Service issues
          console.error('Service unavailable:', req.url);
          apiError.message = 'Service temporarily unavailable. Please try again';
          break;

        case 0:
          // Network error or CORS issue
          console.error('Network error:', {
            url: req.url,
            message: error.message,
          });

          if (!navigator.onLine) {
            apiError.message = 'No internet connection';
          } else if (req.url.includes('localhost') || req.url.includes('127.0.0.1')) {
            apiError.message = 'Cannot connect to local server. Make sure your backend is running';
          } else {
            apiError.message = 'Unable to connect to the server';
          }
          break;

        default:
          console.error(`HTTP error ${error.status}:`, {
            url: req.url,
            error: error.error,
          });

          if (error.error?.message) {
            apiError.message = error.error.message;
          } else if (error.message) {
            apiError.message = error.message;
          }
      }

      // Log full error in development
      if (req.url.includes('localhost')) {
        console.group(`🔴 HTTP Error: ${error.status}`);
        console.log('Request:', req.method, req.url);
        console.log('Params:', req.params.toString());
        console.log('Error:', error.error);
        console.groupEnd();
      }

      // Re-throw the structured error
      return throwError(() => apiError);
    }),
  );
};

/**
 * Helper function to get user-friendly error messages
 * Use this in your components
 */
export function getErrorMessage(error: any): string {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const apiError = error as ApiError;

    if (apiError.statusCode === 429 && apiError.details?.retryAfter) {
      return `${apiError.message}. Try again in ${apiError.details.retryAfter} seconds.`;
    }

    if (apiError.statusCode === 0) {
      return apiError.message;
    }

    return apiError.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return error.message;
  }

  return 'An unexpected error occurred. Please try again.';
}

/**
 * Helper to check if error is retryable
 */
export function isRetryableError(error: any): boolean {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) {
    return false;
  }

  const apiError = error as ApiError;
  const retryableStatusCodes = [408, 429, 502, 503, 504, 0];

  return retryableStatusCodes.includes(apiError.statusCode);
}
