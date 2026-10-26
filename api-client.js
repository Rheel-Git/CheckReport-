(() => {
  const apiBase = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:8787"
    : "https://checkreport-api-preview.ubamuoma.workers.dev";
  const TOKEN_KEY = "checkreport.sessionToken";
  const USER_KEY = "checkreport.sessionUser";

  async function request(path, { method = "GET", body, token = sessionStorage.getItem(TOKEN_KEY) } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw Object.assign(new Error("The CheckReport service could not be reached. Please try again shortly."), { code: "network_error" });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status, code: data.error || "request_failed" });
    return data;
  }

  function saveSession(data) {
    sessionStorage.setItem(TOKEN_KEY, data.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(data.user));
  }
  function clearSession() { sessionStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(USER_KEY); }
  function sessionUser() {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  }

  window.CheckReportAPI = Object.freeze({ apiBase, request, saveSession, clearSession, sessionUser });
})();
