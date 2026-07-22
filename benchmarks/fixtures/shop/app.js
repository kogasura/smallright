/**
 * ベンチマーク用のローカル固定フィクスチャ。
 *
 * file:// で開かれるため、サーバーもストレージ API も使わずに状態を持つ必要がある。
 * localStorage は file:// のオリジン扱いがブラウザによって異なるため、
 * ページ間の状態は URL のクエリ文字列で受け渡す。
 */
(function () {
  const PRODUCTS = [
    { id: "backpack", name: "Sauce Labs Backpack", price: 29.99 },
    { id: "bike-light", name: "Sauce Labs Bike Light", price: 9.99 },
    { id: "bolt-tshirt", name: "Sauce Labs Bolt T-Shirt", price: 15.99 },
    { id: "fleece-jacket", name: "Sauce Labs Fleece Jacket", price: 49.99 },
    { id: "onesie", name: "Sauce Labs Onesie", price: 7.99 },
  ];

  function params() {
    return new URLSearchParams(location.search);
  }

  function cart() {
    const raw = params().get("cart");
    if (!raw) return [];
    return raw.split(",").filter(Boolean);
  }

  function withState(page, overrides) {
    const p = params();
    for (const [k, v] of Object.entries(overrides || {})) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    return qs ? `${page}?${qs}` : page;
  }

  window.Shop = {
    PRODUCTS,
    cart,
    params,
    withState,
    setUser(name) {
      // ログイン直後の遷移。以降のページは user クエリを引き回す
      sessionStorage.setItem("shop-user", name);
    },
    user() {
      return params().get("user") || sessionStorage.getItem("shop-user") || "";
    },
    cartCount() {
      return cart().length;
    },
    /** ヘッダー右上のカートバッジを描画する */
    renderCartBadge() {
      const link = document.getElementById("shopping-cart-link");
      if (!link) return;
      const n = cart().length;
      link.innerHTML = n > 0 ? `Cart <span class="cart-badge">${n}</span>` : "Cart";
      link.href = withState("cart.html");
    },
  };
})();
