import "dotenv/config";

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nifty50Universe, searchUniverse } from "./data/nifty50.js";
import { createZerodhaBroker } from "./lib/zerodha-broker.js";

const app = express();
const port = Number(process.env.PORT || 8787);

const broker = createZerodhaBroker({
  universe: nifty50Universe,
  config: {
    port,
    apiKey: process.env.ZERODHA_API_KEY || "",
    apiSecret: process.env.ZERODHA_API_SECRET || "",
    bootstrapAccessToken: process.env.ZERODHA_ACCESS_TOKEN || "",
    redirectUrl: process.env.ZERODHA_REDIRECT_URL || "",
    publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  },
});

await broker.initialise();

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFilePath), "..");
const distPath = path.join(projectRoot, "dist");

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    ok: true,
    mode: "zerodha",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/symbols", (request, response) => {
  response.json({
    data: searchUniverse(request.query.q || ""),
  });
});

app.get("/api/meta", (_request, response) => {
  response.json(broker.getMeta());
});

app.get("/api/state", (_request, response) => {
  response.json(broker.getSnapshot());
});

app.get("/api/stream", (request, response) => {
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();

  const unsubscribe = broker.subscribe((payload) => {
    response.write(`data: ${payload}\n\n`);
  });

  request.on("close", () => {
    unsubscribe();
    response.end();
  });
});

app.get(
  "/api/selected/:symbol",
  asyncRoute(async (request, response) => {
    const stock = nifty50Universe.find((item) => item.symbol === request.params.symbol);
    if (!stock) {
      response.status(404).json({ error: "Symbol not found" });
      return;
    }

    const live = await broker.getSelectedQuote(stock.symbol);

    response.json({
      instrument: stock,
      live,
    });
  }),
);

app.post("/api/triggers", (request, response) => {
  const { symbol, quantity, buyPrice, sellPrice, product = "MIS" } = request.body ?? {};
  const instrument = nifty50Universe.find((item) => item.symbol === symbol);

  if (!instrument) {
    response.status(400).json({ error: "Unknown symbol" });
    return;
  }

  const normalizedQuantity = Number(quantity || 1);
  const normalizedBuyPrice =
    buyPrice === "" || buyPrice === undefined || buyPrice === null ? null : Number(buyPrice);
  const normalizedSellPrice =
    sellPrice === "" || sellPrice === undefined || sellPrice === null ? null : Number(sellPrice);

  if (
    !Number.isInteger(normalizedQuantity) ||
    normalizedQuantity < 1 ||
    normalizedQuantity > 100000
  ) {
    response.status(400).json({ error: "Quantity must be a whole number between 1 and 100000" });
    return;
  }

  if (normalizedBuyPrice === null && normalizedSellPrice === null) {
    response
      .status(400)
      .json({ error: "Enter at least one price trigger to arm this symbol" });
    return;
  }

  const trigger = broker.addTrigger({
    symbol: instrument.symbol,
    name: instrument.name,
    quantity: normalizedQuantity,
    product,
    buyPrice: normalizedBuyPrice,
    sellPrice: normalizedSellPrice,
  });

  response.status(201).json({ data: trigger });
});

app.post(
  "/api/ato-alerts",
  asyncRoute(async (request, response) => {
    const {
      symbol,
      side = "BUY",
      operator = ">=",
      triggerPrice,
      quantity,
      product = "CNC",
    } = request.body ?? {};
    const normalizedSymbol = String(symbol || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9&.-]/g, "");
    const normalizedSide = String(side).toUpperCase();
    const normalizedOperator = String(operator);
    const normalizedTriggerPrice = Number(triggerPrice);
    const normalizedQuantity = Number(quantity || 1);

    if (!normalizedSymbol) {
      response.status(400).json({ error: "Enter a valid NSE equity symbol" });
      return;
    }

    if (!["BUY", "SELL"].includes(normalizedSide)) {
      response.status(400).json({ error: "ATO side must be BUY or SELL" });
      return;
    }

    if (![">=", "<=", ">", "<", "=="].includes(normalizedOperator)) {
      response.status(400).json({ error: "Unsupported ATO alert operator" });
      return;
    }

    if (!Number.isFinite(normalizedTriggerPrice) || normalizedTriggerPrice <= 0) {
      response.status(400).json({ error: "ATO trigger price must be greater than 0" });
      return;
    }

    if (
      !Number.isInteger(normalizedQuantity) ||
      normalizedQuantity < 1 ||
      normalizedQuantity > 100000
    ) {
      response.status(400).json({ error: "Quantity must be a whole number between 1 and 100000" });
      return;
    }

    const alert = await broker.createAtoAlert({
      symbol: normalizedSymbol,
      side: normalizedSide,
      operator: normalizedOperator,
      triggerPrice: normalizedTriggerPrice,
      quantity: normalizedQuantity,
      product,
    });

    response.status(201).json({ data: alert });
  }),
);

app.patch("/api/triggers/:id/toggle", (request, response) => {
  const trigger = broker.toggleTrigger(request.params.id);

  if (!trigger) {
    response.status(404).json({ error: "Trigger not found" });
    return;
  }

  response.json({ data: trigger });
});

app.delete("/api/triggers/:id", (request, response) => {
  const removed = broker.removeTrigger(request.params.id);

  if (!removed) {
    response.status(404).json({ error: "Trigger not found" });
    return;
  }

  response.status(204).end();
});

app.get("/api/zerodha/login-url", (_request, response) => {
  response.json({
    data: {
      loginUrl: broker.getMeta().zerodha.loginUrl,
    },
  });
});

app.post(
  "/api/zerodha/session/request-token",
  asyncRoute(async (request, response) => {
    const requestToken = String(request.body?.requestToken || "").trim();
    if (!requestToken) {
      response.status(400).json({ error: "requestToken is required" });
      return;
    }

    const session = await broker.setSessionFromRequestToken(requestToken);
    response.json({ data: session });
  }),
);

app.post(
  "/api/zerodha/session/access-token",
  asyncRoute(async (request, response) => {
    const accessToken = String(request.body?.accessToken || "").trim();
    if (!accessToken) {
      response.status(400).json({ error: "accessToken is required" });
      return;
    }

    const session = await broker.setManualAccessToken(accessToken);
    response.json({ data: session });
  }),
);

app.delete("/api/zerodha/session", (_request, response) => {
  broker.clearSession();
  response.status(204).end();
});

app.get(
  "/auth/zerodha/callback",
  asyncRoute(async (request, response) => {
    const requestToken = String(request.query.request_token || "").trim();
    const errorMessage = String(request.query.error || "").trim();

    if (errorMessage) {
      response.status(400).send(`
        <html><body style="font-family: sans-serif; padding: 24px;">
          <h2>Zerodha login failed</h2>
          <p>${errorMessage}</p>
        </body></html>
      `);
      return;
    }

    if (!requestToken) {
      response.status(400).send(`
        <html><body style="font-family: sans-serif; padding: 24px;">
          <h2>Missing request token</h2>
          <p>Zerodha did not send a request_token to this callback URL.</p>
        </body></html>
      `);
      return;
    }

    await broker.setSessionFromRequestToken(requestToken);

    response.send(`
      <html>
        <body style="font-family: sans-serif; padding: 24px;">
          <h2>Zerodha session connected</h2>
          <p>The access token has been stored on this server. You can close this tab and return to the app.</p>
          <p><a href="/">Open app</a></p>
        </body>
      </html>
    `);
  }),
);

app.use(express.static(distPath));

app.get("*", (_request, response, next) => {
  response.sendFile(path.join(distPath, "index.html"), (error) => {
    if (error) {
      next();
    }
  });
});

app.use((error, _request, response, _next) => {
  response.status(500).json({
    error: error?.message || "Internal server error",
  });
});

const server = app.listen(port, () => {
  console.log(`Zerodha Trigger Desk API listening on http://localhost:${port}`);
});

function shutdown() {
  broker.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
