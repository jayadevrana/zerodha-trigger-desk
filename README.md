# Zerodha Trigger Desk

Real-order trigger app for Zerodha with:

- backend-only auth flow
- Nifty 50 symbol search
- live quote wiring through the official `kiteconnect` Node SDK
- one-shot BUY / SELL triggers
- ATO alert creation through Kite Connect Alerts API
- market-order placement with `market_protection`
- persisted trigger and session state

## Run locally

```bash
npm install
npm run dev
```

Frontend:

`http://localhost:5173`

Backend API:

`http://localhost:8787`

## Environment

Copy `.env.example` to `.env` and fill:

- `ZERODHA_API_KEY`
- `ZERODHA_API_SECRET`
- `ZERODHA_REDIRECT_URL`
- `PUBLIC_BASE_URL`
- `ZERODHA_ACCESS_TOKEN` if you want the server to verify and load a fresh token on startup

## Zerodha login model

This app is wired for the official Zerodha login flow:

1. Open the Zerodha login URL from the UI.
2. Log in with your Zerodha account.
3. Zerodha redirects back to `/auth/zerodha/callback`.
4. The backend exchanges the `request_token` and stores the fresh `access_token`.

You can also paste a freshly generated `access_token` into `.env` before starting the server. On boot, the app verifies it with Zerodha, starts the quote stream, and immediately evaluates any armed triggers.

## Important limitation

Official Zerodha docs say the `access_token` expires at `6 AM` the next day, and `refresh_token` is only available to certain approved platforms. So for a normal personal app, daily silent token auto-renew is not supported.

That means this app can be fully live for quotes and orders, but you should plan for a daily morning login step before market use.

## ATO order model

ATO is created through Zerodha's Alerts API with `type=ato`. The app sends the selected symbol, condition price, and a linked one-item order basket. When Zerodha's alert triggers, Zerodha places the linked market order with market protection.

## Stack

- Node.js + Express backend (`server/`)
- Official `kiteconnect` Node SDK for Kite Connect auth, quotes, orders and alerts
- React 19 + Vite frontend (`src/`)
- File-backed runtime store for triggers and session state

## Notes

Trading automation is infrastructure, not financial advice. No profit guarantees. Test in dry-run/paper before going live, and understand that live triggers place real orders on your Zerodha account.

## Author

Built by [Jayadev Rana](https://jayadevrana.in) — @bluealgocapital · [YouTube](https://www.youtube.com/@jayadevrana3657) · [GitHub](https://github.com/jayadevrana)
