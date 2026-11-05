/* Demo checkout: PayPal JS SDK v6 buttons + Pay Later, with the Hollaback snippet watching. */
(function () {
  "use strict";

  var API = document.querySelector('meta[name="hollaback-api"]').content.replace(/\/$/, "");
  var CART = { items: [{ sku: "AR-01", name: "Air Runners", quantity: 1, unitPrice: 89 }], currency: "USD" };
  window.hollabackCart = CART;

  var state = { payLaterEligible: undefined, lastOrderId: null, payerActionUrl: null };
  var statusEl = document.getElementById("status");

  function $(id) {
    return document.getElementById(id);
  }

  function show(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status " + (kind || "");
  }

  var sdkLoaded;
  var sdkReady = new Promise(function (resolve) {
    sdkLoaded = resolve;
  });
  // Called by the SDK <script onload="onLoad()">
  window.onLoad = function () {
    sdkLoaded();
  };

  function contact() {
    return { name: $("name").value, email: $("email").value, phone: $("phone").value };
  }

  function consent() {
    var box = document.querySelector("input[data-hb-consent]");
    return box ? box.checked : false;
  }

  /** Ask our server to create the Orders v2 order. Returns a promise of { orderId }. */
  function createOrder() {
    return fetch(API + "/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: window.Hollaback && window.Hollaback.sessionId,
        items: CART.items,
        currency: CART.currency,
        contact: contact(),
        consent: consent(),
        payLaterEligible: state.payLaterEligible,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.error || "Could not create the PayPal order");
          return data;
        });
      })
      .then(function (data) {
        state.lastOrderId = data.orderId;
        state.payerActionUrl = data.payerActionUrl;
        if (window.Hollaback) window.Hollaback.orderCreated(data.orderId);
        return { orderId: data.orderId };
      });
  }

  function onApprove(data) {
    if (window.Hollaback) window.Hollaback.approved(data.orderId);
    show("Approved. Capturing payment…");
    return fetch(API + "/orders/" + encodeURIComponent(data.orderId) + "/capture", { method: "POST" })
      .then(function (r) {
        return r.json();
      })
      .then(function (res) {
        if (res.status === "COMPLETED") show("Payment complete. Thank you! Order " + data.orderId, "ok");
        else show("Payment status: " + (res.status || res.error), "warn");
      });
  }

  function onCancel(data) {
    var orderId = (data && data.orderId) || state.lastOrderId;
    if (window.Hollaback) window.Hollaback.cancelled(orderId || undefined);
    show("Checkout cancelled. Your cart is saved.", "warn");
  }

  function onError(err) {
    console.error(err);
    show("Something went wrong with PayPal: " + ((err && err.message) || err), "error");
  }

  function cartTotal() {
    return CART.items
      .reduce(function (sum, item) {
        return sum + item.unitPrice * item.quantity;
      }, 0)
      .toFixed(2);
  }

  // Sandbox only (this page loads the sandbox SDK). PayPal decides Pay Later eligibility from the
  // buyer's country, so a tester outside the US never sees US Pay Later. testBuyerCountry pins the
  // buyer country in sandbox. ?buyerCountry=XX picks another country; ?buyerCountry=auto uses the real one.
  function testBuyerCountry() {
    var param = new URLSearchParams(window.location.search).get("buyerCountry");
    var country = (param || "US").toUpperCase();
    return /^[A-Z]{2}$/.test(country) ? country : null;
  }

  // ---------- Real PayPal JS SDK v6 ----------
  function initPayPal(cfg) {
    return sdkReady
      .then(function () {
        var options = {
          clientId: cfg.paypalClientId,
          components: ["paypal-payments", "paypal-messages"],
          pageType: "checkout",
        };
        var country = testBuyerCountry();
        if (country) options.testBuyerCountry = country;
        return window.paypal.createInstance(options);
      })
      .then(function (sdk) {
        // The amount matters: Pay Later products have minimum and maximum order totals.
        return sdk.findEligibleMethods({ currencyCode: "USD", amount: cartTotal() }).then(function (methods) {
          var handlers = { onApprove: onApprove, onCancel: onCancel, onError: onError };

          if (methods.isEligible("paypal")) {
            var paypalSession = sdk.createPayPalOneTimePaymentSession(handlers);
            var paypalButton = document.querySelector("paypal-button");
            paypalButton.removeAttribute("hidden");
            paypalButton.addEventListener("click", function () {
              // Do not await createOrder() before start(): start() needs the click's transient activation.
              paypalSession.start({ presentationMode: "auto" }, createOrder()).catch(onError);
            });
          }

          state.payLaterEligible = methods.isEligible("paylater");
          if (state.payLaterEligible) {
            var details = methods.getDetails("paylater");
            var payLaterSession = sdk.createPayLaterOneTimePaymentSession(handlers);
            var payLaterButton = document.querySelector("paypal-pay-later-button");
            payLaterButton.productCode = details.productCode;
            payLaterButton.countryCode = details.countryCode;
            payLaterButton.removeAttribute("hidden");
            payLaterButton.addEventListener("click", function () {
              payLaterSession.start({ presentationMode: "auto" }, createOrder()).catch(onError);
            });
          }

          // <paypal-message auto-bootstrap> renders once the messages component exists.
          sdk.createPayPalMessages({ currencyCode: "USD" });
        });
      })
      .catch(onError);
  }

  // ---------- Local simulation (MOCK_PAYPAL=1) ----------
  function initMock() {
    $("mock-banner").hidden = false;
    $("mock-paypal").hidden = false;
    $("mock-paylater").hidden = false;
    $("mock-message").hidden = false;
    $("paylater-message").hidden = true;
    state.payLaterEligible = true;

    var popup = null;
    var settled = false;

    window.addEventListener("message", function (e) {
      var d = e.data || {};
      if (d.source !== "hollaback-mock-paypal") return;
      settled = true;
      if (d.action === "approve") onApprove({ orderId: d.orderId });
      else onCancel({ orderId: d.orderId });
    });

    function start() {
      settled = false;
      // Open synchronously inside the click so it isn't blocked, then point it at the approval page.
      popup = window.open("", "hb-paypal", "width=460,height=680");
      createOrder()
        .then(function () {
          if (popup) popup.location.href = state.payerActionUrl;
          else window.location.href = state.payerActionUrl;
          var timer = setInterval(function () {
            if (popup && popup.closed) {
              clearInterval(timer);
              // Closing the window without approving is a cancel, like the SDK's onCancel.
              if (!settled) onCancel({ orderId: state.lastOrderId });
            }
          }, 500);
        })
        .catch(function (err) {
          if (popup) popup.close();
          onError(err);
        });
    }

    $("mock-paypal").addEventListener("click", start);
    $("mock-paylater").addEventListener("click", start);
  }

  $("fill-demo").addEventListener("click", function () {
    var values = { name: "Ada Obi", email: "ada@example.com", phone: "+234 803 123 4567" };
    Object.keys(values).forEach(function (id) {
      var el = $(id);
      el.value = values[id];
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    var box = document.querySelector("input[data-hb-consent]");
    if (box && !box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  fetch(API + "/config")
    .then(function (r) {
      return r.json();
    })
    .then(function (cfg) {
      if (cfg.mock || !cfg.paypalClientId) initMock();
      else initPayPal(cfg);
    })
    .catch(function () {
      show("Cannot reach the Hollaback server at " + API + ". Is it running?", "error");
    });
})();
