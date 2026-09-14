/*!
 * SuperCool Analytics
 *
 * Privacy-friendly usage analytics for websites built with SuperCool.
 * Records anonymous page views and site-defined events. No third-party
 * cookies, no cross-site tracking.
 *
 * Public API:
 *   window.supercool.track(name, props)  // record a custom event
 *
 * (c) SuperCool. All rights reserved.
 */
(function () {
  "use strict";
  if (window.__supercool_events__) return;
  window.__supercool_events__ = true;

  var ENDPOINT = "https://events.supercool.com/event"; /* @endpoint */
  var USER_TTL = 30 * 24 * 60 * 60 * 1000;  // 30 days of inactivity
  var SESSION_TTL = 30 * 60 * 1000;         // 30 minutes of inactivity
  var DEDUP_MS = 500;                        // ignore SPA double-fires

  function now() { return Date.now(); }
  function uuid() {
    return now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
  function get(k) {
    try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; }
  }
  function set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  // Identity with inactivity TTLs (new vs returning + session duration both
  // depend on these expiring correctly).
  function ident(key, ttl) {
    var rec = get(key);
    if (!rec || !rec.id || now() - (rec.at || 0) > ttl) {
      rec = { id: uuid(), at: now() };
    }
    rec.at = now();
    set(key, rec);
    return rec.id;
  }

  function touch() {
    var u = get("sc_user"); if (u) { u.at = now(); set("sc_user", u); }
    var s = get("sc_session"); if (s) { s.at = now(); set("sc_session", s); }
  }
  ["click", "scroll", "keydown", "touchstart"].forEach(function (evt) {
    window.addEventListener(evt, touch, { passive: true });
  });

  function cleanProps(props) {
    if (!props || typeof props !== "object") return undefined;
    var out = {};
    var count = 0;
    for (var key in props) {
      if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
      if (count >= 12) break;
      var val = props[key];
      var t = typeof val;
      if (t === "string") out[String(key).slice(0, 40)] = val.slice(0, 200);
      else if (t === "number" || t === "boolean") out[String(key).slice(0, 40)] = val;
      else continue;
      count++;
    }
    return count ? out : undefined;
  }

  function send(eventName, props) {
    try {
      var qs = new URLSearchParams(location.search);
      var payload = {
        event: eventName,
        props: cleanProps(props),
        url: location.href,
        referrer: document.referrer || "",
        page_title: document.title || "",
        sessionId: ident("sc_session", SESSION_TTL),
        userId: ident("sc_user", USER_TTL),
        userAgent: navigator.userAgent || "",
        screen: (screen && screen.width ? screen.width + "x" + screen.height : ""),
        language: navigator.language || "",
        utm_source: qs.get("utm_source") || "",
        utm_medium: qs.get("utm_medium") || "",
        utm_campaign: qs.get("utm_campaign") || "",
      };
      var blob = JSON.stringify(payload);
      // Send as text/plain — a CORS-"safelisted" content type, so the browser
      // makes NO preflight OPTIONS request (application/json would). The ingest
      // reads the raw body and JSON-parses it regardless of content type. This
      // is the standard analytics-beacon technique: one request, no preflight,
      // and it survives cross-origin + tunnel setups that mishandle OPTIONS.
      if (navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([blob], { type: "text/plain" }));
      } else {
        fetch(ENDPOINT, {
          method: "POST",
          body: blob,
          headers: { "Content-Type": "text/plain" },
          keepalive: true,
          mode: "cors",
        });
      }
    } catch (e) {}
  }

  var lastUrl = null;
  var lastAt = 0;
  function track() {
    try {
      var url = location.href;
      var t = now();
      if (url === lastUrl && t - lastAt < DEDUP_MS) return;
      lastUrl = url;
      lastAt = t;
      send("page_view");
    } catch (e) {}
  }

  // Public API for the generated site's custom events (form_submit,
  // add_to_cart, purchase, ...) with optional flat properties, e.g.
  // supercool.track("purchase", { revenue: 49.99, product: "Air Gallop" }).
  // Name is sanitized to snake_case-ish and capped; invalid input drops
  // silently.
  window.supercool = window.supercool || {};
  window.supercool.track = function (eventName, props) {
    try {
      var name = String(eventName || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64);
      if (!name || name === "page_view") return;
      send(name, props);
    } catch (e) {}
  };

  // Initial + SPA route changes.
  track();
  var push = history.pushState;
  history.pushState = function () { push.apply(this, arguments); setTimeout(track, 50); };
  var replace = history.replaceState;
  history.replaceState = function () { replace.apply(this, arguments); setTimeout(track, 50); };
  window.addEventListener("popstate", function () { setTimeout(track, 50); });
})();
