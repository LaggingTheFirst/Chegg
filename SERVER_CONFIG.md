# Server Configuration Guide

## Quick Setup

To change the server URL for your Chegg game, edit **one file**:

### `js/config.js`

```javascript
export const CONFIG = {
    // Change this line to your server URL:
    SERVER_URL: 'https://your-server-url.com',
    
    // Everything else is automatic!
};
```

That's it! All pages (game, leaderboard, profile, tournaments, admin) will automatically use the new URL.

## Common Configurations

### Local Development
```javascript
SERVER_URL: 'http://localhost:1109',
```

### Cloudflare Tunnel
```javascript
SERVER_URL: 'https://your-tunnel-name.trycloudflare.com',
```

### Production Server
```javascript
SERVER_URL: 'https://chegg.yourdomain.com',
```

### Custom Port
```javascript
SERVER_URL: 'http://192.168.1.100:1109',
```

## How It Works

The config file automatically generates:
- **API_URL**: `${SERVER_URL}/api` - For REST endpoints
- **WS_URL**: `wss://` or `ws://` - For WebSocket connections

All game files import from `js/config.js`:
- `js/multiplayer/NetworkClient.js` - WebSocket connection
- `profile.html` - Player profiles
- `leaderboard.html` - Rankings
- `tournament.html` - Tournament system
- `admin.html` - Admin panel

## Testing Your Configuration

1. Edit `js/config.js` with your server URL
2. Start your server: `cd server && node index.js`
3. Open the game in your browser
4. Check browser console for connection messages

If you see "WS Connected" in the console, you're good to go!

## Troubleshooting

### WebSocket Connection Failed
- Make sure server is running
- Check if URL includes protocol (`http://` or `https://`)
- Verify firewall/port settings
- For HTTPS sites, server must also use HTTPS (or use Cloudflare Tunnel)

### API Calls Failing
- Check browser Network tab for failed requests
- Verify server URL is correct (no trailing slash)
- Ensure CORS is enabled on server (already configured)

### Mixed Content Errors
If your site is HTTPS but server is HTTP:
- Use Cloudflare Tunnel for free HTTPS
- Or set up SSL certificate on your server
- Or host frontend on HTTP during development

## Multiple Environments

You can maintain different configs for dev/prod:

```javascript
// Development
const DEV_SERVER = 'http://localhost:1109';

// Production
const PROD_SERVER = 'https://chegg.yourdomain.com';

// Auto-detect based on hostname
export const CONFIG = {
    SERVER_URL: window.location.hostname === 'localhost' 
        ? DEV_SERVER 
        : PROD_SERVER,
    // ... rest of config
};
```

## Server Setup

Don't forget to configure your server too!

In `server/index.js`, the server runs on:
```javascript
const PORT = process.env.PORT || 1109;
```

Set environment variable:
```bash
# Linux/Mac
export PORT=8080

# Windows
set PORT=8080

# Or in .env file
PORT=8080
```

## Cloudflare Tunnel Setup

For easy HTTPS without certificates:

```bash
# Install cloudflared
# Then run:
cloudflared tunnel --url http://localhost:1109

# Copy the generated URL to js/config.js
```

The tunnel URL changes each time, so for permanent setup:
1. Create a Cloudflare account
2. Set up a named tunnel
3. Configure a subdomain
4. Use that subdomain in `js/config.js`
