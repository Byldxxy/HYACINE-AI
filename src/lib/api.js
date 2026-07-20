/**
 * 浏览器端后端地址解析。
 *
 * 开发环境页面通常来自 Vite :5173，而 API/WebSocket 位于 :3001；生产页面由后端自己
 * 托管时直接复用当前 origin。VITE_API_BASE_URL 可覆盖这套规则，用于代理或非默认端口。
 */
const DEFAULT_BACKEND_PORT = '3001';

const getBackendOrigin = () => {
    if (import.meta.env.VITE_API_BASE_URL) {
        return import.meta.env.VITE_API_BASE_URL.replace(/\/$/, '');
    }

    const { protocol, hostname, port } = window.location;
    if (port === DEFAULT_BACKEND_PORT) {
        return window.location.origin;
    }

    return `${protocol}//${hostname}:${DEFAULT_BACKEND_PORT}`;
};

export const API_BASE_URL = getBackendOrigin();

export const WS_URL = API_BASE_URL.replace(/^http/, 'ws');

export const apiUrl = (path) => {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${cleanPath}`;
};

export const assetUrl = (pathOrUrl) => {
    // 角色图片 API 返回的相对路径也应指向后端，而不是 Vite 开发服务器。
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return apiUrl(pathOrUrl);
};
