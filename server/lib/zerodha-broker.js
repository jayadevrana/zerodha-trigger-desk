import { KiteConnect, KiteTicker } from "kiteconnect";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRuntimeStore } from "./runtime-store.js";
import { fetchPublicIpv4 } from "./public-ip.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const FOCUS_SYMBOL_TTL_MS = 10 * 60 * 1000;
const MAX_ORDER_HISTORY = 50;
const MAX_ATO_HISTORY = 50;

function nowIso() {
  return new Date().toISOString();
}

function instrumentKey(symbol) {
  return `NSE:${symbol}`;
}

function roundMoney(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Number(value.toFixed(2));
}

function normalizeEquitySymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9&.-]/g, "");
}

function computeNextSixAmIst(baseValue = nowIso()) {
  const baseMs = new Date(baseValue).getTime();
  const istMs = baseMs + IST_OFFSET_MS;
  const istDate = new Date(istMs);
  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth();
  const day = istDate.getUTCDate();

  let expiryMs = Date.UTC(year, month, day, 6, 0, 0) - IST_OFFSET_MS;
  if (baseMs >= expiryMs) {
    expiryMs += 24 * 60 * 60 * 1000;
  }

  return new Date(expiryMs).toISOString();
}

function normalizeError(error) {
  if (!error) {
    return "Unknown broker error";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  if (error.error_type && error.data) {
    return `${error.error_type}: ${error.data}`;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown broker error";
  }
}

function seedPrice(instrument) {
  if (!instrument) {
    return {
      symbol: "",
      name: "",
      industry: "NSE Equity",
      open: null,
      high: null,
      low: null,
      ltp: null,
      updatedAt: null,
    };
  }

  return {
    symbol: instrument.symbol,
    name: instrument.name,
    industry: instrument.industry,
    open: instrument.openPrice ?? null,
    high: instrument.openPrice ?? null,
    low: instrument.openPrice ?? null,
    ltp: null,
    updatedAt: null,
  };
}

export function createZerodhaBroker({ universe, config }) {
  const currentFilePath = fileURLToPath(import.meta.url);
  const projectRoot = path.resolve(path.dirname(currentFilePath), "..", "..");
  const runtimeStore = createRuntimeStore(path.join(projectRoot, "server", "state", "runtime.json"));
  const loadedState = runtimeStore.getState();

  const state = {
    session: loadedState.session,
    triggers: loadedState.triggers.map((trigger) => ({
      ...trigger,
      executing: false,
    })),
    orders: loadedState.orders,
    atoAlerts: loadedState.atoAlerts,
    account: null,
  };

  const subscribers = new Set();
  const prices = new Map();
  const instrumentTokens = new Map();
  const tokenToSymbol = new Map();
  const focusSymbols = new Map();
  const universeBySymbol = new Map(universe.map((item) => [item.symbol, item]));

  let publicIp = null;
  let ticker = null;
  let tickerConnected = false;
  let connectingTicker = false;
  let syncInFlight = false;
  let syncRequestedAgain = false;
  let lastBrokerError = null;
  let publicIpTimer = null;
  let focusCleanupTimer = null;
  let subscribedTokens = new Set();

  function persistTriggers() {
    runtimeStore.updateTriggers(
      state.triggers.map(({ executing, ...trigger }) => trigger),
    );
  }

  function persistOrders() {
    runtimeStore.updateOrders(state.orders);
  }

  function persistAtoAlerts() {
    runtimeStore.updateAtoAlerts(state.atoAlerts);
  }

  function emitState() {
    const payload = JSON.stringify(getSnapshot());
    for (const subscriber of subscribers) {
      subscriber(payload);
    }
  }

  function getSuggestedRedirectUrl() {
    if (config.redirectUrl) {
      return config.redirectUrl;
    }

    if (config.publicBaseUrl) {
      return `${config.publicBaseUrl.replace(/\/$/, "")}/auth/zerodha/callback`;
    }

    if (publicIp) {
      return `http://${publicIp}:${config.port}/auth/zerodha/callback`;
    }

    return null;
  }

  function createKiteClient(accessToken = state.session?.accessToken) {
    if (!config.apiKey) {
      throw new Error("ZERODHA_API_KEY is missing");
    }

    const client = new KiteConnect({
      api_key: config.apiKey,
    });

    if (accessToken) {
      client.setAccessToken(accessToken);
    }

    client.setSessionExpiryHook(() => {
      lastBrokerError = "Zerodha session expired. Log in again after token expiry.";
      tickerConnected = false;
      disconnectTicker();
      if (state.session) {
        state.session = {
          ...state.session,
          sessionExpired: true,
        };
        runtimeStore.updateSession(state.session);
      }
      emitState();
    });

    return client;
  }

  async function callKiteFormApi(endpoint, body) {
    if (!config.apiKey) {
      throw new Error("ZERODHA_API_KEY is missing");
    }

    if (!state.session?.accessToken) {
      throw new Error("Zerodha session is not connected");
    }

    const response = await fetch(`https://api.kite.trade${endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `token ${config.apiKey}:${state.session.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Kite-Version": "3",
      },
      body: new URLSearchParams(body),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status === "error") {
      const message =
        payload?.message ||
        payload?.error ||
        payload?.data?.message ||
        `Kite API request failed with HTTP ${response.status}`;
      throw new Error(message);
    }

    return payload?.data;
  }

  function getSessionSummary() {
    if (!state.session) {
      return {
        authenticated: false,
        dailyManualLoginRequired: true,
        silentAutoRenewSupported: false,
        expiresAt: null,
      };
    }

    return {
      authenticated: !state.session.sessionExpired,
      dailyManualLoginRequired: true,
      silentAutoRenewSupported: false,
      userId: state.session.userId || null,
      userName: state.session.userName || null,
      loginTime: state.session.loginTime || null,
      obtainedAt: state.session.obtainedAt || null,
      expiresAt: state.session.expiresAt || null,
      sessionExpired: Boolean(state.session.sessionExpired),
    };
  }

  async function refreshAccountSummary(client = createKiteClient()) {
    if (!state.session?.accessToken) {
      state.account = null;
      return null;
    }

    const [profile, margins] = await Promise.all([
      client.getProfile(),
      client.getMargins("equity"),
    ]);
    const equity = margins?.equity ?? margins;

    state.account = {
      profile: {
        userId: profile.user_id || null,
        userName: profile.user_name || null,
        userShortName: profile.user_shortname || null,
        email: profile.email || null,
        broker: profile.broker || null,
        exchanges: profile.exchanges || [],
        products: profile.products || [],
        orderTypes: profile.order_types || [],
      },
      equity: equity
        ? {
            enabled: Boolean(equity.enabled),
            net: roundMoney(equity.net),
            availableCash: roundMoney(equity.available?.cash),
            liveBalance: roundMoney(equity.available?.live_balance),
            openingBalance: roundMoney(equity.available?.opening_balance),
            collateral: roundMoney(equity.available?.collateral),
            utilised: roundMoney(equity.utilised?.debits),
          }
        : null,
      updatedAt: nowIso(),
    };

    emitState();
    return state.account;
  }

  function getWatchSymbols() {
    const watched = new Set();

    for (const trigger of state.triggers) {
      if (trigger.active) {
        watched.add(trigger.symbol);
      }
    }

    const cutoff = Date.now() - FOCUS_SYMBOL_TTL_MS;
    for (const [symbol, touchedAt] of focusSymbols.entries()) {
      if (touchedAt >= cutoff) {
        watched.add(symbol);
      }
    }

    return [...watched];
  }

  function cleanupFocusSymbols() {
    const cutoff = Date.now() - FOCUS_SYMBOL_TTL_MS;
    let changed = false;

    for (const [symbol, touchedAt] of focusSymbols.entries()) {
      if (touchedAt < cutoff) {
        focusSymbols.delete(symbol);
        changed = true;
      }
    }

    if (changed) {
      void syncSubscriptions();
    }
  }

  function upsertPrice(symbol, partialPrice) {
    const instrument = universeBySymbol.get(symbol);
    const current = prices.get(symbol) || seedPrice(instrument);
    prices.set(symbol, {
      ...current,
      ...partialPrice,
      symbol,
      name: instrument?.name || current.name,
      industry: instrument?.industry || current.industry,
    });
  }

  async function refreshPublicIp() {
    publicIp = await fetchPublicIpv4();
    emitState();
  }

  async function validatePersistedSession() {
    if (!state.session?.accessToken) {
      return;
    }

    if (state.session.expiresAt && new Date(state.session.expiresAt) <= new Date()) {
      state.session = null;
      runtimeStore.updateSession(null);
      emitState();
      return;
    }

    try {
      const client = createKiteClient(state.session.accessToken);
      const profile = await client.getProfile();
      state.session = {
        ...state.session,
        userId: profile.user_id || state.session.userId,
        userName: profile.user_name || state.session.userName,
        sessionExpired: false,
      };
      runtimeStore.updateSession(state.session);
      await refreshAccountSummary(client);
      await connectTickerIfPossible();
      await syncSubscriptions();
      await refreshQuotes(getWatchSymbols());
      await evaluateTriggers();
    } catch (error) {
      lastBrokerError = normalizeError(error);
      state.session = null;
      runtimeStore.updateSession(null);
      emitState();
    }
  }

  async function resolveTokens(symbols) {
    const missingSymbols = symbols.filter((symbol) => !instrumentTokens.has(symbol));
    if (!missingSymbols.length || !state.session?.accessToken) {
      return;
    }

    const client = createKiteClient();
    const response = await client.getLTP(missingSymbols.map(instrumentKey));

    for (const symbol of missingSymbols) {
      const key = instrumentKey(symbol);
      const quote = response[key];
      if (!quote) {
        continue;
      }

      instrumentTokens.set(symbol, quote.instrument_token);
      tokenToSymbol.set(quote.instrument_token, symbol);
      upsertPrice(symbol, {
        ltp: roundMoney(quote.last_price),
        updatedAt: nowIso(),
      });
    }
  }

  async function refreshQuotes(symbols) {
    if (!symbols.length || !state.session?.accessToken) {
      return;
    }

    const client = createKiteClient();
    const response = await client.getLTP(symbols.map(instrumentKey));

    for (const symbol of symbols) {
      const key = instrumentKey(symbol);
      const quote = response[key];
      if (!quote) {
        continue;
      }

      instrumentTokens.set(symbol, quote.instrument_token);
      tokenToSymbol.set(quote.instrument_token, symbol);

      const instrument = universeBySymbol.get(symbol);
      const previous = prices.get(symbol) || seedPrice(instrument);
      const ltp = roundMoney(quote.last_price);

      upsertPrice(symbol, {
        open: previous.open ?? instrument?.openPrice ?? ltp,
        high: roundMoney(Math.max(previous.high ?? ltp, ltp)),
        low: roundMoney(Math.min(previous.low ?? ltp, ltp)),
        ltp,
        updatedAt: nowIso(),
      });
    }

    emitState();
  }

  async function syncSubscriptions() {
    if (!tickerConnected || !ticker) {
      return;
    }

    if (syncInFlight) {
      syncRequestedAgain = true;
      return;
    }

    syncInFlight = true;

    try {
      do {
        syncRequestedAgain = false;
        const watchedSymbols = getWatchSymbols();
        await resolveTokens(watchedSymbols);

        const nextTokens = new Set(
          watchedSymbols
            .map((symbol) => instrumentTokens.get(symbol))
            .filter((token) => typeof token === "number"),
        );

        const currentTokens = new Set(subscribedTokens);

        const toUnsubscribe = [...currentTokens].filter((token) => !nextTokens.has(token));
        if (toUnsubscribe.length) {
          ticker.unsubscribe(toUnsubscribe);
          for (const token of toUnsubscribe) {
            subscribedTokens.delete(token);
          }
        }

        const toSubscribe = [...nextTokens].filter((token) => !currentTokens.has(token));
        if (toSubscribe.length) {
          ticker.subscribe(toSubscribe);
          ticker.setMode(ticker.modeFull, toSubscribe);
          for (const token of toSubscribe) {
            subscribedTokens.add(token);
          }
        }
      } while (syncRequestedAgain);
    } catch (error) {
      lastBrokerError = normalizeError(error);
      emitState();
    } finally {
      syncInFlight = false;
    }
  }

  async function connectTickerIfPossible() {
    if (!state.session?.accessToken || !config.apiKey || tickerConnected || connectingTicker) {
      return;
    }

    connectingTicker = true;

    try {
      ticker = new KiteTicker({
        api_key: config.apiKey,
        access_token: state.session.accessToken,
        reconnect: false,
      });

      ticker.on("connect", () => {
        tickerConnected = true;
        connectingTicker = false;
        lastBrokerError = null;
        subscribedTokens = new Set();
        void syncSubscriptions();
        emitState();
      });

      ticker.on("ticks", (ticks) => {
        for (const tick of ticks) {
          const symbol = tokenToSymbol.get(tick.instrument_token);
          if (!symbol) {
            continue;
          }

          const instrument = universeBySymbol.get(symbol);
          const current = prices.get(symbol) || seedPrice(instrument);
          const open = tick.ohlc?.open ?? current.open ?? instrument?.openPrice ?? null;
          const high = tick.ohlc?.high ?? current.high ?? tick.last_price ?? null;
          const low = tick.ohlc?.low ?? current.low ?? tick.last_price ?? null;
          const ltp = roundMoney(tick.last_price ?? current.ltp);

          upsertPrice(symbol, {
            open: roundMoney(open),
            high: roundMoney(high),
            low: roundMoney(low),
            ltp,
            updatedAt: nowIso(),
          });
        }

        void evaluateTriggers();
        emitState();
      });

      ticker.on("error", (error) => {
        lastBrokerError = normalizeError(error);
        emitState();
      });

      ticker.on("close", () => {
        tickerConnected = false;
        connectingTicker = false;
        subscribedTokens = new Set();
        emitState();
      });

      ticker.connect();
    } catch (error) {
      connectingTicker = false;
      lastBrokerError = normalizeError(error);
      emitState();
    }
  }

  function disconnectTicker() {
    try {
      ticker?.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    ticker = null;
    tickerConnected = false;
    connectingTicker = false;
    subscribedTokens = new Set();
  }

  function buildOrderPayload(trigger, side) {
    return {
      exchange: "NSE",
      tradingsymbol: trigger.symbol,
      transaction_type: side === "buy" ? "BUY" : "SELL",
      quantity: trigger.quantity,
      product: trigger.product,
      order_type: "MARKET",
      validity: "DAY",
      market_protection: -1,
      tag: `trigger-${trigger.id.slice(0, 18)}`,
    };
  }

  function buildAtoBasket(input, lastPrice) {
    return {
      name: `ato-${input.symbol.toLowerCase()}-${input.side.toLowerCase()}`,
      type: "alert",
      tags: ["trigger-desk"],
      items: [
        {
          type: "insert",
          tradingsymbol: input.symbol,
          exchange: "NSE",
          weight: 10000,
          params: {
            transaction_type: input.side,
            product: input.product,
            order_type: "MARKET",
            validity: "DAY",
            validity_ttl: 1,
            quantity: input.quantity,
            price: 0,
            trigger_price: 0,
            disclosed_quantity: 0,
            last_price: lastPrice || 0,
            variety: "regular",
            tags: [],
            squareoff: 0,
            stoploss: 0,
            trailing_stoploss: 0,
            iceberg_legs: 0,
            market_protection: -1,
          },
        },
      ],
    };
  }

  async function createAtoAlert(input) {
    if (!state.session?.accessToken) {
      throw new Error("Connect Zerodha session before creating an ATO");
    }

    const symbol = normalizeEquitySymbol(input.symbol);
    if (!symbol) {
      throw new Error("Enter a valid NSE equity symbol");
    }

    const instrument = universeBySymbol.get(symbol);
    try {
      await refreshQuotes([symbol]);
    } catch (error) {
      lastBrokerError = normalizeError(error);
      emitState();
    }

    const lastPrice = prices.get(symbol)?.ltp ?? input.lastPrice ?? 0;
    const basket = buildAtoBasket({ ...input, symbol }, lastPrice);
    const alertName = `ATO ${input.side} ${symbol} ${input.operator} ${input.triggerPrice}`;

    const response = await callKiteFormApi("/alerts", {
      name: alertName,
      lhs_exchange: "NSE",
      lhs_tradingsymbol: symbol,
      lhs_attribute: "LastTradedPrice",
      operator: input.operator,
      rhs_type: "constant",
      type: "ato",
      rhs_constant: String(input.triggerPrice),
      basket: JSON.stringify(basket),
    });

    const alert = {
      id: response?.uuid || randomUUID(),
      uuid: response?.uuid || null,
      symbol,
      name: instrument?.name || symbol,
      side: input.side.toLowerCase(),
      transactionType: input.side,
      quantity: input.quantity,
      product: input.product,
      operator: input.operator,
      triggerPrice: input.triggerPrice,
      orderType: "MARKET",
      status: response?.status || "enabled",
      createdAt: nowIso(),
      mode: "zerodha-ato",
    };

    state.atoAlerts.unshift(alert);
    state.atoAlerts = state.atoAlerts.slice(0, MAX_ATO_HISTORY);
    persistAtoAlerts();
    emitState();
    return alert;
  }

  async function executeMarketOrder(trigger, side) {
    if (trigger.executing || !state.session?.accessToken) {
      return;
    }

    trigger.executing = true;
    trigger.lastEvent = `Placing ${side.toUpperCase()} order...`;
    persistTriggers();
    emitState();

    const livePrice = prices.get(trigger.symbol)?.ltp ?? null;
    const payload = buildOrderPayload(trigger, side);

    try {
      const client = createKiteClient();
      const response = await client.placeOrder("regular", payload);

      trigger.executing = false;
      trigger.active = false;
      trigger.firedSide = side;
      trigger.lastEvent = `${side.toUpperCase()} order sent to Zerodha`;
      trigger.lastOrderId = response.order_id;

      state.orders.unshift({
        id: response.order_id,
        triggerId: trigger.id,
        symbol: trigger.symbol,
        name: trigger.name,
        side,
        transactionType: payload.transaction_type,
        quantity: trigger.quantity,
        executionPrice: livePrice,
        status: "PLACED",
        placedAt: nowIso(),
        mode: "zerodha",
      });
      state.orders = state.orders.slice(0, MAX_ORDER_HISTORY);

      persistTriggers();
      persistOrders();
      emitState();
    } catch (error) {
      const message = normalizeError(error);
      lastBrokerError = message;

      trigger.executing = false;
      trigger.active = false;
      trigger.lastEvent = `Order failed: ${message}`;

      state.orders.unshift({
        id: `FAILED-${randomUUID().slice(0, 8).toUpperCase()}`,
        triggerId: trigger.id,
        symbol: trigger.symbol,
        name: trigger.name,
        side,
        transactionType: payload.transaction_type,
        quantity: trigger.quantity,
        executionPrice: livePrice,
        status: "REJECTED",
        error: message,
        placedAt: nowIso(),
        mode: "zerodha",
      });
      state.orders = state.orders.slice(0, MAX_ORDER_HISTORY);

      persistTriggers();
      persistOrders();
      emitState();
    }
  }

  async function evaluateTriggers() {
    if (!state.session?.accessToken) {
      return;
    }

    for (const trigger of state.triggers) {
      if (!trigger.active || trigger.executing) {
        continue;
      }

      const livePrice = prices.get(trigger.symbol)?.ltp;
      if (typeof livePrice !== "number") {
        continue;
      }

      if (trigger.buyPrice !== null && livePrice >= trigger.buyPrice) {
        await executeMarketOrder(trigger, "buy");
        continue;
      }

      if (trigger.sellPrice !== null && livePrice <= trigger.sellPrice) {
        await executeMarketOrder(trigger, "sell");
      }
    }
  }

  function subscribe(send) {
    subscribers.add(send);
    send(JSON.stringify(getSnapshot()));
    return () => subscribers.delete(send);
  }

  function getSnapshot() {
    return {
      brokerMode: "zerodha",
      prices: Object.fromEntries(prices.entries()),
      triggers: state.triggers,
      orders: state.orders,
      atoAlerts: state.atoAlerts,
      account: state.account,
      brokerStatus: {
        connected: tickerConnected,
        connecting: connectingTicker,
        lastError: lastBrokerError,
      },
      updatedAt: nowIso(),
    };
  }

  function getMeta() {
    const session = getSessionSummary();
    let loginUrl = null;

    if (config.apiKey) {
      try {
        loginUrl = createKiteClient(null).getLoginURL();
      } catch {
        loginUrl = null;
      }
    }

    return {
      brokerMode: "zerodha",
      universeCount: universe.length,
      publicIp,
      suggestedRedirectUrl: getSuggestedRedirectUrl(),
      account: state.account,
      zerodha: {
        apiKeyConfigured: Boolean(config.apiKey),
        apiSecretConfigured: Boolean(config.apiSecret),
        loginUrl,
        ...session,
      },
      latestDocsSummary: {
        feed: "WebSocket is the recommended realtime quote channel",
        auth: "access_token expires at 6 AM the next day",
        appModel: "Daily manual login is still required for personal apps",
        ato: "ATO is available through the Alerts API with type=ato and a linked basket",
      },
    };
  }

  async function getSelectedQuote(symbol) {
    const instrument = universeBySymbol.get(symbol);
    if (!instrument) {
      return null;
    }

    focusSymbols.set(symbol, Date.now());

    if (state.session?.accessToken) {
      try {
        await refreshQuotes([symbol]);
        await connectTickerIfPossible();
        await syncSubscriptions();
      } catch (error) {
        lastBrokerError = normalizeError(error);
      }
    } else if (!prices.has(symbol)) {
      prices.set(symbol, seedPrice(instrument));
    }

    return prices.get(symbol) || seedPrice(instrument);
  }

  async function setSessionFromRequestToken(requestToken) {
    if (!config.apiSecret) {
      throw new Error("ZERODHA_API_SECRET is missing");
    }

    const client = createKiteClient(null);
    const response = await client.generateSession(requestToken, config.apiSecret);

    state.session = {
      apiKey: config.apiKey,
      accessToken: response.access_token,
      refreshToken: response.refresh_token || null,
      loginTime: response.login_time || nowIso(),
      obtainedAt: nowIso(),
      expiresAt: computeNextSixAmIst(response.login_time || nowIso()),
      userId: response.user_id || null,
      userName: response.user_name || null,
      sessionExpired: false,
    };

    runtimeStore.updateSession(state.session);
    lastBrokerError = null;
    await refreshAccountSummary(createKiteClient(response.access_token));
    await connectTickerIfPossible();
    await syncSubscriptions();
    await refreshQuotes(getWatchSymbols());
    await evaluateTriggers();
    emitState();
    return getSessionSummary();
  }

  async function setManualAccessToken(accessToken) {
    const client = createKiteClient(accessToken);
    const profile = await client.getProfile();

    state.session = {
      apiKey: config.apiKey,
      accessToken,
      refreshToken: null,
      loginTime: nowIso(),
      obtainedAt: nowIso(),
      expiresAt: computeNextSixAmIst(nowIso()),
      userId: profile.user_id || null,
      userName: profile.user_name || null,
      sessionExpired: false,
    };

    runtimeStore.updateSession(state.session);
    lastBrokerError = null;
    await refreshAccountSummary(client);
    await connectTickerIfPossible();
    await syncSubscriptions();
    await refreshQuotes(getWatchSymbols());
    await evaluateTriggers();
    emitState();
    return getSessionSummary();
  }

  function clearSession() {
    disconnectTicker();
    state.session = null;
    state.account = null;
    runtimeStore.updateSession(null);
    emitState();
  }

  function addTrigger(input) {
    const trigger = {
      id: randomUUID(),
      symbol: input.symbol,
      name: input.name,
      quantity: input.quantity,
      product: input.product,
      buyPrice: input.buyPrice,
      sellPrice: input.sellPrice,
      active: true,
      firedSide: null,
      createdAt: nowIso(),
      lastEvent: state.session?.accessToken
        ? "Armed. Waiting for live Zerodha ticks."
        : "Armed. Waiting for Zerodha login and live quotes.",
    };

    state.triggers.unshift(trigger);
    persistTriggers();
    focusSymbols.set(trigger.symbol, Date.now());
    void connectTickerIfPossible();
    void syncSubscriptions();
    void evaluateTriggers();
    emitState();
    return trigger;
  }

  function toggleTrigger(id) {
    const trigger = state.triggers.find((item) => item.id === id);
    if (!trigger) {
      return null;
    }

    if (trigger.active) {
      trigger.active = false;
      trigger.lastEvent = "Paused manually";
    } else {
      trigger.active = true;
      trigger.firedSide = null;
      trigger.lastEvent = "Re-armed manually";
      focusSymbols.set(trigger.symbol, Date.now());
      void connectTickerIfPossible();
      void syncSubscriptions();
      void evaluateTriggers();
    }

    persistTriggers();
    emitState();
    return trigger;
  }

  function removeTrigger(id) {
    const index = state.triggers.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }

    state.triggers.splice(index, 1);
    persistTriggers();
    void syncSubscriptions();
    emitState();
    return true;
  }

  async function initialise() {
    await refreshPublicIp();
    await validatePersistedSession();

    if (!state.session?.accessToken && config.bootstrapAccessToken) {
      try {
        await setManualAccessToken(config.bootstrapAccessToken);
      } catch (error) {
        lastBrokerError = normalizeError(error);
        emitState();
      }
    }

    publicIpTimer = setInterval(() => {
      void refreshPublicIp();
    }, 10 * 60 * 1000);

    focusCleanupTimer = setInterval(() => {
      cleanupFocusSymbols();
    }, 60 * 1000);
  }

  function close() {
    disconnectTicker();
    clearInterval(publicIpTimer);
    clearInterval(focusCleanupTimer);
  }

  return {
    addTrigger,
    clearSession,
    close,
    createAtoAlert,
    getMeta,
    getSelectedQuote,
    getSnapshot,
    initialise,
    removeTrigger,
    setManualAccessToken,
    setSessionFromRequestToken,
    subscribe,
    toggleTrigger,
  };
}
