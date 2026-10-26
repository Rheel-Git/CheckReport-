(() => {
  const API = window.CheckReportAPI;
  const root = document.querySelector("main.wrap");
  const kind = document.body.dataset.dashboard;
  if (!API || !root || !["customer", "business"].includes(kind)) return;

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Date unavailable" :
      parsed.toLocaleDateString("en-NG", { year: "numeric", month: "short", day: "numeric" });
  };
  const stars = (value) => "★".repeat(Math.max(0, Math.min(5, Number(value) || 0)) || 0) +
    "☆".repeat(5 - Math.max(0, Math.min(5, Number(value) || 0)));
  const statusLabel = (status) => ({
    pending: "Awaiting moderation", approved: "Approved", published: "Published", resolved: "Resolved",
    hidden: "Hidden", deleted: "Removed",
  })[status] || "Status unavailable";
  const statusClass = (status) => ({
    pending: "", published: "reply", resolved: "done", hidden: "", deleted: "",
  })[status] || "";
  const wrapMessage = (title, detail, linkText = "Sign in", href = "index.html#login") => {
    root.innerHTML = '<article class="panel dashboard-message"><h2>' + esc(title) +
      '</h2><p>' + esc(detail) + '</p><a class="btn primary" href="' + esc(href) + '">' +
      esc(linkText) + '</a></article>';
    document.body.classList.add("dashboard-ready");
  };
  const reviewCard = (review, business = false) => {
    const name = business ? (review.displayName || "Community member") : (review.businessName || "Unlisted provider");
    const title = business ? (review.serviceBought || "Customer review") : (review.businessName || "Unlisted provider");
    const response = review.latestBusinessReply
      ? '<div class="reply-box"><b>Business response</b><br>' + esc(review.latestBusinessReply) + '</div>'
      : '<div class="note">No business response has been posted.</div>';
    return '<article class="review"><div class="review-top"><div><h3>' + esc(title) +
      '</h3><div class="' + (business ? "customer" : "business") + '">' + esc(business
        ? name + " · " + (review.location || "Location not provided")
        : (review.serviceBought || "Service not specified")) + '</div></div><span class="tag ' +
      statusClass(review.status) + '">' + esc(statusLabel(review.status)) + '</span></div>' +
      '<div class="stars">' + stars(review.rating) + '</div><p>' + esc(review.experience) +
      '</p>' + (business ? response : (review.latestBusinessReply
        ? '<div class="reply-box"><b>Business response</b><br>' + esc(review.latestBusinessReply) + '</div>'
        : '<div class="note">No provider reply yet. Updates will appear here.</div>')) +
      '<div class="meta">Submitted ' + esc(date(review.createdAt)) +
      (business ? "" : " · Public name: " + esc(review.displayName || "Anonymous") + " · " + esc(review.location || "Location not provided")) +
      '</div></article>';
  };
  const bindSignOut = () => document.querySelector("#dashboardSignOut")?.addEventListener("click", async () => {
    try { await API.request("/api/auth/logout", { method: "POST" }); } catch {}
    API.clearSession();
    location.href = "index.html";
  });

  root.innerHTML = '<article class="panel dashboard-message"><p>Loading your secure dashboard…</p></article>';
  document.body.classList.add("dashboard-ready");

  async function loadCustomer() {
    const { user, reviews = [] } = await API.request("/api/account/dashboard");
    if (user.role !== "customer") {
      wrapMessage("Customer account required", "Sign in with a customer account to view your reviews.", "Return to CheckReport", "index.html");
      return;
    }
    const replied = reviews.filter((review) => Number(review.replyCount) > 0).length;
    const resolved = reviews.filter((review) => review.status === "resolved").length;
    const display = user.displayName || user.email;
    root.innerHTML = '<div class="preview"><b>Your account is connected.</b> Reviews and statuses below are loaded from your CheckReport account.</div>' +
      '<header class="welcome"><div><div class="eyebrow">Your account</div><h1>Welcome back, ' + esc(display) +
      '</h1><p>Track your reviews and follow the conversation with providers.</p></div><div class="profile"><div class="avatar">' +
      esc((display || "C").slice(0, 1).toUpperCase()) + '</div><div><b>' + esc(display) +
      '</b><small>Customer account</small></div></div></header>' +
      '<section class="stats"><article class="stat"><span>My reviews</span><b>' + reviews.length +
      '</b><small>Saved to your account</small></article><article class="stat"><span>Provider replies</span><b>' +
      replied + '</b><small>Reviews with a response</small></article><article class="stat"><span>Marked resolved</span><b>' +
      resolved + '</b><small>Conversations resolved</small></article></section><div class="content"><section><article class="panel"><div class="panel-head"><div><h2>My reviews</h2><p>Your submitted reviews and moderation status</p></div><a class="text-link" href="index.html#write-review">＋ Write a review</a></div>' +
      (reviews.length ? reviews.map((review) => reviewCard(review)).join("") :
        '<div class="note">You have not submitted any reviews yet. When you do, they will appear here.</div>') +
      '</article></section><aside><article class="panel"><div class="panel-head"><div><h2>Account details</h2><p>Private to your account</p></div></div><div class="side-row"><b>Email</b><span>' +
      esc(user.email) + '</span></div><div class="note">Your email and review update details are not shown on public reviews.</div></article><article class="panel"><h2>Quick links</h2><div class="quick"><a href="index.html#write-review">Write a review →</a><a href="explore.html">Explore businesses →</a><a href="how-it-works.html#privacy">Privacy and review guidelines →</a></div></article></aside></div>';
    bindSignOut();
  }

  async function loadBusiness() {
    const { user, businesses = [], reviews = [] } = await API.request("/api/businesses/mine");
    if (user.role !== "business") {
      wrapMessage("Business account required", "Sign in with a business account to manage your profile.", "Return to CheckReport", "index.html");
      return;
    }
    if (!businesses.length) {
      wrapMessage("No business profile yet", "Create a profile to have it reviewed and linked to your business account.", "Create business profile", "index.html?profile-form=1#business");
      return;
    }
    const total = reviews.length;
    const average = total ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / total).toFixed(1) : "—";
    const needsReply = reviews.filter((review) => Number(review.replyCount) === 0).length;
    const resolved = reviews.filter((review) => review.status === "resolved").length;
    const profileCards = businesses.map((business) => {
      const status = statusLabel(business.status);
      const publicLink = business.status === "approved"
        ? '<a class="btn primary" href="explore.html">View public reviews</a>' : "";
      return '<article class="panel"><div class="panel-head"><div><h2>Business profile</h2><p>Profile information visible to your account</p></div><span class="tag ' +
        statusClass(business.status) + '">' + esc(status) + '</span></div><div class="side-row"><b>Business name</b><span>' +
        esc(business.name) + '</span></div><div class="side-row"><b>Service type</b><span>' + esc(business.serviceType) +
        '</span></div><div class="side-row"><b>Location</b><span>' + esc(business.location) +
        '</span></div><div class="side-row"><b>Website</b><span>' + esc(business.website || "Not provided") +
        '</span></div><div class="side-row"><b>Contact number</b><span>' + esc(business.contactPhone || "Not provided") +
        '</span></div><div class="side-row"><b>Contact email</b><span>' + esc(business.contactEmail || "Not provided") +
        '</span></div><div class="note">' + (business.status === "approved"
          ? "This profile is approved and visible to customers."
          : "Your profile is not public until an administrator approves it.") +
        '</div>' + publicLink + '</article>';
    }).join("");
    root.innerHTML = '<div class="preview"><b>Your account is connected.</b> Profile and published review information below is loaded from your CheckReport account.</div>' +
      '<header class="welcome"><div><div class="eyebrow">Business workspace</div><h1>Welcome back, ' + esc(user.displayName || user.email) +
      '</h1><p>View your business profile and customer feedback.</p></div><div class="profile"><div class="avatar">' +
      esc((businesses[0].name || "B").slice(0, 1).toUpperCase()) + '</div><div><b>' + esc(businesses[0].name) +
      '</b><div class="muted">' + esc(businesses[0].serviceType) + " · " + esc(businesses[0].location) +
      '</div></div></div></header><section class="stats"><article class="stat"><span>Total public reviews</span><b>' +
      total + '</b><small>Published on your profiles</small></article><article class="stat"><span>Average rating</span><b>' +
      average + (total ? " ★" : "") + '</b><small>' + total + ' public reviews</small></article><article class="stat"><span>Needs a reply</span><b>' +
      needsReply + '</b><small>Reviews without a business response</small></article><article class="stat"><span>Resolved</span><b>' +
      resolved + '</b><small>Feedback marked resolved</small></article></section><div class="content"><section><article class="panel"><div class="panel-head"><div><h2>Customer reviews</h2><p>Published feedback for your business</p></div></div>' +
      (reviews.length ? reviews.map((review) => reviewCard(review, true)).join("") :
        '<div class="note">There are no published reviews for your business yet.</div>') +
      '</article></section><aside>' + profileCards + '<article class="panel"><h2>Account</h2><div class="side-row"><b>Email</b><span>' +
      esc(user.email) + '</span></div><div class="quick"><a href="businesses.html">Profile guidance →</a><a href="how-it-works.html">Reply guidelines →</a></div><div class="note">Your dashboard updates when a review is published or resolved.</div></article></aside></div>';
    bindSignOut();
  }

  (kind === "customer" ? loadCustomer() : loadBusiness()).catch((error) => {
    if (error.code === "unauthorized") {
      API.clearSession();
      wrapMessage("Please sign in", "Your session is missing or has expired. Sign in to access your account.", "Log in", "index.html#login");
      return;
    }
    if (error.code === "customer_account_required") {
      wrapMessage("Customer account required", "This page is for customer accounts.", "Open business dashboard", "business-dashboard.html");
      return;
    }
    if (error.code === "business_account_required") {
      wrapMessage("Business account required", "This page is for business accounts.", "Open customer dashboard", "user-dashboard.html");
      return;
    }
    wrapMessage("Dashboard unavailable", error.message || "We could not load your account right now. Please try again.");
  });
})();