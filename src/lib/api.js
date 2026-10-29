/** Resolve the API once: development uses :3001, deployed pages use their own origin. */
export function resolveBackendOrigin({ override = '', development = false, location }) {
    if (override) return new URL(override, location.origin).href.replace(/\/+$/, '');
    if (!development) return location.origin;
    const origin = new URL(location.origin);
    origin.port = '3001';
    return origin.origin;
}

const location = globalThis.location || { origin: 'http://localhost:3001' };
export const API_BASE_URL = resolveBackendOrigin({
    override: import.meta.env?.VITE_API_BASE_URL,
    development: import.meta.env?.DEV === true,
    location,
});
export const WS_URL = API_BASE_URL.replace(/^http/, 'ws');
export const apiUrl = path => `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
export const assetUrl = pathOrUrl => !pathOrUrl ? '' : /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : apiUrl(pathOrUrl);

/** All management endpoints return JSON; failed HTTP/business responses reject uniformly. */
export async function requestJson(url, { body, headers, expectSuccess = false, fetchImpl = globalThis.fetch, ...options } = {}) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set('Accept', 'application/json');
    if (body !== undefined) requestHeaders.set('Content-Type', 'application/json');
    const response = await fetchImpl(url, { ...options, headers: requestHeaders, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { throw new Error(response.ok ? '服务器返回了无效的 JSON 数据' : `请求失败（HTTP ${response.status}）`); }
    if (!response.ok || data?.success === false || data?.error || (expectSuccess && data?.success !== true)) {
        const detail = typeof data?.error === 'string' ? data.error : data?.error?.message;
        const error = new Error(detail || data?.message || `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        throw error;
    }
    return data;
}
export const apiRequest = (path, options) => requestJson(apiUrl(path), options);
