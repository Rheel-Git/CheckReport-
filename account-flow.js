(() => {
  const API = window.CheckReportAPI;
  if (!API) return;
  const $ = (selector) => document.querySelector(selector);
  const h = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let selectedBusiness = null;
  let draft = null;
  let stars = 0;

  function toast(message) {
    const node = $("#toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    setTimeout(() => node.classList.remove("show"), 3500);
  }
  function open(content) { $("#modal").innerHTML = content; $("#modalBg").classList.add("show"); }
  function closeModal() { $("#modalBg").classList.remove("show"); }
  // Use a dedicated modal handler; Window.close() cannot close ordinary page dialogs.
  window.crCloseModal = closeModal;
  function errorText(error) {
    const labels = {
      email_delivery_unavailable: "Email verification is not configured yet. Your account was not created. Please try again later.",
      invalid_credentials_or_unverified_email: "Check your email and password, and verify your email before signing in.",
      customer_account_required: "Sign in with a customer account to submit this review.",
      business_account_required: "Sign in with a business account to submit this profile.",
      unauthorized: "Please sign in and try again.",
      rate_limited: "Too many attempts. Please wait and try again.",
      invalid_review_fields: "Please check the review fields and try again.",
      invalid_business_fields: "Please check the business details and try again.",
      business_not_approved_or_not_found: "That profile is not approved for review linking. Your review can still be submitted without linking it.",
    };
    return labels[error.code] || error.message || "Something went wrong. Please try again.";
  }

  async function loadBusinesses(query, target) {
    if (!query.trim()) { target.innerHTML = ""; return; }
    target.textContent = "Searching approved profiles…";
    try {
      const { businesses = [] } = await API.request(`/api/businesses?q=${encodeURIComponent(query)}&limit=8`, { token: null });
      if (!businesses.length) {
        target.innerHTML = '<p class="cr-note">No approved match found. You can continue with the provider name; an administrator can link it later.</p>';
        return;
      }
      target.replaceChildren(...businesses.map((business) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cr-option";
        const title = document.createElement("b"); title.textContent = business.name;
        const detail = document.createElement("span"); detail.textContent = `${business.serviceType} · ${business.location}`;
        const meta = document.createElement("small"); meta.textContent = `${business.reviewCount || 0} existing reviews · approved profile`;
        button.append(title, detail, meta);
        button.addEventListener("click", () => {
          selectedBusiness = business;
          $("#crProviderName").value = business.name;
          $("#crPicked").textContent = `Selected ${business.name}; your review will be linked to this profile.`;
        });
        return button;
      }));
    } catch (error) { target.textContent = errorText(error); }
  }

  window.crSearchReview = () => loadBusinesses($("#crQuery").value, $("#crResults"));
  window.crCheckRegistration = () => loadBusinesses($("#crBizName").value || $("#crBizSite").value, $("#crBizResults"));
  window.crSetRating = (value) => {
    stars = value;
    document.querySelectorAll("#crRating button").forEach((button, index) => button.classList.toggle("sel", index < value));
  };

  window.crReview = () => {
    selectedBusiness = null; stars = 0;
    open(`<button class="close" onclick="crCloseModal()" aria-label="Close">×</button><div class="eyebrow">Your experience matters</div><h2>Write a review</h2><p class="sub">Search approved businesses first, so your review can join the correct profile. You can still continue if you do not find a match.</p>
      <div class="field"><label for="crQuery">Business name, website, social handle, or WhatsApp number</label><div class="searchbox"><input id="crQuery" placeholder="Search approved businesses"><button class="btn" type="button" onclick="crSearchReview()">Search</button></div><div id="crResults" class="cr-list"></div><p id="crPicked" class="cr-note"></p></div>
      <div class="formgrid"><div class="field full"><label for="crProviderName">Provider or business name *</label><input id="crProviderName" required placeholder="Name as you know it"></div>
      <div class="field"><label for="crService">Service bought *</label><input id="crService" required placeholder="e.g. Kitchen tap installation"></div><div class="field"><label for="crWebsite">Provider website (optional)</label><input id="crWebsite" placeholder="https://"></div>
      <div class="field"><label for="crSocial">Social handle (optional)</label><input id="crSocial" placeholder="@business"></div><div class="field"><label for="crProviderPhone">Provider phone (private, optional)</label><input id="crProviderPhone" placeholder="+234…"></div>
      <div class="field full"><label for="crProviderEmail">Provider email (private, optional)</label><input id="crProviderEmail" type="email" placeholder="If available"></div>
      <div class="field full"><label>Have you tried to resolve this with them?</label><div class="radio-row"><label class="radio-pill"><input type="radio" name="crResolve" value="yes">Yes</label><label class="radio-pill"><input type="radio" name="crResolve" value="no" checked>No</label></div></div>
      <div class="field full"><label for="crExperience">Your experience in detail * (at least 20 characters)</label><textarea id="crExperience" required minlength="20" maxlength="5000" placeholder="Describe what happened"></textarea></div>
      <div class="field full"><label>Your star rating *</label><div class="rating-select" id="crRating">${[1,2,3,4,5].map((n) => `<button type="button" aria-label="${n} stars" onclick="crSetRating(${n})">★</button>`).join("")}</div></div></div>
      <p id="crReviewError" class="cr-note" role="alert"></p><button class="btn" type="button" onclick="crContinueReview()">Continue →</button>`);
  };

  window.crContinueReview = () => {
    const providerName = $("#crProviderName").value.trim();
    const serviceBought = $("#crService").value.trim();
    const experience = $("#crExperience").value.trim();
    if (!providerName || !serviceBought || experience.length < 20 || !stars) {
      $("#crReviewError").textContent = "Add the provider, service, a detailed account of at least 20 characters, and a star rating."; return;
    }
    draft = {
      type: "review", createdAt: Date.now(), body: {
        providerName, serviceBought, providerWebsite: $("#crWebsite").value.trim() || undefined,
        providerSocial: $("#crSocial").value.trim() || undefined,
        providerPhone: $("#crProviderPhone").value.trim() || undefined,
        providerEmail: $("#crProviderEmail").value.trim() || undefined,
        triedToResolve: $("input[name='crResolve']:checked").value === "yes", experience,
        rating: stars, isAnonymous: false, location: "", displayName: "", complainantPhone: "",
        businessId: selectedBusiness?.id || undefined,
      },
    };
    open(`<button class="close" onclick="crCloseModal()" aria-label="Close">×</button><div class="eyebrow">Almost there</div><h2>How should we identify you?</h2><p class="sub">Your email and phone are private. We’ll use them only for updates about this review.</p>
      <div class="field"><label>Display name</label><div class="radio-row"><label class="radio-pill"><input type="radio" name="crAnonymous" value="false" checked>Show my name</label><label class="radio-pill"><input type="radio" name="crAnonymous" value="true">Post anonymously</label></div></div>
      <div class="field"><label for="crName">Your name</label><input id="crName" placeholder="Your name"></div><div class="field"><label for="crLocation">Your location *</label><input id="crLocation" required placeholder="City, town or area"></div>
      <div class="field"><label for="crEmail">Email for updates *</label><input id="crEmail" type="email" required placeholder="you@example.com"></div><div class="field"><label for="crPhone">Phone for updates (optional)</label><input id="crPhone" placeholder="+234…"></div>
      <label class="radio-pill" style="margin:12px 0"><input id="crDraftConsent" type="checkbox"> Save this draft in this browser for up to 24 hours so I can finish after email verification.</label><p class="cr-note">The draft includes your review and private contact details. It is cleared after submission or after 24 hours.</p><p id="crIdentityError" class="cr-note" role="alert"></p><div class="modal-actions"><button class="btn ghost" onclick="crReview()">← Back</button><button class="btn" onclick="crPrepareReviewAccount()">Continue →</button></div>`);
  };

  window.crPrepareReviewAccount = () => {
    const anonymous = $("input[name='crAnonymous']:checked").value === "true";
    const email = $("#crEmail").value.trim().toLowerCase();
    if (!$("#crDraftConsent").checked) { $("#crIdentityError").textContent = "Please allow this browser to keep the draft temporarily so you can finish after email verification."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !$("#crLocation").value.trim() || (!anonymous && !$("#crName").value.trim())) {
      $("#crIdentityError").textContent = "Enter a valid email and location; add your name if you choose to show it."; return;
    }
    draft.body.displayName = anonymous ? "" : $("#crName").value.trim();
    draft.body.isAnonymous = anonymous;
    draft.body.location = $("#crLocation").value.trim();
    draft.body.complainantEmail = email;
    draft.body.complainantPhone = $("#crPhone").value.trim();
    startAccountCreation("customer", email, draft.body.displayName, draft);
  };

  function startAccountCreation(role, email, displayName, currentDraft) {
    try { localStorage.setItem("checkreport.pendingDraft", JSON.stringify(currentDraft)); }
    catch { toast("This browser could not keep your draft. Please enable local storage and try again."); return; }
    window.crRegistrationRole = role;
    window.crRegistrationName = displayName || "";
    open(`<button class="close" onclick="crCloseModal()" aria-label="Close">×</button><div class="eyebrow">Create a secure account</div><h2>Create your password</h2><p class="sub">Use at least 15 characters. Your draft will be saved after email verification and sign-in.</p><div class="field"><label>Email address</label><input id="crAccountEmail" type="email" value="${h(email)}" readonly></div><div class="field"><label for="crAccountPassword">Password</label><input id="crAccountPassword" type="password" minlength="15" maxlength="256" autocomplete="new-password"></div><p id="crAccountError" class="cr-note" role="alert"></p><div class="modal-actions"><button class="btn ghost" onclick="crOpenLogin()">I already have an account</button><button class="btn" onclick="crRegister()">Create account</button></div>`);
  }

  window.crRegister = async () => {
    const email = $("#crAccountEmail").value.trim().toLowerCase();
    const password = $("#crAccountPassword").value;
    if (new TextEncoder().encode(password).length < 15) { $("#crAccountError").textContent = "Password must be at least 15 characters."; return; }
    try {
      await API.request("/api/auth/register", { method: "POST", body: { email, password, role: window.crRegistrationRole, displayName: window.crRegistrationName || undefined }, token: null });
      open(`<div class="success"><div class="check">✓</div><h2>Check your email</h2><p>If this is a new account, we’ll send a verification link to ${h(email)}. If you already have an account, sign in below. Your draft stays in this browser for up to 24 hours.</p><a class="btn" href="verify.html">Open verification help</a><button class="btn ghost" onclick="crOpenLogin()">Sign in</button></div>`);
    } catch (error) { $("#crAccountError").textContent = errorText(error); }
  };

  window.crBusiness = () => {
    open(`<button class="close" onclick="crCloseModal()" aria-label="Close">×</button><div class="eyebrow">For service providers</div><h2>Create your business profile</h2><p class="sub">Your profile remains private until an admin approves it. Look for an existing profile below before creating a new one.</p>
      <div class="formgrid"><div class="field"><label for="crBizName">Business name *</label><input id="crBizName" placeholder="Your business name"></div><div class="field"><label for="crBizSite">Website or business page</label><input id="crBizSite" placeholder="https://"></div></div><button class="btn ghost" onclick="crCheckRegistration()">Check existing profiles</button><div id="crBizResults" class="cr-list"></div>
      <div class="formgrid" style="margin-top:12px"><div class="field"><label for="crBizService">Service type *</label><input id="crBizService" placeholder="e.g. Home services"></div><div class="field"><label for="crBizLocation">Business location *</label><input id="crBizLocation" placeholder="City, state or area"></div><div class="field"><label for="crBizPhone">Contact number</label><input id="crBizPhone" placeholder="+234…"></div><div class="field"><label for="crBizEmail">Contact email *</label><input id="crBizEmail" type="email" placeholder="hello@business.com"></div></div>
      <label class="radio-pill" style="margin:12px 0"><input id="crBizDraftConsent" type="checkbox"> Save my profile draft in this browser for up to 24 hours while I verify my email.</label><p class="cr-note">Logo upload will be enabled when secure image storage is connected. New profiles require administrator approval.</p><p id="crBizError" class="cr-note" role="alert"></p><button class="btn" onclick="crPrepareBusinessAccount()">Continue to account setup →</button>`);
  };

  window.crPrepareBusinessAccount = () => {
    const body = { name: $("#crBizName").value.trim(), serviceType: $("#crBizService").value.trim(), location: $("#crBizLocation").value.trim(), website: $("#crBizSite").value.trim(), contactPhone: $("#crBizPhone").value.trim(), contactEmail: $("#crBizEmail").value.trim().toLowerCase() };
    if (!$("#crBizDraftConsent").checked) { $("#crBizError").textContent = "Please allow this browser to keep the profile draft temporarily so you can finish after verification."; return; }
    if (!body.name || !body.serviceType || !body.location || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.contactEmail)) { $("#crBizError").textContent = "Enter the business name, service type, location, and a valid contact email."; return; }
    const businessDraft = { type: "business", createdAt: Date.now(), body };
    startAccountCreation("business", body.contactEmail, body.name, businessDraft);
  };

  async function resumeDraft(user) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem("checkreport.pendingDraft") || "null"); } catch { saved = null; }
    if (!saved) return null;
    if (Date.now() - saved.createdAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem("checkreport.pendingDraft");
      return "Your saved draft expired after 24 hours. Please start again.";
    }
    if (saved.type === "review" && user.role !== "customer") return "This draft needs a customer account. Sign in with the email address used for it.";
    if (saved.type === "business" && user.role !== "business") return "This draft needs a business account. Sign in with the email address used for it.";
    const email = saved.type === "review" ? saved.body.complainantEmail : saved.body.contactEmail;
    if (user.email.toLowerCase() !== email.toLowerCase()) return `Sign in as ${email} to submit this draft.`;
    try {
      const path = saved.type === "review" ? "/api/reviews" : "/api/businesses";
      const body = { ...saved.body };
      delete body.complainantEmail;
      const response = await API.request(path, { method: "POST", body });
      localStorage.removeItem("checkreport.pendingDraft");
      const label = saved.type === "review" ? "Your review is awaiting admin moderation." : "Your business profile is awaiting admin approval.";
      open(`<div class="success"><div class="check">✓</div><h2>Submitted successfully</h2><p>${h(label)}</p><p>Reference: ${h(response.review?.id || response.business?.id || "submitted")}</p><button class="btn" onclick="crCloseModal()">Done</button></div>`);
      return "submitted";
    } catch (error) { return errorText(error); }
  }

  window.crOpenSignup = () => {
    window.crRegistrationRole = "customer";
    window.crRegistrationName = "";
    open(`<button class="close" onclick="crCloseModal()" aria-label="Close">×</button><div class="eyebrow">Join CheckReport</div><h2>Create a customer account</h2><p class="sub">Verify your email to access your account. Admin access is assigned separately and cannot be selected during sign-up.</p><div class="field"><label for="crAccountEmail">Email address</label><input id="crAccountEmail" type="email" autocomplete="email" required></div><div class="field"><label for="crSignupName">Your name (optional)</label><input id="crSignupName" autocomplete="name"></div><div class="field"><label for="crAccountPassword">Password</label><input id="crAccountPassword" type="password" minlength="15" maxlength="256" autocomplete="new-password" required><small class="cr-note">Use at least 15 characters.</small></div><p id="crAccountError" class="cr-note" role="alert"></p><div class="modal-actions"><button class="btn ghost" onclick="crOpenLogin()">Back to log in</button><button class="btn" onclick="crRegister()">Create account</button></div>`);
  };
  window.crOpenLogin = () => open(`<button class="close" onclick="crCloseModal()" aria-label="Close">×</button><div class="eyebrow">Welcome back</div><h2>Log in to CheckReport</h2><p class="sub">Sign in with the verified email address for your customer or business account.</p><div class="field"><label for="crLoginEmail">Email address</label><input id="crLoginEmail" type="email" autocomplete="username"></div><div class="field"><label for="crLoginPassword">Password</label><input id="crLoginPassword" type="password" autocomplete="current-password"></div><p id="crLoginError" class="cr-note" role="alert"></p><div class="modal-actions"><button class="btn ghost" onclick="crOpenSignup()">Create an account</button><button class="btn ghost" onclick="crCloseModal()">Cancel</button><button class="btn" onclick="crLogin()">Log in</button></div>`);
  window.crLogin = async () => {
    const error = $("#crLoginError");
    try {
      const data = await API.request("/api/auth/login", { method: "POST", token: null, body: { email: $("#crLoginEmail").value.trim(), password: $("#crLoginPassword").value } });
      API.saveSession(data);
      const draftResult = await resumeDraft(data.user);
      if (draftResult && draftResult !== "submitted") { error.textContent = draftResult; return; }
      if (data.user.role === "admin") { location.href = "admin.html"; return; }
      if (!draftResult) { closeModal(); toast(`Signed in as ${data.user.email}. Account dashboards will connect in a later stage.`); }
    } catch (reason) { error.textContent = errorText(reason); }
  };

  document.querySelector("#writeBtn")?.addEventListener("click", (event) => { event.stopImmediatePropagation(); window.crReview(); }, true);
  document.querySelector("#businessBtn")?.addEventListener("click", (event) => { event.stopImmediatePropagation(); window.crBusiness(); }, true);
  document.querySelector("#loginBtn")?.addEventListener("click", (event) => { event.stopImmediatePropagation(); window.crOpenLogin(); }, true);
  document.querySelectorAll("a[href='index.html#login']").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); window.crOpenLogin(); }));
  window.addEventListener("hashchange", () => { if (location.hash === "#write-review") window.crReview(); if (location.hash === "#business") window.crBusiness(); if (location.hash === "#login") window.crOpenLogin(); });
  if (location.hash === "#write-review") window.crReview();
  if (location.hash === "#business") window.crBusiness();
  if (location.hash === "#login") window.crOpenLogin();
})();
