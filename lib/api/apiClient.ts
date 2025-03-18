// Base URL for API requests
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.cabinmusic.app/v1';

// Default request timeout in milliseconds
const DEFAULT_TIMEOUT = 30000;

// Error class for API errors
export class ApiError extends Error {
  status: number;
  data: unknown;
  
  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Error class for conflict errors
export class ConflictError extends ApiError {
  constructor(message: string, data?: unknown) {
    super(message, 409, data);
    this.name = 'ConflictError';
  }
}

// Interface for request options
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
  requiresAuth?: boolean;
}

// Function to get auth token
const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  
  return localStorage.getItem('authToken');
};

// Function to handle request timeout
const timeoutPromise = (ms: number): Promise<never> => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new ApiError('Request timed out', 408));
    }, ms);
  });
};

// Main request function
export const request = async <T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> => {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    requiresAuth = true
  } = options;
  
  // Build request URL
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Build headers
  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers
  };
  
  // Add auth token if required
  if (requiresAuth) {
    const token = getAuthToken();
    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    } else {
      throw new ApiError('Authentication required', 401);
    }
  }
  
  // Build request options
  const requestOptions: RequestInit = {
    method,
    headers: requestHeaders,
    credentials: 'include'
  };
  
  // Add body if provided
  if (body) {
    requestOptions.body = JSON.stringify(body);
  }
  
  try {
    // Make request with timeout
    const response = await Promise.race([
      fetch(url, requestOptions),
      timeoutPromise(timeout)
    ]);
    
    // Parse response
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    
    // Handle error responses
    if (!response.ok) {
      if (response.status === 409) {
        throw new ConflictError(data.message || 'Conflict error', data);
      }
      
      throw new ApiError(
        data.message || 'API request failed',
        response.status,
        data
      );
    }
    
    return data as T;
  } catch (error) {
    // Rethrow ApiErrors
    if (error instanceof ApiError) {
      throw error;
    }
    
    // Convert other errors to ApiErrors
    throw new ApiError(
      (error as Error).message || 'Network error',
      0
    );
  }
};

// Convenience methods for different HTTP methods
export const get = <T>(
  endpoint: string,
  options: Omit<RequestOptions, 'method' | 'body'> = {}
): Promise<T> => {
  return request<T>(endpoint, { ...options, method: 'GET' });
};

export const post = <T>(
  endpoint: string,
  body: Record<string, unknown>,
  options: Omit<RequestOptions, 'method'> = {}
): Promise<T> => {
  return request<T>(endpoint, { ...options, method: 'POST', body });
};

export const put = <T>(
  endpoint: string,
  body: Record<string, unknown>,
  options: Omit<RequestOptions, 'method'> = {}
): Promise<T> => {
  return request<T>(endpoint, { ...options, method: 'PUT', body });
};

export const patch = <T>(
  endpoint: string,
  body: Record<string, unknown>,
  options: Omit<RequestOptions, 'method'> = {}
): Promise<T> => {
  return request<T>(endpoint, { ...options, method: 'PATCH', body });
};

export const del = <T>(
  endpoint: string,
  options: Omit<RequestOptions, 'method'> = {}
): Promise<T> => {
  return request<T>(endpoint, { ...options, method: 'DELETE' });
}; 