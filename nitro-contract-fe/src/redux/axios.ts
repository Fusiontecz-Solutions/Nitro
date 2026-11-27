import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import {
    httpGetCacheEpoch,
    clearInFlightGet,
    getInFlightGet,
    httpGetCacheKey,
    invalidateHttpGetCacheByUrl,
    readCachedGetResponse,
    setInFlightGet,
    shouldUseGetResponseCache,
    toCachedAxiosResponse,
    writeCachedGetResponse,
} from '@/lib/httpGetCache';
import { invalidateRequestFreshness } from '@/lib/requestOnce';

// Guarded like docusignTemplateConfig: `import.meta.env` is Vite-only, so this
// module is otherwise unimportable from Node (acceptance tests, scripts).
// Under Vite the env object always exists, so browser behavior is unchanged.
const API_BASE_URL =
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) ||
    'http://localhost:5000/api/v1';

/** Default request budget — many CRM list/aggregate endpoints exceed 25s under load. */
const DEFAULT_AXIOS_TIMEOUT_MS = 120_000;

const axiosInstance: AxiosInstance = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_AXIOS_TIMEOUT_MS,
    headers: {
        'Content-Type': 'application/json',
    },
});

// axiosInstance.interceptors.request.use(
//     (config: InternalAxiosRequestConfig) => {
//         const token = localStorage.getItem('token')?.toString() || sessionStorage.getItem('token')?.toString();

//         if (token && config.headers) {
//             config.headers.Authorization = `Bearer ${token}`;
//         }

//         return config;
//     },
//     (error: AxiosError) => {
//         return Promise.reject(error);
//     }
// );

axiosInstance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
  
      const token =
        localStorage.getItem("token")?.toString() ||
        sessionStorage.getItem("token")?.toString();
  
      // 🔥 Don't overwrite existing Authorization header
      if (token && config.headers && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
  
        // Let the browser set Content-Type for FormData (multipart/form-data + boundary)
        if (config.data instanceof FormData && config.headers) {
            delete config.headers['Content-Type'];
        }

      return config;
    },
    (error: AxiosError) => Promise.reject(error)
  );

axiosInstance.interceptors.response.use(
    (response: AxiosResponse) => {
        return response;
    },
    (error: AxiosError) => {
        if (error.response) {
            const { status } = error.response;
            const requestUrl = error.config?.url ?? '';
            const isLoginRequest = requestUrl.includes('/auth/login');

            const isDocusignIntegrationRequest = requestUrl.includes('/docusign/');
            const isPublicPortalRequest = requestUrl.includes('/public/application/');

            if (
                status === 401 &&
                !isLoginRequest &&
                !isDocusignIntegrationRequest &&
                !isPublicPortalRequest
            ) {
                localStorage.removeItem('token');
                sessionStorage.removeItem('token');
                if (window.location.pathname !== '/login') {
                    window.location.href = '/login';
                }
            }

            if (status === 403) {
                console.error('Access forbidden');
            }

            if (status === 500) {
                console.error('Internal server error');
            }
        }

        return Promise.reject(error);
    }
);

function cachedGet(url: string, config?: AxiosRequestConfig) {
    const key = httpGetCacheKey(url, config);
    const inflight = getInFlightGet(key);
    if (inflight) return inflight;

    if (shouldUseGetResponseCache(url, config)) {
        const cached = readCachedGetResponse(key);
        if (cached) {
            return Promise.resolve(toCachedAxiosResponse(cached, config));
        }
    }

    const startedAtEpoch = httpGetCacheEpoch();
    const request = axiosInstance.get(url, config).then((response) => {
        // A save landed while this read was in flight: its data may predate the
        // save, so hand it to this caller but never cache it for the next one.
        if (shouldUseGetResponseCache(url, config) && startedAtEpoch === httpGetCacheEpoch()) {
            writeCachedGetResponse(key, response);
        }
        return response;
    });
    setInFlightGet(key, request);
    void request.finally(() => clearInFlightGet(key, request)).catch(() => undefined);
    return request;
}

function mutationUrl(config?: { url?: string }): string {
    return String(config?.url || "");
}

function afterSuccessfulMutation<T extends { config?: { url?: string } }>(
    promise: Promise<T>,
): Promise<T> {
    return promise.then((result) => {
        const url = mutationUrl(result.config);
        invalidateHttpGetCacheByUrl(url);
        if (url.includes("/comments")) {
            invalidateRequestFreshness("comments:");
        } else if (url.includes("/offer-decisions")) {
            invalidateRequestFreshness("offer:");
        } else if (url.includes("/terms-offers")) {
            invalidateRequestFreshness("terms:");
        } else if (url.includes("/applications")) {
            invalidateRequestFreshness("application:");
        }
        return result;
    });
}

export const axiosGet = (url: string, config?: AxiosRequestConfig) =>
    cachedGet(url, config);
export const axiosPost = (url: string, payload?: any, config?: AxiosRequestConfig) =>
    afterSuccessfulMutation(axiosInstance.post(url, payload, config));
export const axiosPut = (url: string, payload?: any, config?: AxiosRequestConfig) =>
    afterSuccessfulMutation(axiosInstance.put(url, payload, config));
export const axiosPatch = (url: string, payload?: any, config?: AxiosRequestConfig) =>
    afterSuccessfulMutation(axiosInstance.patch(url, payload, config));
export const axiosDelete = (url: string, config?: AxiosRequestConfig) =>
    afterSuccessfulMutation(axiosInstance.delete(url, config));

// FormData upload helper – interceptor clears Content-Type so browser sets multipart/form-data + boundary
export const axiosPostFormData = (
    url: string,
    formData: FormData,
    config?: AxiosRequestConfig
) =>
    afterSuccessfulMutation(
        axiosInstance.post(url, formData, { timeout: 120000, ...config }),
    );

export const axiosPatchFormData = (
    url: string,
    formData: FormData,
    config?: AxiosRequestConfig
) =>
    afterSuccessfulMutation(
        axiosInstance.patch(url, formData, { timeout: 120000, ...config }),
    );
