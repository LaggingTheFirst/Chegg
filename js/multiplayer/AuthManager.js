export class AuthManager {
    constructor() {
        this.username = localStorage.getItem('chegg_username') || null;
        this.token = localStorage.getItem('chegg_token') || null;
        this.elo = localStorage.getItem('chegg_elo') || 1200;
    }

    isAuthenticated() {
        return this.username !== null && this.token !== null;
    }

    setCredentials(username, token, elo = null) {
        this.username = username;
        this.token = token;
        localStorage.setItem('chegg_username', username);
        localStorage.setItem('chegg_token', token);
        if (elo !== null) {
            this.elo = elo;
            localStorage.setItem('chegg_elo', elo);
        }
    }

    generateToken() {
        return Math.random().toString(36).substring(2) + Date.now().toString(36);
    }

    getCredentials() {
        if (!this.username) return null;
        if (!this.token) {
            this.token = this.generateToken();
            localStorage.setItem('chegg_token', this.token);
        }
        return { username: this.username, token: this.token };
    }

    clear() {
        this.username = null;
        this.token = null;
        localStorage.removeItem('chegg_username');
        localStorage.removeItem('chegg_token');
    }
}
