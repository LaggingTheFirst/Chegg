const STORAGE_KEY = 'chegg_lan_server_url';

export class LanDiscovery {
    static getDefaultUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.hostname || 'localhost';
        return `${protocol}//${host}:1109`;
    }

    static getSavedServerUrl() {
        return localStorage.getItem(STORAGE_KEY) || LanDiscovery.getDefaultUrl();
    }

    static setSavedServerUrl(url) {
        localStorage.setItem(STORAGE_KEY, url);
    }
}
