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
    if (!pathOrUrl) return '';
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return apiUrl(pathOrUrl);
};
