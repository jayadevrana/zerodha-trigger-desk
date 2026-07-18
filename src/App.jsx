import { startTransition, useDeferredValue, useEffect, useState } from "react";

const apiBase = import.meta.env.VITE_API_BASE || "";

function formatMoney(value) {
  if (typeof value !== "number") {
    return "--";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatTime(value) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) {
    return "--";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function triggerStateLabel(trigger) {
  if (trigger.active) {
    return "Armed";
  }

  if (trigger.firedSide) {
    return "Fired";
  }

  return "Paused";
}

function App() {
  const [meta, setMeta] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [query, setQuery] = useState("RELIANCE");
  const [suggestions, setSuggestions] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState("RELIANCE");
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [buyPrice, setBuyPrice] = useState("2010");
  const [sellPrice, setSellPrice] = useState("1990");
  const [atoPrice, setAtoPrice] = useState("2010");
  const [atoSide, setAtoSide] = useState("BUY");
  const [atoOperator, setAtoOperator] = useState(">=");
  const [quantity, setQuantity] = useState("1");
  const [product, setProduct] = useState("CNC");
  const [requestToken, setRequestToken] = useState("");
  const [manualAccessToken, setManualAccessToken] = useState("");
  const [statusMessage, setStatusMessage] = useState(
    "Live Zerodha backend is ready. Add credentials, whitelist the server IP, and complete the morning login.",
  );
  const [submitting, setSubmitting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const prices = snapshot?.prices ?? {};
  const selectedInstrument = suggestions.find((item) => item.symbol === selectedSymbol);
  const selectedPrice = prices[selectedSymbol] ?? selectedQuote;
  const topMovers = Object.values(prices)
    .filter((price) => typeof price.ltp === "number" && typeof price.open === "number")
    .map((price) => ({
      ...price,
      netChange: price.ltp - price.open,
    }))
    .sort((left, right) => Math.abs(right.netChange) - Math.abs(left.netChange))
    .slice(0, 6);

  async function loadMeta() {
    try {
      const response = await fetch(`${apiBase}/api/meta`);
      const payload = await response.json();
      setMeta(payload);
    } catch {
      setStatusMessage("Meta endpoint could not be loaded.");
    }
  }

  useEffect(() => {
    void loadMeta();
    const interval = window.setInterval(() => {
      void loadMeta();
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const eventSource = new EventSource(`${apiBase}/api/stream`);

    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      startTransition(() => {
        setSnapshot(payload);
      });
    };

    eventSource.onerror = () => {
      setStatusMessage("Live broker stream disconnected. Refresh the page after the backend starts again.");
    };

    return () => eventSource.close();
  }, []);

  useEffect(() => {
    fetch(`${apiBase}/api/symbols?q=${encodeURIComponent(deferredQuery)}`)
      .then((response) => response.json())
      .then((payload) => {
        setSuggestions(payload.data);
      })
      .catch(() => {
        setSuggestions([]);
      });
  }, [deferredQuery]);

  useEffect(() => {
    let ignore = false;

    async function loadSelectedQuote() {
      try {
        const response = await fetch(`${apiBase}/api/selected/${encodeURIComponent(selectedSymbol)}`);
        const payload = await response.json();

        if (ignore) {
          return;
        }

        setSelectedQuote(payload.live);

        const referenceOpen = payload.live?.open ?? payload.instrument?.openPrice;
        if (referenceOpen && !buyPrice) {
          setBuyPrice(String(Math.round(referenceOpen + 10)));
        }
        if (referenceOpen && !sellPrice) {
          setSellPrice(String(Math.round(referenceOpen - 10)));
        }
      } catch {
        if (!ignore) {
          setSelectedQuote(null);
        }
      }
    }

    void loadSelectedQuote();
    const interval = window.setInterval(() => {
      void loadSelectedQuote();
    }, 4000);

    return () => {
      ignore = true;
      window.clearInterval(interval);
    };
  }, [selectedSymbol, buyPrice, sellPrice]);

  async function armTrigger(event) {
    event.preventDefault();
    setSubmitting(true);

    try {
      const response = await fetch(`${apiBase}/api/triggers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: query.trim().toUpperCase(),
          quantity: Number(quantity),
          buyPrice,
          sellPrice,
          product,
        }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Unable to arm trigger");
      }

      setStatusMessage(
        `${selectedSymbol} armed. The first matching side will send a Zerodha MARKET order.`,
      );
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function placeAtoOrder() {
    setSubmitting(true);

    try {
      const response = await fetch(`${apiBase}/api/ato-alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: selectedSymbol,
          side: atoSide,
          operator: atoOperator,
          triggerPrice: atoPrice,
          quantity: Number(quantity),
          product,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Unable to create ATO");
      }

      setStatusMessage(
        `ATO created for ${selectedSymbol}. Zerodha will place the linked ${atoSide} market order when the alert triggers.`,
      );
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function changeAtoSide(nextSide) {
    setAtoSide(nextSide);
    setAtoOperator(nextSide === "BUY" ? ">=" : "<=");
    setAtoPrice(nextSide === "BUY" ? buyPrice : sellPrice);
  }

  function handleSymbolQueryChange(value) {
    const normalized = value.toUpperCase();
    setQuery(normalized);
    setSelectedSymbol(normalized.trim() || "RELIANCE");
  }

  async function connectWithRequestToken() {
    if (!requestToken.trim()) {
      setStatusMessage("Paste the request_token from the Zerodha callback or use the callback URL directly.");
      return;
    }

    setConnecting(true);

    try {
      const response = await fetch(`${apiBase}/api/zerodha/session/request-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestToken: requestToken.trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Unable to exchange request token");
      }

      setRequestToken("");
      setStatusMessage("Zerodha session connected. Live triggers can place real orders now.");
      await loadMeta();
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setConnecting(false);
    }
  }

  async function connectWithAccessToken() {
    if (!manualAccessToken.trim()) {
      setStatusMessage("Paste a valid access_token first.");
      return;
    }

    setConnecting(true);

    try {
      const response = await fetch(`${apiBase}/api/zerodha/session/access-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken: manualAccessToken.trim(),
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Unable to verify access token");
      }

      setManualAccessToken("");
      setStatusMessage("Access token stored and verified against Zerodha.");
      await loadMeta();
    } catch (error) {
      setStatusMessage(error.message);
    } finally {
      setConnecting(false);
    }
  }

  async function clearSession() {
    await fetch(`${apiBase}/api/zerodha/session`, {
      method: "DELETE",
    });
    setStatusMessage("Stored Zerodha session cleared. The app will not place orders until you log in again.");
    await loadMeta();
  }

  async function toggleTrigger(id) {
    await fetch(`${apiBase}/api/triggers/${id}/toggle`, {
      method: "PATCH",
    });
  }

  async function removeTrigger(id) {
    await fetch(`${apiBase}/api/triggers/${id}`, {
      method: "DELETE",
    });
  }

  function chooseSuggestion(suggestion) {
    setQuery(suggestion.symbol);
    setSelectedSymbol(suggestion.symbol);

    const open = prices[suggestion.symbol]?.open ?? selectedQuote?.open ?? suggestion.openPrice;
    if (open) {
      setBuyPrice(String(Math.round(open + 10)));
      setSellPrice(String(Math.round(open - 10)));
      setAtoPrice(String(Math.round(open + (atoSide === "BUY" ? 10 : -10))));
    }
  }

  const zerodha = meta?.zerodha;
  const account = snapshot?.account || meta?.account;
  const canOpenLogin = Boolean(zerodha?.loginUrl);

  return (
    <div className="shell">
      <div className="background-orb orb-a" />
      <div className="background-orb orb-b" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Zerodha Trigger Desk</p>
          <h1>Real-order trigger app wired for Zerodha sessions, live quotes, and market order placement.</h1>
        </div>

        <div className="header-meta">
          <span className="status-pill">Backend-only broker model</span>
          <span className={`status-pill ${zerodha?.authenticated ? "status-live" : ""}`}>
            {zerodha?.authenticated ? "Session connected" : "Login required"}
          </span>
        </div>
      </header>

      <main className="workspace">
        <section className="search-panel">
          <div className="panel-headline">
            <p className="eyebrow">Symbol Search</p>
            <p className="panel-copy">
              Search across the backend Nifty 50 universe, then arm a one-shot trigger that sends a real
              Zerodha market order on the first matching side.
            </p>
          </div>

          <form className="trigger-form" onSubmit={armTrigger}>
            <label className="field">
              <span>Search symbol</span>
              <input
                type="text"
                value={query}
                onChange={(event) => handleSymbolQueryChange(event.target.value)}
                placeholder="Type RELIANCE, SBIN, TCS"
                autoComplete="off"
              />
            </label>

            <div className="suggestions">
              {suggestions.map((suggestion) => {
                const selected = suggestion.symbol === selectedSymbol;
                return (
                  <button
                    key={suggestion.symbol}
                    className={`suggestion-row ${selected ? "selected" : ""}`}
                    type="button"
                    onClick={() => chooseSuggestion(suggestion)}
                  >
                    <span>
                      <strong>{suggestion.symbol}</strong>
                      <small>{suggestion.name}</small>
                    </span>
                    <small>{suggestion.industry}</small>
                  </button>
                );
              })}
            </div>

            <div className="input-grid">
              <label className="field">
                <span>Buy price</span>
                <input
                  type="number"
                  step="0.05"
                  value={buyPrice}
                  onChange={(event) => setBuyPrice(event.target.value)}
                  placeholder="2010"
                />
              </label>

              <label className="field">
                <span>Sell price</span>
                <input
                  type="number"
                  step="0.05"
                  value={sellPrice}
                  onChange={(event) => setSellPrice(event.target.value)}
                  placeholder="1990"
                />
              </label>
            </div>

            <div className="input-grid">
              <label className="field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>

              <label className="field">
                <span>Product</span>
                <select value={product} onChange={(event) => setProduct(event.target.value)}>
                  <option value="CNC">CNC</option>
                  <option value="MIS">MIS</option>
                </select>
              </label>
            </div>

            <div className="action-row">
              <button className="primary-button" disabled={submitting} type="submit">
                {submitting ? "Arming..." : "Arm live trigger"}
              </button>
            </div>
          </form>

          <div className="ato-panel">
            <div className="activity-header">
              <div>
                <p className="eyebrow">ATO</p>
                <h3>Alert-triggered order</h3>
              </div>
              <span className="mini-pill idle">Zerodha alert</span>
            </div>

            <div className="input-grid">
              <label className="field">
                <span>Side</span>
                <select value={atoSide} onChange={(event) => changeAtoSide(event.target.value)}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>

              <label className="field">
                <span>Condition</span>
                <select value={atoOperator} onChange={(event) => setAtoOperator(event.target.value)}>
                  <option value=">=">LTP &gt;= price</option>
                  <option value="<=">LTP &lt;= price</option>
                  <option value=">">LTP &gt; price</option>
                  <option value="<">LTP &lt; price</option>
                  <option value="==">LTP == price</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span>ATO trigger price</span>
              <input
                type="number"
                step="0.05"
                value={atoPrice}
                onChange={(event) => setAtoPrice(event.target.value)}
                placeholder="2010"
              />
            </label>

            <button className="ghost-button ato-button" disabled={submitting} onClick={placeAtoOrder} type="button">
              {submitting ? "Creating ATO..." : "Place ATO order"}
            </button>
          </div>
        </section>

        <section className="market-panel">
          <div className="auth-card">
            <div className="auth-row">
              <div>
                <p className="eyebrow">Connection</p>
                <h3>Zerodha session gate</h3>
              </div>
              <span className={`mini-pill ${zerodha?.authenticated ? "buy" : "idle"}`}>
                {zerodha?.authenticated ? "Connected" : "Not connected"}
              </span>
            </div>

            <div className="auth-grid">
              <div>
                <span className="auth-label">Current public IPv4</span>
                <strong>{meta?.publicIp || "--"}</strong>
              </div>
              <div>
                <span className="auth-label">Suggested callback URL</span>
                <strong className="stack-text">{meta?.suggestedRedirectUrl || "--"}</strong>
              </div>
              <div>
                <span className="auth-label">Last login</span>
                <strong>{formatDateTime(zerodha?.loginTime)}</strong>
              </div>
              <div>
                <span className="auth-label">Token expires</span>
                <strong>{formatDateTime(zerodha?.expiresAt)}</strong>
              </div>
              <div>
                <span className="auth-label">Name</span>
                <strong>{account?.profile?.userName || zerodha?.userName || "--"}</strong>
              </div>
              <div>
                <span className="auth-label">Kite ID</span>
                <strong>{account?.profile?.userId || zerodha?.userId || "--"}</strong>
              </div>
              <div>
                <span className="auth-label">Equity funds</span>
                <strong>{formatMoney(account?.equity?.net)}</strong>
              </div>
              <div>
                <span className="auth-label">Available cash</span>
                <strong>{formatMoney(account?.equity?.availableCash)}</strong>
              </div>
            </div>

            <p className="auth-note">
              Daily silent auto-renew is not supported for a normal personal app. Use the official Zerodha
              login each morning, then this server stores the fresh token and keeps the trigger engine live.
            </p>

            <div className="action-row">
              <a
                className={`primary-link ${canOpenLogin ? "" : "disabled-link"}`}
                href={canOpenLogin ? zerodha.loginUrl : "#"}
                rel="noreferrer"
                target="_blank"
              >
                Open Zerodha login
              </a>
              <button className="ghost-button" onClick={clearSession} type="button">
                Clear session
              </button>
            </div>

            <div className="field-stack">
              <label className="field">
                <span>Paste request_token after login</span>
                <input
                  type="text"
                  value={requestToken}
                  onChange={(event) => setRequestToken(event.target.value)}
                  placeholder="request_token from redirect URL"
                />
              </label>
              <button className="ghost-button" onClick={connectWithRequestToken} type="button">
                {connecting ? "Connecting..." : "Exchange request token"}
              </button>
            </div>

            <div className="field-stack">
              <label className="field">
                <span>Or paste access_token manually</span>
                <input
                  type="text"
                  value={manualAccessToken}
                  onChange={(event) => setManualAccessToken(event.target.value)}
                  placeholder="access_token"
                />
              </label>
              <button className="ghost-button" onClick={connectWithAccessToken} type="button">
                {connecting ? "Verifying..." : "Store access token"}
              </button>
            </div>
          </div>

          <div className="ticker-ribbon">
            {topMovers.map((item) => {
              const positive = item.netChange >= 0;
              return (
                <div className="ticker-chip" key={item.symbol}>
                  <span>{item.symbol}</span>
                  <strong>{formatMoney(item.ltp)}</strong>
                  <small className={positive ? "positive" : "negative"}>
                    {positive ? "+" : ""}
                    {item.netChange.toFixed(2)}
                  </small>
                </div>
              );
            })}

            {!topMovers.length && (
              <div className="ticker-chip empty-chip">
                <span>Waiting for live watchlist quotes</span>
                <strong>Log in and arm a symbol</strong>
              </div>
            )}
          </div>

          <div className="focus-sheet">
            <div>
              <p className="eyebrow">Focused instrument</p>
              <h2>{selectedSymbol}</h2>
              <p className="instrument-name">
                {selectedInstrument?.name || selectedQuote?.name || "Choose a symbol"}
              </p>
            </div>

            <div className="price-stack">
              <span className="ltp">{formatMoney(selectedPrice?.ltp)}</span>
              <span className="timestamp">Updated {formatTime(selectedPrice?.updatedAt)}</span>
            </div>
          </div>

          <div className="metric-strip">
            <div>
              <span>Open</span>
              <strong>{formatMoney(selectedPrice?.open)}</strong>
            </div>
            <div>
              <span>High</span>
              <strong>{formatMoney(selectedPrice?.high)}</strong>
            </div>
            <div>
              <span>Low</span>
              <strong>{formatMoney(selectedPrice?.low)}</strong>
            </div>
            <div>
              <span>Trigger logic</span>
              <strong>BUY if LTP ≥ buy, SELL if LTP ≤ sell, first side only</strong>
            </div>
          </div>

          <div className="status-line">{statusMessage}</div>

          <div className="docs-note">
            <p>
              Current docs summary: official backend auth only, official Node SDK wired, daily login still
              required, and market orders are sent with market protection enabled.
            </p>
          </div>
        </section>

        <section className="activity-panel">
          <div className="activity-header">
            <div>
              <p className="eyebrow">Armed triggers</p>
              <h3>Execution monitor</h3>
            </div>
            <small>{snapshot?.triggers?.length || 0} total records</small>
          </div>

          <div className="trigger-list">
            {(snapshot?.triggers || []).map((trigger) => (
              <article className="trigger-row" key={trigger.id}>
                <div>
                  <div className="trigger-title">
                    <strong>{trigger.symbol}</strong>
                    <span className={`mini-pill ${trigger.active ? "armed" : "idle"}`}>
                      {triggerStateLabel(trigger)}
                    </span>
                  </div>
                  <p>
                    Qty {trigger.quantity} | BUY {trigger.buyPrice ?? "--"} | SELL {trigger.sellPrice ?? "--"}
                  </p>
                  <small>{trigger.lastEvent}</small>
                </div>

                <div className="inline-actions">
                  <button type="button" onClick={() => toggleTrigger(trigger.id)}>
                    {trigger.active ? "Pause" : "Re-arm"}
                  </button>
                  <button type="button" onClick={() => removeTrigger(trigger.id)}>
                    Remove
                  </button>
                </div>
              </article>
            ))}

            {!snapshot?.triggers?.length && (
              <div className="empty-state">No triggers yet. Search a symbol, connect Zerodha, and arm one.</div>
            )}
          </div>

          <div className="activity-header orders-head">
            <div>
              <p className="eyebrow">ATO alerts</p>
              <h3>Zerodha alert basket</h3>
            </div>
          </div>

          <div className="order-list">
            {(snapshot?.atoAlerts || []).map((alert) => (
              <article className="order-row" key={alert.id}>
                <div>
                  <div className="trigger-title">
                    <strong>{alert.symbol}</strong>
                    <span className={`mini-pill ${alert.side === "buy" ? "buy" : "sell"}`}>
                      {alert.transactionType}
                    </span>
                  </div>
                  <p>
                    LTP {alert.operator} {formatMoney(alert.triggerPrice)} | Qty {alert.quantity} | {alert.status}
                  </p>
                  <small>{formatTime(alert.createdAt)}</small>
                </div>
                <code>{alert.uuid || alert.id}</code>
              </article>
            ))}

            {!snapshot?.atoAlerts?.length && (
              <div className="empty-state">
                ATO alerts will appear here after Zerodha accepts the linked alert basket.
              </div>
            )}
          </div>

          <div className="activity-header orders-head">
            <div>
              <p className="eyebrow">Order tape</p>
              <h3>Broker order log</h3>
            </div>
          </div>

          <div className="order-list">
            {(snapshot?.orders || []).map((order) => (
              <article className="order-row" key={order.id}>
                <div>
                  <div className="trigger-title">
                    <strong>{order.symbol}</strong>
                    <span className={`mini-pill ${order.side === "buy" ? "buy" : "sell"}`}>
                      {order.transactionType}
                    </span>
                  </div>
                  <p>
                    {formatMoney(order.executionPrice)} | Qty {order.quantity} | {order.status}
                  </p>
                  <small>{formatTime(order.placedAt)}</small>
                </div>
                <code>{order.id}</code>
              </article>
            ))}

            {!snapshot?.orders?.length && (
              <div className="empty-state">
                Orders will appear here the moment a live Zerodha quote crosses your trigger.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
