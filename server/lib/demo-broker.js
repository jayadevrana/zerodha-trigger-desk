import { randomUUID } from "node:crypto";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function buildZerodhaPayload(trigger, transactionType) {
  return {
    tradingsymbol: trigger.symbol,
    exchange: "NSE",
    transaction_type: transactionType,
    order_type: "MARKET",
    quantity: trigger.quantity,
    product: trigger.product,
    validity: "DAY",
    variety: "regular",
    market_protection: -1,
    tag: `demo-${trigger.id}`,
  };
}

export function createDemoBroker(universe) {
  const subscribers = new Set();
  const triggers = [];
  const orders = [];
  const prices = new Map();

  for (const stock of universe) {
    prices.set(stock.symbol, {
      symbol: stock.symbol,
      name: stock.name,
      industry: stock.industry,
      open: stock.openPrice,
      high: stock.openPrice,
      low: stock.openPrice,
      ltp: stock.openPrice,
      previousClose: roundMoney(stock.openPrice * 0.995),
      updatedAt: new Date().toISOString(),
    });
  }

  function emitState() {
    const payload = JSON.stringify(getSnapshot());
    for (const subscriber of subscribers) {
      subscriber(payload);
    }
  }

  function placeOrder(trigger, side) {
    const priceSnapshot = prices.get(trigger.symbol);
    const transactionType = side === "buy" ? "BUY" : "SELL";
    const now = new Date().toISOString();
    const order = {
      id: `DEMO-${Date.now()}-${randomUUID().slice(0, 6).toUpperCase()}`,
      triggerId: trigger.id,
      symbol: trigger.symbol,
      name: trigger.name,
      side,
      transactionType,
      quantity: trigger.quantity,
      executionPrice: priceSnapshot.ltp,
      status: "COMPLETE",
      placedAt: now,
      mode: "demo",
      zerodhaPayload: buildZerodhaPayload(trigger, transactionType),
    };

    orders.unshift(order);
    orders.splice(20);
    return order;
  }

  function evaluateTriggers() {
    for (const trigger of triggers) {
      if (!trigger.active) {
        continue;
      }

      const livePrice = prices.get(trigger.symbol)?.ltp;
      if (!livePrice) {
        continue;
      }

      if (
        trigger.buyPrice !== null &&
        !trigger.buyTriggered &&
        livePrice >= trigger.buyPrice
      ) {
        trigger.buyTriggered = true;
        trigger.lastEvent = `BUY market order fired at ${livePrice.toFixed(2)}`;
        placeOrder(trigger, "buy");
      }

      if (
        trigger.sellPrice !== null &&
        !trigger.sellTriggered &&
        livePrice <= trigger.sellPrice
      ) {
        trigger.sellTriggered = true;
        trigger.lastEvent = `SELL market order fired at ${livePrice.toFixed(2)}`;
        placeOrder(trigger, "sell");
      }

      if (
        (trigger.buyPrice === null || trigger.buyTriggered) &&
        (trigger.sellPrice === null || trigger.sellTriggered)
      ) {
        trigger.active = false;
      }
    }
  }

  function tick() {
    for (const [symbol, price] of prices.entries()) {
      const driftSeed = symbol.charCodeAt(0) % 7;
      const volatility = price.open < 1000 ? 6 : price.open < 3000 ? 14 : 32;
      const drift = (driftSeed - 3) * 0.06;
      const movement = (Math.random() - 0.5) * volatility + drift;
      const nextPrice = clamp(price.ltp + movement, price.open * 0.8, price.open * 1.2);

      price.ltp = roundMoney(nextPrice);
      price.high = roundMoney(Math.max(price.high, price.ltp));
      price.low = roundMoney(Math.min(price.low, price.ltp));
      price.updatedAt = new Date().toISOString();
      prices.set(symbol, price);
    }

    evaluateTriggers();
    emitState();
  }

  function subscribe(send) {
    subscribers.add(send);
    send(JSON.stringify(getSnapshot()));
    return () => subscribers.delete(send);
  }

  function getSnapshot() {
    return {
      brokerMode: "demo",
      prices: Object.fromEntries(prices.entries()),
      triggers,
      orders,
      updatedAt: new Date().toISOString(),
    };
  }

  function listTriggers() {
    return triggers;
  }

  function listOrders() {
    return orders;
  }

  function getPrice(symbol) {
    return prices.get(symbol) ?? null;
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
      buyTriggered: false,
      sellTriggered: false,
      createdAt: new Date().toISOString(),
      lastEvent: "Watching live demo prices",
    };

    triggers.unshift(trigger);
    evaluateTriggers();
    emitState();
    return trigger;
  }

  function toggleTrigger(id) {
    const trigger = triggers.find((item) => item.id === id);
    if (!trigger) {
      return null;
    }

    trigger.active = !trigger.active;
    trigger.lastEvent = trigger.active ? "Re-armed manually" : "Paused manually";
    if (trigger.active) {
      evaluateTriggers();
    }
    emitState();
    return trigger;
  }

  function removeTrigger(id) {
    const index = triggers.findIndex((item) => item.id === id);
    if (index === -1) {
      return false;
    }

    triggers.splice(index, 1);
    emitState();
    return true;
  }

  function reset() {
    triggers.length = 0;
    orders.length = 0;
    for (const [symbol, price] of prices.entries()) {
      price.high = price.open;
      price.low = price.open;
      price.ltp = price.open;
      price.previousClose = roundMoney(price.open * 0.995);
      price.updatedAt = new Date().toISOString();
      prices.set(symbol, price);
    }
    emitState();
  }

  return {
    addTrigger,
    getPrice,
    getSnapshot,
    listOrders,
    listTriggers,
    removeTrigger,
    reset,
    subscribe,
    tick,
    toggleTrigger,
  };
}
