/* Synergix dashboard — Phase 1 (read-only)
   Talks only to /api/app/*. All state comes from the bot through that tier;
   nothing about points or ranks is computed here, so the dashboard can never
   disagree with Telegram. */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var VIEWS = ["viewBoot", "viewLogin", "viewSetup", "viewApp"];

  function show(id) {
    VIEWS.forEach(function (v) { $(v).hidden = (v !== id); });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function note(host, text, kind) {
    $(host).innerHTML = text
      ? '<div class="msg msg-' + (kind || "bad") + '">' + esc(text) + "</div>"
      : "";
  }

  function nfmt(n) {
    var v = typeof n === "number" ? n : parseFloat(String(n).replace(/[^0-9.\-]/g, ""));
    return isFinite(v) ? v.toLocaleString("en-US") : null;
  }

  // Token amounts arrive as decimal strings so 18-decimal values keep their
  // precision. Format for display without ever going through a float.
  function amount(str) {
    if (str === null || str === undefined || str === "") return "—";
    var s = String(str).trim();
    var neg = s.charAt(0) === "-";
    if (neg) s = s.slice(1);
    var parts = s.split(".");
    var whole = parts[0].replace(/^0+(?=\d)/, "");
    var frac = (parts[1] || "").replace(/0+$/, "").slice(0, 2);
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + (whole || "0") + (frac ? "." + frac : "");
  }

  // ── transport ───────────────────────────────────────────────
  function api(path, opts) {
    opts = opts || {};
    return fetch("/api/app" + path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: Object.assign({ Accept: "application/json" },
        opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        return { status: r.status, ok: r.ok, body: j };
      });
    });
  }

  // 501 means the site is fine but the bot API is not wired up yet. That is a
  // deployment state, not a user error, so it gets its own screen.
  function isNotWired(res) {
    return res.status === 501 ||
      (res.body && res.body.error && res.body.error.code === "bot_not_configured");
  }

  function showSetup(res) {
    var m = res && res.body && res.body.error && res.body.error.message;
    if (m) $("setupMsg").textContent = m;
    show("viewSetup");
  }

  // ── sign in ─────────────────────────────────────────────────
  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("code").value.trim().toUpperCase();
    if (!code) return;
    var btn = $("loginBtn");
    btn.disabled = true;
    btn.textContent = "Checking…";
    note("loginMsg", "");

    api("/auth/exchange", { method: "POST", body: { code: code } })
      .then(function (res) {
        if (res.ok) { boot(); return; }
        if (isNotWired(res)) { showSetup(res); return; }
        var err = (res.body && res.body.error) || {};
        note("loginMsg", err.message || "Could not sign you in.",
          res.status === 429 ? "warn" : "bad");
      })
      .catch(function () {
        note("loginMsg", "Network problem. Check your connection and try again.");
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "Sign in";
        $("code").select();
      });
  });

  $("logout").addEventListener("click", function () {
    api("/auth/session", { method: "DELETE" }).finally(function () {
      show("viewLogin");
      $("code").value = "";
    });
  });

  // ── navigation ──────────────────────────────────────────────
  $("nav").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    var view = b.dataset.view;
    Array.prototype.forEach.call($("nav").querySelectorAll("button"), function (x) {
      x.classList.toggle("on", x === b);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-panel]"), function (p) {
      p.hidden = p.dataset.panel !== view;
    });
    if (view === "contrib" && !loadedContribs) loadContributions();
  });

  // ── render ──────────────────────────────────────────────────
  function renderMe(d) {
    $("who").textContent = d.handle || ("id " + d.telegram_id);

    $("mPoints").textContent = nfmt(d.points) || "0";
    $("mStreak").textContent = d.streak_days ? d.streak_days + "-day streak" : "";

    var rank = d.rank || {};
    $("mRank").textContent = rank.label || rank.key || "—";
    $("mMult").textContent = rank.multiplier ? "×" + rank.multiplier + " multiplier" : "";

    var q = d.quota;
    if (q && q.limit) {
      $("mQuota").textContent = (q.used || 0) + " / " + q.limit;
      $("mQuotaBar").style.width = Math.min(100, ((q.used || 0) / q.limit) * 100) + "%";
      $("mQuotaReset").textContent = q.resets_at
        ? "Resets " + new Date(q.resets_at).toLocaleString()
        : "";
    } else {
      $("mQuota").textContent = q ? "∞" : "—";
      $("mQuotaReset").textContent = q ? "No daily limit" : "";
    }

    if (rank.next_at && d.points !== undefined) {
      var pct = Math.min(100, (d.points / rank.next_at) * 100);
      $("mProgBar").style.width = pct + "%";
      $("mProg").textContent =
        nfmt(d.points) + " / " + nfmt(rank.next_at) +
        (rank.next ? " → " + rank.next : "");
    } else {
      $("mProgBar").style.width = "100%";
      $("mProg").textContent = "Top rank reached";
    }

    var p = d.passport || {};
    $("pCit").textContent = nfmt(p.citations) || "0";
    $("pRoy").textContent = p.royalties_accrued ? amount(p.royalties_accrued) : "0";
    $("pImp").textContent = nfmt(p.impact_score) || "—";

    var w = d.wallet || {};
    $("wSynx").textContent = amount(w.synx);
    $("wSyn").textContent = amount(w.synergix);
    var mem = w.membership || {};
    $("wTier").textContent = mem.tier || "—";
    $("wNext").textContent = mem.next_tier_at
      ? "Next tier at " + amount(mem.next_tier_at)
      : "";
  }

  var JUDGE_OK = { approved: 1, clean: 1, pass: 1, ok: 1 };

  function judgeCell(j) {
    if (!j) return "—";
    return ["llm", "oracle", "antisybil"].map(function (k) {
      var v = j[k];
      if (v === undefined || v === null) return '<span class="pill">·</span>';
      var good = typeof v === "number" ? v >= 5 : !!JUDGE_OK[String(v).toLowerCase()];
      var cls = typeof v === "number" || JUDGE_OK[String(v).toLowerCase()]
        ? (good ? "p-ok" : "p-bad") : "p-wait";
      return '<span class="pill ' + cls + '">' + esc(v) + "</span>";
    }).join(" ");
  }

  function statusPill(s) {
    var k = String(s || "").toLowerCase();
    var cls = k === "accepted" ? "p-ok" : (k === "rejected" ? "p-bad" : "p-wait");
    return '<span class="pill ' + cls + '">' + esc(s || "pending") + "</span>";
  }

  var loadedContribs = false, cursor = null;

  function loadContributions() {
    loadedContribs = true;
    api("/me/contributions" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""))
      .then(function (res) {
        if (!res.ok) {
          if (isNotWired(res)) return showSetup(res);
          $("cRows").innerHTML =
            '<tr><td colspan="5"><div class="empty">Could not load your contributions.</div></td></tr>';
          return;
        }
        var items = res.body.items || [];
        if (!items.length && !cursor) {
          $("cRows").innerHTML =
            '<tr><td colspan="5"><div class="empty">No contributions yet. Send knowledge to the bot to get started.</div></td></tr>';
          return;
        }
        var html = items.map(function (it) {
          return "<tr>" +
            "<td>" + esc(it.excerpt || it.id || "—") + "</td>" +
            "<td>" + judgeCell(it.judges) + "</td>" +
            "<td>" + statusPill(it.status) + "</td>" +
            '<td style="text-align:right" class="num">' +
              (it.points_awarded != null ? nfmt(it.points_awarded) : "—") + "</td>" +
            "<td>" + (it.irys_tx
              ? '<a class="tx" href="https://gateway.irys.xyz/' +
                encodeURIComponent(it.irys_tx) + '" target="_blank" rel="noopener">Irys ↗</a>'
              : "—") + "</td>" +
          "</tr>";
        }).join("");
        if (cursor) $("cRows").insertAdjacentHTML("beforeend", html);
        else $("cRows").innerHTML = html;

        cursor = res.body.next_cursor || null;
        $("cMoreWrap").hidden = !cursor;
      })
      .catch(function () {
        $("cRows").innerHTML =
          '<tr><td colspan="5"><div class="empty">Network problem loading contributions.</div></td></tr>';
      });
  }

  $("cMore").addEventListener("click", loadContributions);

  // ── boot ────────────────────────────────────────────────────
  function boot() {
    api("/me")
      .then(function (res) {
        if (res.status === 401) { show("viewLogin"); return; }
        if (isNotWired(res)) { showSetup(res); return; }
        if (!res.ok) {
          show("viewApp");
          note("appMsg",
            (res.body && res.body.error && res.body.error.message) ||
            "Could not load your dashboard.", "bad");
          return;
        }
        renderMe(res.body);
        show("viewApp");
      })
      .catch(function () {
        show("viewLogin");
        note("loginMsg", "Could not reach the server.");
      });
  }

  boot();
})();
