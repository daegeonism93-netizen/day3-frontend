(function () {
  "use strict";
  var API = window.API_URL;
  var $ = function (id) { return document.getElementById(id); };

  // ── 장바구니 번호: 이 브라우저를 구분하는 랜덤 값 (로그인 대신) ──
  var cartId = (function () {
    try {
      var saved = localStorage.getItem("duri_cart_id");
      if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
    } catch (e) { /* 저장소를 못 쓰는 환경 */ }
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem("duri_cart_id", id); } catch (e) {}
    return id;
  })();

  var state = { products: [], cart: null, category: "전체", busy: false };
  var FREE_FROM = 30000;

  var won = function (n) { return Number(n).toLocaleString("ko-KR") + "원"; };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ── 서버 통신 ──
  function call(path, options) {
    return fetch(API + path, Object.assign({ headers: { "Content-Type": "application/json" } }, options))
      .then(function (res) {
        if (res.status === 204) return null;
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.detail || ("서버 오류 (" + res.status + ")"));
          return data;
        });
      });
  }
  function fail(e) {
    var net = e instanceof TypeError;
    showAlert(net ? "서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요." : e.message);
  }
  function showAlert(msg) {
    var box = $("alert");
    box.innerHTML = "<span>⚠️ " + esc(msg) + '</span><button type="button" id="retry">다시 시도</button>';
    box.hidden = false;
    $("retry").onclick = init;
  }
  function hideAlert() { $("alert").hidden = true; }

  var toastTimer;
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2000);
  }

  // ── 상품 목록 ──
  function categories() {
    var set = [];
    state.products.forEach(function (p) { if (set.indexOf(p.category) < 0) set.push(p.category); });
    return ["전체"].concat(set);
  }
  function renderChips() {
    $("chips").innerHTML = categories().map(function (c) {
      return '<button type="button" class="chip' + (c === state.category ? " on" : "") + '" data-c="' + esc(c) + '">' + esc(c) + "</button>";
    }).join("");
  }
  function renderGrid() {
    var list = state.products.filter(function (p) { return state.category === "전체" || p.category === state.category; });
    if (!list.length) { $("grid").innerHTML = '<p class="nothing">상품이 없어요 🐾</p>'; return; }
    $("grid").innerHTML = list.map(function (p, i) {
      return '<article class="card" style="animation-delay:' + (i * 40) + 'ms">' +
        '<div class="art c-' + esc(p.category) + '"><span>' + esc(p.emoji) + '</span><b class="cat">' + esc(p.category) + "</b></div>" +
        '<div class="info"><h3>' + esc(p.name) + "</h3><p>" + esc(p.description || "") + "</p>" +
        '<div class="buy"><span class="price">' + won(p.price) + '</span>' +
        '<button type="button" class="add" data-id="' + p.id + '">담기 +</button></div></div></article>';
    }).join("");
  }
  function skeleton() {
    $("grid").innerHTML = new Array(6).join("x").split("").map(function () { return '<div class="skeleton"></div>'; }).join("");
  }

  // ── 장바구니 ──
  function renderCart() {
    var c = state.cart || { items: [], total_qty: 0, subtotal: 0, shipping: 0, total: 0 };
    var badge = $("badge");
    var prev = badge.textContent;
    badge.textContent = c.total_qty > 99 ? "99+" : c.total_qty;
    badge.hidden = c.total_qty === 0;
    if (String(c.total_qty) !== prev) { badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
    $("dCount").textContent = c.total_qty ? "(" + c.total_qty + "개)" : "";

    var has = c.items.length > 0;
    $("empty").hidden = has;
    $("dFoot").hidden = !has;
    $("shipBox").hidden = !has;
    $("lines").innerHTML = c.items.map(function (it) {
      return '<li class="line">' +
        '<div class="th art c-' + esc(it.category) + '">' + esc(it.emoji) + "</div>" +
        '<div><div class="nm">' + esc(it.name) + '</div><div class="pr">' + won(it.price) + "</div>" +
        '<div class="step"><button type="button" data-act="dec" data-id="' + it.id + '" data-q="' + it.quantity + '" aria-label="하나 빼기">−</button>' +
        "<output>" + it.quantity + '</output><button type="button" data-act="inc" data-id="' + it.id + '" data-q="' + it.quantity + '" aria-label="하나 더하기">+</button></div></div>' +
        '<div><div class="lt">' + won(it.line_total) + '</div><button type="button" class="rm" data-act="rm" data-id="' + it.id + '">삭제</button></div></li>';
    }).join("");

    var need = FREE_FROM - c.subtotal;
    var pct = Math.min(100, Math.round(c.subtotal / FREE_FROM * 100));
    $("shipBox").innerHTML = (need > 0
      ? "🚚 <b>" + won(need) + "</b> 더 담으면 <b>무료배송</b>!"
      : "🎉 <b>무료배송</b> 혜택을 받았어요!") + '<div class="meter"><i style="width:' + pct + '%"></i></div>';
    $("sSub").textContent = won(c.subtotal);
    $("sShip").textContent = c.shipping ? won(c.shipping) : "무료";
    $("sTotal").textContent = won(c.total);
  }
  function setCart(c) { state.cart = c; renderCart(); }

  function withBusy(btn, fn) {
    if (state.busy) return;
    state.busy = true;
    if (btn) btn.disabled = true;
    hideAlert();
    return Promise.resolve(fn()).catch(fail).then(function () {
      state.busy = false;
      if (btn) btn.disabled = false;
    });
  }

  function addToCart(btn, id) {
    withBusy(btn, function () {
      return call("/cart/" + cartId + "/items", { method: "POST", body: JSON.stringify({ product_id: id, quantity: 1 }) })
        .then(function (c) {
          setCart(c);
          var p = state.products.filter(function (x) { return x.id === id; })[0];
          toast((p ? p.emoji + " " + p.name : "상품") + " 담았어요!");
          btn.classList.add("done"); btn.textContent = "담았어요 ✓";
          setTimeout(function () { btn.classList.remove("done"); btn.textContent = "담기 +"; }, 1200);
        });
    });
  }
  function setQty(id, q) {
    withBusy(null, function () {
      return call("/cart/" + cartId + "/items/" + id, { method: "PATCH", body: JSON.stringify({ quantity: q }) }).then(setCart);
    });
  }
  function removeItem(id) {
    withBusy(null, function () { return call("/cart/" + cartId + "/items/" + id, { method: "DELETE" }).then(setCart); });
  }
  function clearCart(after) {
    return withBusy(null, function () {
      return call("/cart/" + cartId, { method: "DELETE" }).then(function (c) { setCart(c); if (after) after(); });
    });
  }

  // ── 서랍 열기/닫기 ──
  var lastFocus;
  function openDrawer() {
    lastFocus = document.activeElement;
    $("veil").hidden = false;
    $("drawer").classList.add("open");
    $("drawer").setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $("closeCart").focus();
  }
  function closeDrawer() {
    $("drawer").classList.remove("open");
    $("drawer").setAttribute("aria-hidden", "true");
    $("veil").hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // ── 이벤트 ──
  $("openCart").onclick = openDrawer;
  $("closeCart").onclick = closeDrawer;
  $("veil").onclick = closeDrawer;
  $("goShop").onclick = closeDrawer;
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { if (!$("modal").hidden) $("modalOk").click(); else closeDrawer(); }
  });
  $("chips").addEventListener("click", function (e) {
    var b = e.target.closest(".chip");
    if (!b) return;
    state.category = b.dataset.c;
    renderChips(); renderGrid();
  });
  $("grid").addEventListener("click", function (e) {
    var b = e.target.closest(".add");
    if (b) addToCart(b, Number(b.dataset.id));
  });
  $("lines").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = Number(b.dataset.id), q = Number(b.dataset.q);
    if (b.dataset.act === "inc") setQty(id, Math.min(99, q + 1));
    else if (b.dataset.act === "dec") setQty(id, q - 1);
    else removeItem(id);
  });
  $("clear").onclick = function () {
    if (confirm("장바구니를 모두 비울까요?")) clearCart();
  };
  $("checkout").onclick = function () {
    var c = state.cart;
    if (!c || !c.items.length) return;
    var summary = c.items.length + "종 " + c.total_qty + "개 · " + won(c.total);
    var btn = $("checkout");
    withBusy(btn, function () {
      return call("/cart/" + cartId, { method: "DELETE" }).then(function (empty) {
        setCart(empty);
        $("orderMsg").textContent = summary + " 주문이 접수됐어요.";
        closeDrawer();
        $("modal").hidden = false;
        $("modalOk").focus();
      });
    });
  };
  $("modalOk").onclick = function () { $("modal").hidden = true; };

  // ── 시작 ──
  function init() {
    hideAlert();
    skeleton();
    Promise.all([call("/products"), call("/cart/" + cartId)])
      .then(function (r) {
        state.products = r[0];
        renderChips(); renderGrid();
        setCart(r[1]);
      })
      .catch(function (e) { $("grid").innerHTML = ""; $("chips").innerHTML = ""; fail(e); });
  }
  init();
})();
