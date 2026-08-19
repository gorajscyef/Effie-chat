(function () {
  "use strict";

  const ACCOUNT_KEY = "effie_account_id_v1";
  const LEGACY_KEY = "effie_user_id_v1";
  const ID_PATTERN = /^ef_(?:account_)?[A-Za-z0-9_-]{20,200}$/;

  function clean(value) {
    const id = String(value || "").trim();
    return ID_PATTERN.test(id) ? id : "";
  }

  function readLinkedIdFromFragment() {
    if (!window.location.hash) return "";

    const params = new URLSearchParams(window.location.hash.slice(1));
    const incoming = clean(params.get("effie_id"));
    if (!incoming) return "";

    localStorage.setItem(ACCOUNT_KEY, incoming);
    params.delete("effie_id");

    const remaining = params.toString();
    const cleanUrl =
      window.location.pathname +
      window.location.search +
      (remaining ? `#${remaining}` : "");
    window.history.replaceState(null, "", cleanUrl);

    return incoming;
  }

  function createLegacyId() {
    const randomPart = crypto.randomUUID?.() ||
      `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    return `ef_${randomPart}`;
  }

  function getUserId() {
    const linked =
      readLinkedIdFromFragment() || clean(localStorage.getItem(ACCOUNT_KEY));
    if (linked) return linked;

    let legacy = clean(localStorage.getItem(LEGACY_KEY));
    if (!legacy) {
      legacy = createLegacyId();
      localStorage.setItem(LEGACY_KEY, legacy);
    }
    return legacy;
  }

  function isAccountLinked() {
    return Boolean(clean(localStorage.getItem(ACCOUNT_KEY)));
  }

  window.EffieIdentity = Object.freeze({ getUserId, isAccountLinked });
})();
