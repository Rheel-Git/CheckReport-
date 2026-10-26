(() => {
  const API = window.CheckReportAPI;
  if (!API) return;
  const $ = (selector) => document.querySelector(selector);
  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const loginView = $("#loginView"), dashboard = $("#dashboard"), toast = $("#toast");
  let reviews = [], businesses = [];
  function say(message) { toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 3500); }
  function errorMessage(error) {
    if (error.code === "admin_account_required") return "This account does not have administrator access.";
    if (error.code === "invalid_credentials_or_unverified_email") return "Check the administrator email and password, and verify the email address.";
    return error.message || "The CheckReport service is unavailable. Please try again.";
  }
  function showError(message) {
    let target = $("#adminLiveError");
    if (!target) { target = document.createElement("p"); target.id = "adminLiveError"; target.setAttribute("role", "alert"); target.style.color = "#aa543c"; $("#previewBtn").before(target); }
    target.textContent = message;
  }
  function tag(status) {
    const span = document.createElement("span");
    span.className = `tag ${status === "pending" ? "pending" : status === "published" || status === "approved" || status === "resolved" ? "approved" : status === "hidden" ? "" : "open"}`;
    span.textContent = status;
    return span;
  }
  function addAction(container, label, action, dangerous = false) {
    const button = document.createElement("button");
    button.type = "button"; button.className = `linkbtn${dangerous ? " red" : ""}`; button.textContent = label;
    button.addEventListener("click", () => action()); container.append(button);
  }
  function reviewSearchValue() { return $("#reviewSearch").value.trim().toLowerCase(); }
  function renderReviews() {
    const statusSelect = $("#reviewStatus");
    statusSelect.innerHTML = '<option value="all">All statuses</option><option value="pending">Pending</option><option value="published">Published</option><option value="resolved">Resolved</option><option value="hidden">Hidden</option><option value="deleted">Deleted</option>';
    const body = $("#reviewsTable tbody"); body.replaceChildren();
    const term = reviewSearchValue(), status = statusSelect.value;
    const rows = reviews.filter((review) => (status === "all" || review.status === status) && (!term || `${review.id} ${review.providerName} ${review.experience} ${review.displayName} ${review.complainantEmail}`.toLowerCase().includes(term)));
    for (const review of rows) {
      const row = document.createElement("tr"); row.dataset.search = `${review.id} ${review.providerName} ${review.experience}`.toLowerCase(); row.dataset.status = review.status;
      const main = document.createElement("td"); const title = document.createElement("span"); title.className = "cell-main"; title.textContent = review.id;
      const sub = document.createElement("span"); sub.className = "cell-sub"; sub.textContent = `${review.providerName} · Service: ${review.serviceBought}`;
      const detail = document.createElement("div"); detail.className = "detail-box"; detail.textContent = review.experience; main.append(title, sub, detail);
      const person = document.createElement("td"); person.append(document.createTextNode(review.isAnonymous ? "Anonymous" : review.displayName || "Community member"));
      const contacts = document.createElement("span"); contacts.className = "cell-sub"; contacts.textContent = `Customer: ${review.complainantEmail || "—"} · ${review.complainantPhone || "—"}\nProvider: ${review.providerEmail || "—"} · ${review.providerPhone || "—"}`; person.append(contacts);
      const rating = document.createElement("td"); rating.textContent = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
      const created = document.createElement("td"); created.textContent = review.createdAt ? new Date(review.createdAt).toLocaleString() : "—";
      const state = document.createElement("td"); state.append(tag(review.status));
      const actions = document.createElement("td"), group = document.createElement("div"); group.className = "actions";
      if (review.status !== "published" && review.status !== "deleted") addAction(group, "Publish", () => moderate("reviews", review.id, "publish"));
      if (review.status !== "hidden" && review.status !== "deleted") addAction(group, "Hide", () => moderate("reviews", review.id, "hide"));
      if (review.status !== "deleted") addAction(group, "Delete", () => moderate("reviews", review.id, "delete"), true);
      actions.append(group); row.append(main, person, rating, created, state, actions); body.append(row);
    }
    if (!rows.length) { const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = 6; cell.textContent = "No reviews match this filter."; row.append(cell); body.append(row); }
    $("#view-reviews .panel-head p").textContent = `${reviews.length} live review records · private contact details visible to administrators only`;
    $("#pendingReviewCount").textContent = reviews.filter((r) => r.status === "pending").length;
  }
  function renderBusinesses() {
    const body = $("#businessTable tbody"); body.replaceChildren();
    const term = $("#businessSearch").value.trim().toLowerCase();
    const rows = businesses.filter((business) => !term || `${business.name} ${business.serviceType} ${business.location} ${business.contactEmail}`.toLowerCase().includes(term));
    for (const business of rows) {
      const row = document.createElement("tr"); row.dataset.search = `${business.name} ${business.location}`.toLowerCase();
      const name = document.createElement("td"), title = document.createElement("span"); title.className = "cell-main"; title.textContent = business.name;
      const sub = document.createElement("span"); sub.className = "cell-sub"; sub.textContent = business.website || "No website supplied"; name.append(title, sub);
      const service = document.createElement("td"); service.append(document.createTextNode(business.serviceType)); const location = document.createElement("span"); location.className = "cell-sub"; location.textContent = business.location; service.append(location);
      const contact = document.createElement("td"); contact.textContent = `${business.contactEmail || "—"} · ${business.contactPhone || "—"}`;
      const state = document.createElement("td"); state.append(tag(business.status));
      const actions = document.createElement("td"), group = document.createElement("div"); group.className = "actions";
      if (business.status === "pending" || business.status === "hidden") addAction(group, "Approve", () => moderate("businesses", business.id, "approve"));
      if (business.status === "approved") addAction(group, "Hide", () => moderate("businesses", business.id, "hide"));
      if (business.status === "hidden") addAction(group, "Show", () => moderate("businesses", business.id, "show"));
      if (business.status !== "deleted") addAction(group, "Delete", () => moderate("businesses", business.id, "delete"), true);
      actions.append(group); row.append(name, service, contact, state, actions); body.append(row);
    }
    if (!rows.length) { const row = document.createElement("tr"), cell = document.createElement("td"); cell.colSpan = 5; cell.textContent = "No business profiles match this search."; row.append(cell); body.append(row); }
    $("#view-businesses .panel-head p").textContent = `${businesses.length} live profiles · contact details are restricted to administrators`;
    $("#pendingBusinessCount").textContent = businesses.filter((b) => b.status === "pending").length;
  }
  async function loadQueues() {
    const [reviewData, businessData] = await Promise.all([
      API.request("/api/admin/reviews?status=all"), API.request("/api/admin/businesses?status=all"),
    ]);
    reviews = reviewData.reviews || []; businesses = businessData.businesses || [];
    renderReviews(); renderBusinesses();
  }
  async function moderate(type, id, action) {
    const prompt = action === "delete" ? `Delete this ${type === "reviews" ? "review" : "business profile"}? It will be removed from public view.` : `${action[0].toUpperCase()}${action.slice(1)} this ${type === "reviews" ? "review" : "business profile"}?`;
    if (!window.confirm(prompt)) return;
    try {
      await API.request(`/api/admin/${type}/${encodeURIComponent(id)}`, { method: "POST", body: { action, reason: "Admin moderation decision" } });
      await loadQueues(); say(`${type === "reviews" ? "Review" : "Business profile"} ${({ approve: "approved", publish: "published", hide: "hidden", show: "shown", delete: "deleted" })[action]}.`);
    } catch (error) { say(errorMessage(error)); }
  }
  async function signIn() {
    const email = $("#adminEmail").value.trim(), password = $("#adminPassword").value;
    try {
      const session = await API.request("/api/auth/login", { method: "POST", body: { email, password }, token: null });
      if (session.user?.role !== "admin") { showError("This account does not have administrator access."); return; }
      API.saveSession(session);
      await loadQueues();
      loginView.style.display = "none"; dashboard.style.display = "block";
      document.querySelector(".status").textContent = "CONNECTED · ADMIN";
      document.querySelector(".preview-note").innerHTML = "<b>Live moderation.</b> Review and business queues are connected to the CheckReport API. Contact details are visible only in this secured administrator view. User management, advertising, and homepage controls remain preview-only.";
      window.switchPage("reviews");
    } catch (error) { API.clearSession(); showError(errorMessage(error)); }
  }

  const loginButton = $("#previewBtn");
  loginButton.textContent = "Sign in securely";
  $(".login>p").firstElementChild?.remove();
  $(".login>p").textContent = "Use an administrator account provisioned by the CheckReport operator.";
  const warning = $(".login .callout");
  warning.innerHTML = "<b>Secure access required:</b> Public registration cannot create admin accounts. Administrator accounts must be provisioned securely before this panel can open.";
  loginButton.addEventListener("click", (event) => { event.preventDefault(); event.stopImmediatePropagation(); signIn(); }, true);
  $("#adminPassword").addEventListener("keydown", (event) => { if (event.key === "Enter") signIn(); });
  $("#signOut").textContent = "↪  Sign out";
  $("#signOut").addEventListener("click", async (event) => {
    event.preventDefault(); event.stopImmediatePropagation();
    try { await API.request("/api/auth/logout", { method: "POST" }); } catch {}
    API.clearSession(); location.reload();
  }, true);
  $("#reviewSearch").addEventListener("input", renderReviews);
  $("#reviewStatus").addEventListener("change", renderReviews);
  $("#businessSearch").addEventListener("input", renderBusinesses);
  document.querySelectorAll(".side-nav button[data-page]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.page === "reviews") loadQueues().catch((error) => say(errorMessage(error)));
    if (button.dataset.page === "businesses") loadQueues().catch((error) => say(errorMessage(error)));
  }));

  const existing = API.sessionUser();
  if (existing?.role === "admin") {
    API.request("/api/auth/me").then(({ user }) => {
      if (user.role !== "admin") throw new Error("Admin session required");
      return loadQueues().then(() => { loginView.style.display = "none"; dashboard.style.display = "block"; document.querySelector(".status").textContent = "CONNECTED · ADMIN"; window.switchPage("reviews"); });
    }).catch(() => { API.clearSession(); });
  }
})();
