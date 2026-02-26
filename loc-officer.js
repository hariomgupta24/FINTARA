/* =========================================
   Barclays LOC Officer Dashboard — Logic
   API-backed version (Node.js + SQLite)
   =========================================*/
'use strict';

const API_BASE = 'http://localhost:3000/api';

// ── State ──
let allApps = [];
let currentFilter = 'All';
let selectedRef = null;
let searchQuery = '';
let autoRefreshTimer = null;

// ── Helpers ──
function statusClass(s) {
    if (s === 'Pending Review') return 'pending';
    if (s === 'Under Review') return 'review';
    if (s === 'Approved') return 'approved';
    if (s === 'Rejected') return 'rejected';
    if (s === 'More Info Required') return 'info';
    return 'pending';
}
function chipClass(s) { return 'chip-' + statusClass(s); }
function creditClass(r) { return r >= 70 ? 'credit-high' : r >= 45 ? 'credit-medium' : 'credit-low'; }
function creditLabel(r) { return r >= 70 ? '● High Credit' : r >= 45 ? '● Medium Credit' : '● Low Credit'; }
function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function timeSince(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 3600) return Math.floor(diff / 60) + ' mins ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hrs ago';
    return Math.floor(diff / 86400) + ' days ago';
}
function formatCurrency(app) {
    const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AED: 'د.إ', SGD: 'S$', CNY: '¥' }[app.lcCurrency] || (app.lcCurrency + ' ');
    return sym + parseFloat(app.lcAmount || 0).toLocaleString();
}

// ── API Calls ──
async function api(path, options = {}) {
    const r = await fetch(API_BASE + path, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await r.json();
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
}

// ── Load Stats ──
async function loadStats() {
    try {
        const { stats } = await api('/stats');
        document.getElementById('statTotal').textContent = stats.total;
        document.getElementById('statPending').textContent = stats.pending;
        document.getElementById('statApproved').textContent = stats.approved;
        document.getElementById('statRejected').textContent = stats.rejected;
    } catch (e) {
        console.warn('Stats load failed:', e.message);
    }
}

// ── Load Applications ──
async function loadApplications() {
    showListLoading();
    try {
        const params = new URLSearchParams();
        if (currentFilter !== 'All') params.set('status', currentFilter);
        if (searchQuery) params.set('q', searchQuery);

        const { applications } = await api(`/applications?${params}`);
        allApps = applications;
        renderList(applications);
    } catch (e) {
        showListError(e.message);
    }
}

// ── Render Application List ──
function showListLoading() {
    document.getElementById('appList').innerHTML = `
    <div class="empty-queue" style="display:flex;flex-direction:column;align-items:center;gap:12px;">
      <div class="ocr-spinner" style="border-top-color:var(--primary);width:32px;height:32px;"></div>
      <p style="font-size:0.82rem;color:var(--text-muted);">Fetching applications…</p>
    </div>`;
}

function showListError(msg) {
    document.getElementById('appList').innerHTML = `
    <div class="empty-queue">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <h4 style="color:var(--danger);">Cannot connect to server</h4>
      <p>Make sure <strong>node server.js</strong> is running.<br><small>${msg}</small></p>
    </div>`;
}

function renderList(apps) {
    const list = document.getElementById('appList');
    if (!apps.length) {
        list.innerHTML = `<div class="empty-queue">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <h4>No applications found</h4>
      <p>Adjust your filter or submit a new LC application.</p></div>`;
        return;
    }
    list.innerHTML = apps.map(app => `
    <div class="app-card status-${statusClass(app.status)} ${app.ref === selectedRef ? 'active' : ''}"
         onclick="selectApp('${app.ref}')">
      <div class="app-card-top">
        <span class="app-card-ref">${app.ref}</span>
        <span class="status-chip ${chipClass(app.status)}">${app.status}</span>
      </div>
      <div class="app-card-name">${app.applicantName || '—'}</div>
      <div class="app-card-meta">
        <span>${app.beneficiaryName || '—'}</span>
        <span>${app.beneficiaryCountry || '—'}</span>
        <span>${timeSince(app.submittedAt)}</span>
      </div>
      <div class="app-card-amount">${formatCurrency(app)} — ${app.lcType || ''} LC</div>
      <span class="app-card-credit ${creditClass(app.creditRating || 0)}">${creditLabel(app.creditRating || 0)} (${app.creditRating || 0}/100)</span>
    </div>`).join('');
}

// ── Filter Tabs ──
document.getElementById('filterTabs').addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    loadApplications();
});

// ── Search ──
document.getElementById('searchInput').addEventListener('input', function () {
    searchQuery = this.value.trim();
    clearTimeout(this._debounce);
    this._debounce = setTimeout(loadApplications, 350);
});

// ── Select Application → fetch single from API ──
async function selectApp(ref) {
    selectedRef = ref;

    // Update active card visually immediately
    document.querySelectorAll('.app-card').forEach(c => {
        c.classList.toggle('active', c.getAttribute('onclick')?.includes(ref));
    });

    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('detailContent').style.display = 'flex';
    document.getElementById('detailContent').style.flexDirection = 'column';
    document.getElementById('detailContent').style.height = '100%';

    // Show loading in detail pane
    document.getElementById('dApplicantName').textContent = 'Loading…';
    document.getElementById('dRef').textContent = ref;

    try {
        const { application } = await api(`/applications/${ref}`);
        populateDetail(application);
        populateSTPTab(application);
        switchTab('overview');
    } catch (e) {
        document.getElementById('dApplicantName').textContent = 'Error loading application.';
        console.error(e);
    }
}
window.selectApp = selectApp;

// ── Populate Detail Panel ──
function populateDetail(app) {
    document.getElementById('dRef').textContent = app.ref;
    document.getElementById('dApplicantName').textContent = app.applicantName || '—';
    document.getElementById('dLcType').textContent = (app.lcType || '—') + ' LC';
    document.getElementById('dSubmittedAt').textContent = 'Submitted: ' + formatDate(app.submittedAt) + ' · ' + timeSince(app.submittedAt);

    const pill = document.getElementById('dStatusPill');
    pill.textContent = app.status;
    pill.className = 'status-pill ' + statusClass(app.status);

    // Officer notes (pre-fill if exists)
    document.getElementById('officerNotes').value = app.officerNotes || '';

    // ── Overview ──
    rows('dApplicantRows', [
        ['Full Name', app.applicantName || '—'],
        ['City', app.applicantCity || '—'],
        ['Country', app.applicantCountry || '—'],
        ['Account No.', app.applicantAccount || '—'],
        ['Email', app.applicantEmail || '—'],
        ['Phone', app.applicantPhone || '—'],
        ['Client Status', app.clientStatus === 'existing' ? '✓ Existing Client' : '🆕 New Client'],
    ]);
    rows('dBeneficiaryRows', [
        ['Beneficiary', app.beneficiaryName || '—'],
        ['Country', app.beneficiaryCountry || '—'],
        ['Bank', app.beneficiaryBankName || '—'],
        ['SWIFT', app.beneficiarySwift || '—'],
        ['IBAN', app.beneficiaryIBAN || '—'],
    ]);
    rows('dLCRows', [
        ['LC Type', app.lcType || '—'],
        ['Currency', app.lcCurrency || '—'],
        ['Expiry Date', formatDate(app.lcExpiryDate)],
        ['Expiry Place', app.lcExpiryPlace || '—'],
        ['Partial Shipments', app.partialShipments || '—'],
        ['Transhipment', app.transhipment || '—'],
        ['Tolerance', (app.tolerancePct || 0) + '%'],
    ]);

    const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AED: 'د.إ', SGD: 'S$', CNY: '¥' }[app.lcCurrency] || '';
    const amt = parseFloat(app.lcAmount || 0);
    const withTol = (amt * (1 + (parseFloat(app.tolerancePct || 0) / 100))).toLocaleString(undefined, { maximumFractionDigits: 0 });
    document.getElementById('dAmountSummary').innerHTML = `
    <div class="amount-main">
      <div class="amount-main-label">LC Amount</div>
      <div class="amount-main-val">${sym}${amt.toLocaleString()}</div>
    </div>
    <div class="amount-sub"><span class="amount-sub-label">With Tolerance (${app.tolerancePct || 0}%)</span><span class="amount-sub-val">${sym}${withTol}</span></div>
    <div class="amount-sub"><span class="amount-sub-label">Payment Terms</span><span class="amount-sub-val">${app.paymentTerms || '—'}</span></div>
    <div class="amount-sub"><span class="amount-sub-label">Agreed Payment Date</span><span class="amount-sub-val">${formatDate(app.paymentAgreement)}</span></div>`;

    // ── Shipment ──
    rows('dShipmentRows', [
        ['Port of Loading', app.portLoading || '—'],
        ['Port of Discharge', app.portDischarge || '—'],
        ['Latest Shipment Date', formatDate(app.latestShipDate)],
        ['Incoterms', app.incoterms || '—'],
        ['Quantity', app.quantity || '—'],
        ['Unit Price', app.unitPrice || '—'],
        ['HS Code', app.hsCode || '—'],
        ['Country of Origin', app.countryOrigin || '—'],
    ]);
    document.getElementById('dGoods').textContent = app.goodsDesc || 'Not specified.';

    // ── Documents ──
    const docList = Array.isArray(app.documents) ? app.documents : [];
    document.getElementById('dDocsList').innerHTML = docList.length
        ? docList.map((d, i) => `
        <div class="doc-item">
          <div class="doc-item-icon">${String.fromCharCode(65 + i)}</div>
          <div><div class="doc-item-name">${d}</div></div>
        </div>`).join('')
        : '<p style="color:var(--text-muted);font-size:0.83rem;">No documents specified.</p>';
    document.getElementById('dSpecialInstructions').textContent = app.specialInstructions || 'No special instructions specified.';

    // ── Bank ──
    rows('dBankRows', [
        ['Issuing Bank', app.issuingBank || '—'],
        ['Advising Bank', app.advisingBank || '—'],
        ['Confirming Bank', app.confirmingBank || 'None'],
        ['Negotiating Bank', app.negotiatingBank || 'None'],
    ]);
    rows('dPaymentRows', [
        ['Payment Terms', app.paymentTerms || '—'],
        ['Agreed Payment Date', formatDate(app.paymentAgreement)],
        ['Tolerance %', (app.tolerancePct || 0) + '%'],
    ]);

    if (app.officerNotes) {
        rows('dPaymentRows', [
            ['Payment Terms', app.paymentTerms || '—'],
            ['Agreed Payment Date', formatDate(app.paymentAgreement)],
            ['Tolerance %', (app.tolerancePct || 0) + '%'],
            ['Officer Notes', app.officerNotes || '—'],
        ]);
    }

    // ── Credit Assessment ──
    const rating = app.creditRating || 0;
    document.getElementById('gaugeScore').textContent = rating;
    document.getElementById('gaugeLabel').textContent = rating >= 70 ? 'Strong' : rating >= 45 ? 'Moderate' : 'Weak';

    const arc = document.getElementById('gaugeArc');
    arc.style.transition = 'none';
    arc.style.strokeDashoffset = 283;
    setTimeout(() => {
        arc.style.transition = 'stroke-dashoffset 1.2s ease';
        arc.style.strokeDashoffset = 283 - (rating / 100) * 283;
    }, 80);

    const verdict = document.getElementById('scoreVerdict');
    if (rating >= 70) {
        verdict.className = 'score-verdict good';
        verdict.innerHTML = '✅ <strong>Strong Credit Profile</strong><br>Applicant demonstrates sound financial health. Low risk for Barclays.';
    } else if (rating >= 45) {
        verdict.className = 'score-verdict moderate';
        verdict.innerHTML = '⚠️ <strong>Moderate Credit Profile</strong><br>Additional collateral or co-applicant may be required. Proceed with due diligence.';
    } else {
        verdict.className = 'score-verdict low';
        verdict.innerHTML = '❌ <strong>Weak Credit Profile</strong><br>High risk — low CIBIL, no collateral. Consider requiring full cash margin or rejecting.';
    }

    document.getElementById('cdTurnover').textContent = app.annualTurnover || '—';
    document.getElementById('cdCibil').textContent = app.creditScore || '—';
    document.getElementById('cdYears').textContent = app.yearsInBusiness || '—';
    document.getElementById('cdBankLimit').textContent = app.existingBankLimit || '—';

    const collaterals = Array.isArray(app.collateral) ? app.collateral : [];
    document.getElementById('dCollateral').innerHTML = collaterals.length
        ? collaterals.map(c => `<span class="collateral-chip">${c}</span>`).join('')
        : '<span class="collateral-chip">None Offered</span>';

    // AI Recommendation
    const rec = document.getElementById('dAiRecommendation');
    if (rating >= 70) {
        rec.className = 'ai-recommendation good';
        rec.innerHTML = `🤖 <strong>AI Recommendation: APPROVE</strong><br>
      Credit score <strong>${rating}/100</strong>, turnover INR <strong>${app.annualTurnover || 0} Cr.</strong>,
      ${app.yearsInBusiness || 0} yrs in business, CIBIL <strong>${app.creditScore || 'N/A'}</strong>.
      Presents <strong>low risk</strong>. Recommend approval within requested LC amount.`;
    } else if (rating >= 45) {
        rec.className = 'ai-recommendation moderate';
        rec.innerHTML = `🤖 <strong>AI Recommendation: CONDITIONAL APPROVAL</strong><br>
      Credit score <strong>${rating}/100</strong> indicates moderate risk. Recommend 25% cash margin
      or enhanced collateral. Request latest audited financials before approval.`;
    } else {
        rec.className = 'ai-recommendation low';
        rec.innerHTML = `🤖 <strong>AI Recommendation: REJECT / REQUEST INFO</strong><br>
      Credit score <strong>${rating}/100</strong> — high risk. Insufficient collateral,
      CIBIL ${app.creditScore || 'N/A'}. Request additional documents or reject.`;
    }

    // LC Limit Suggestion
    const suggestedLimit = Math.min(amt, amt * (rating / 100) * 1.5);
    document.getElementById('dLcLimit').innerHTML = `
    <div>
      <div class="lc-limit-label">AI Suggested LC Limit</div>
      <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">Based on credit profile & risk assessment</div>
    </div>
    <div class="lc-limit-val">${sym}${Math.round(suggestedLimit).toLocaleString()}</div>`;
}

function rows(containerId, data) {
    document.getElementById(containerId).innerHTML = data
        .map(([k, v]) => `<div class="ds-row"><span class="ds-key">${k}</span><span class="ds-val">${v}</span></div>`)
        .join('');
}

// ── Tab Switching ──
document.getElementById('detailTabs').addEventListener('click', e => {
    const tab = e.target.closest('.dtab');
    if (!tab) return;
    switchTab(tab.dataset.tab);
});
function switchTab(name) {
    document.querySelectorAll('.dtab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const id = 'tab' + name.charAt(0).toUpperCase() + name.slice(1);
    document.getElementById(id)?.classList.add('active');
}

// ── Officer Actions → PATCH /api/applications/:ref ──
async function takeAction(newStatus) {
    if (!selectedRef) return;
    const notes = document.getElementById('officerNotes').value.trim();
    const officer = 'Riya Mehta';

    // Optimistic UI
    const pill = document.getElementById('dStatusPill');
    pill.textContent = newStatus;
    pill.className = 'status-pill ' + statusClass(newStatus);

    try {
        await api(`/applications/${selectedRef}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus, officerNotes: notes, actionBy: officer }),
        });

        showToast(newStatus);
        await loadStats();
        await loadApplications();

        // Re-select to refresh the detail panel
        if (selectedRef) await selectApp(selectedRef);

    } catch (e) {
        showToast(null, `Error: ${e.message}`);
        console.error(e);
    }
}
// ── Save Notes Only → PATCH /api/applications/:ref (notes only, no status change) ──
async function saveNotes() {
    if (!selectedRef) return;
    const notes = document.getElementById('officerNotes').value.trim();
    const btn = document.getElementById('btnSaveNotes');
    btn.disabled = true;
    btn.innerHTML = `<div class="ocr-spinner" style="width:13px;height:13px;border-width:2px;flex-shrink:0;"></div> Saving…`;
    try {
        await api(`/applications/${selectedRef}`, {
            method: 'PATCH',
            body: JSON.stringify({ officerNotes: notes, actionBy: 'Riya Mehta' }),
        });
        showToast(null, `📝 Note saved for ${selectedRef}`);
    } catch (e) {
        showToast(null, `⚠️ Failed to save note: ${e.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Note`;
    }
}
window.saveNotes = saveNotes;

function showToast(status, customMsg) {
    const icons = { Approved: '✅', Rejected: '❌', 'Under Review': '🔍', 'More Info Required': '📩' };
    const classes = { Approved: 'toast-approve', Rejected: 'toast-reject', 'Under Review': 'toast-review', 'More Info Required': 'toast-info' };
    const toast = document.getElementById('actionToast');
    toast.textContent = customMsg || `${icons[status] || '•'} Application ${selectedRef} marked as "${status}"`;
    toast.className = 'toast-notification ' + (classes[status] || 'toast-info');
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ── Auto-refresh every 30 seconds ──
function startAutoRefresh() {
    autoRefreshTimer = setInterval(async () => {
        await loadStats();
        await loadApplications();
    }, 30000);
}

// ── Init ──
(async function init() {
    await loadStats();
    await loadApplications();

    // Auto-select first app if available
    if (allApps.length) {
        await selectApp(allApps[0].ref);
    }

    startAutoRefresh();
})();

// ════════════════════════════════════════
//  STP DECISION TAB FUNCTIONS (Steps 6-11)
// ════════════════════════════════════════

// STP tab is populated via populateSTPTab() called directly from selectApp()

function populateSTPTab(app) {
    // Compliance toggles
    setComplianceToggle('ctKYC', app.kycStatus, 'kyc');
    setComplianceToggle('ctSancApp', app.sanctionsApplicant, 'sanctionsApplicant');
    setComplianceToggle('ctSancBen', app.sanctionsBeneficiary, 'sanctionsBeneficiary');
    setComplianceToggle('ctAML', app.amlStatus, 'aml');
    setComplianceToggle('ctCountry', app.sanctionsCountryRisk, 'sanctionsCountryRisk');

    // Cleared banner
    const allCleared = ['kycStatus', 'sanctionsApplicant', 'sanctionsBeneficiary', 'amlStatus', 'sanctionsCountryRisk']
        .every(k => app[k] === 'Cleared');
    const clearedMsg = document.getElementById('complianceClearedMsg');
    if (clearedMsg) clearedMsg.style.display = allCleared ? 'block' : 'none';

    // Collateral Valuation Grid
    const cv = document.getElementById('dCollateralValuation');
    if (cv) {
        const lcAmt = parseFloat(app.lcAmount || 0);
        const colType = app.collateralPrimaryType || 'N/A';
        const colVal = (app.fdAmount || app.secMarketValue || app.cashMarginAmount || app.collateralValue || 0);
        const haircut = parseFloat(app.haircutPct || 0);
        const eligible = parseFloat(app.eligibleCollateralValue || 0);
        cv.innerHTML = `
          <div class="cv-card"><div class="cv-label">Primary Collateral</div><div class="cv-value">${colType}</div><div class="cv-sub">by client</div></div>
          <div class="cv-card"><div class="cv-label">Gross Value</div><div class="cv-value">${Number(colVal).toLocaleString()}</div><div class="cv-sub">INR Crore</div></div>
          <div class="cv-card"><div class="cv-label">Haircut Applied</div><div class="cv-value">${haircut}%</div><div class="cv-sub">per Barclays policy</div></div>
          <div class="cv-card"><div class="cv-label">Eligible Value</div><div class="cv-value" style="color:var(--accent);">${Number(eligible).toLocaleString()}</div><div class="cv-sub">Post-haircut</div></div>
          <div class="cv-card"><div class="cv-label">LC Amount</div><div class="cv-value">${(app.lcCurrency || '')} ${lcAmt.toLocaleString()}</div><div class="cv-sub">Requested</div></div>
          <div class="cv-card"><div class="cv-label">STP Run At</div><div class="cv-value" style="font-size:0.72rem;">${app.stpRunAt ? formatDate(app.stpRunAt) : '—'}</div><div class="cv-sub">${app.stpRunBy || '—'}</div></div>
        `;
    }

    // STP Decision Result
    renderSTPResult(app.stpDecision, app.stpReason);

    // MT700 (if already generated)
    const mt700El = document.getElementById('dMT700');
    if (mt700El) {
        mt700El.textContent = app.mt700Draft && app.mt700Draft.trim()
            ? app.mt700Draft
            : 'MT700 not yet generated. Click the button below to generate on demand.';
    }
}

function setComplianceToggle(containerId, currentVal, field) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const val = (currentVal || 'Pending').toLowerCase().replace(/\s+/g, '');
    container.querySelectorAll('.ct-btn').forEach(btn => {
        const btnVal = btn.dataset.val;
        const btnNorm = btnVal.toLowerCase().replace(/\s+/g, '');
        btn.className = 'ct-btn' + (btnNorm === val ? ` active-${btnNorm}` : '');
    });
}

// Compliance toggle click handler
document.addEventListener('click', async function (e) {
    const btn = e.target.closest('.ct-btn');
    if (!btn || !selectedRef) return;
    const field = btn.dataset.field;
    const val = btn.dataset.val;
    if (!field || !val) return;

    // Optimistic visual update
    const container = btn.closest('.compliance-toggle');
    if (container) {
        container.querySelectorAll('.ct-btn').forEach(b => {
            const v = b.dataset.val.toLowerCase().replace(/\s+/g, '');
            b.className = 'ct-btn' + (b === btn ? ` active-${v}` : '');
        });
    }

    try {
        const payload = { officer: 'Riya Mehta' };
        payload[field] = val;
        await api(`/compliance/${selectedRef}`, { method: 'PATCH', body: JSON.stringify(payload) });
        // Refresh app data to update state
        const { application } = await api(`/applications/${selectedRef}`);
        populateSTPTab(application);
    } catch (err) {
        console.error('Compliance update failed:', err.message);
        showToast(null, '⚠️ Compliance update failed: ' + err.message);
    }
});

async function runDecisionEngine() {
    if (!selectedRef) return;
    const btn = document.getElementById('btnRunEngine');
    btn.disabled = true;
    btn.innerHTML = `<div class="ocr-spinner" style="width:16px;height:16px;border-width:2px;flex-shrink:0;"></div> Running…`;

    try {
        const data = await api(`/decision/${selectedRef}`, {
            method: 'POST',
            body: JSON.stringify({ officer: 'Riya Mehta' }),
        });
        renderSTPResult(data.decision, data.reason);
        // Refresh to get updated data including MT700 if applicable
        const { application } = await api(`/applications/${selectedRef}`);
        populateSTPTab(application);
        showToast(null, `⚡ STP Engine: Decision = ${data.decision}`);
    } catch (err) {
        document.getElementById('dStpResult').innerHTML = `<div style="color:var(--danger);">⚠️ Engine error: ${err.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run STP Eligibility Engine`;
    }
}
window.runDecisionEngine = runDecisionEngine;

function renderSTPResult(decision, reason) {
    const el = document.getElementById('dStpResult');
    if (!el) return;
    if (!decision || decision === 'PENDING') {
        el.className = 'stp-decision-result';
        el.innerHTML = '<span style="color:var(--text-muted);">No decision yet. Click "Run STP Eligibility Engine" above.</span>';
        return;
    }
    const icons = { YES: '✅', NO: '❌', REVIEW: '⚠️' };
    const labels = { YES: 'AUTO-APPROVED (STP)', NO: 'REJECTED (STP)', REVIEW: 'MANUAL REVIEW REQUIRED' };
    const cls = decision.toLowerCase();
    el.className = `stp-decision-result stp-result-${cls}`;
    el.innerHTML = `
      <div class="stp-result-title ${cls}">${icons[decision] || '•'} ${labels[decision] || decision}</div>
      <div class="stp-result-desc">${reason || '—'}</div>`;
}

async function loadMT700() {
    if (!selectedRef) return;
    const btn = document.getElementById('btnMT700');
    btn.disabled = true;
    btn.innerHTML = `<div class="ocr-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0;"></div> Generating…`;

    try {
        const data = await api(`/mt700/${selectedRef}`);
        const mt700El = document.getElementById('dMT700');
        if (mt700El) mt700El.textContent = data.draft || 'No draft available.';
    } catch (err) {
        document.getElementById('dMT700').textContent = '⚠️ Error loading MT700: ' + err.message;
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Generate / View MT700 Draft`;
    }
}
window.loadMT700 = loadMT700;

// ════════════════════════════════════════
//  PRE-DRAFT LC GENERATION (Tab Functions)
// ════════════════════════════════════════

let lastPredraftResult = null;

async function generatePreDraft() {
    if (!selectedRef) return;
    const btn = document.getElementById('btnGeneratePredraft');
    btn.disabled = true;
    btn.innerHTML = `<div class="ocr-spinner" style="width:15px;height:15px;border-width:2px;flex-shrink:0;"></div> Generating…`;

    // Hide all panels
    document.getElementById('predraftEmptyState').style.display = 'none';
    document.getElementById('predraftErrorPanel').style.display = 'none';
    document.getElementById('predraftSuccessPanel').style.display = 'none';
    document.getElementById('predraftValidation').style.display = 'none';

    try {
        const resp = await fetch(API_BASE + `/lc-predraft/${selectedRef}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ officer: 'Riya Mehta' }),
        });
        const data = await resp.json();

        if (data.status === 'ERROR' || !data.success) {
            // Show validation report
            renderValidationReport(data.validationSummary || null, false);
            // Show error panel
            const errPanel = document.getElementById('predraftErrorPanel');
            errPanel.style.display = 'block';
            document.getElementById('predraftErrorMsg').textContent = data.message || 'Generation failed.';
            const missingList = document.getElementById('predraftMissingList');
            if (data.missing_fields && data.missing_fields.length > 0) {
                missingList.innerHTML = '<strong>Missing mandatory fields:</strong><ul>' +
                    data.missing_fields.map(f => `<li>❌ ${f}</li>`).join('') + '</ul>';
            } else {
                missingList.innerHTML = '';
            }
            showToast(null, `⚠️ Pre-Draft LC generation failed: ${data.message || 'Missing fields'}`);
            return;
        }

        // Success!
        lastPredraftResult = data;

        // Show validation with all-green
        renderValidationReport(data.validation_summary, true);

        // Show warnings if any
        if (data.warnings && data.warnings.length > 0) {
            const warnEl = document.getElementById('predraftWarnings');
            warnEl.style.display = 'block';
            warnEl.innerHTML = data.warnings.map(w => `<div class="predraft-warning-item">⚠️ ${w}</div>`).join('');
        }

        // Meta row
        document.getElementById('predraftMetaRow').innerHTML = `
            <div class="predraft-meta-card">
                <div class="predraft-meta-label">LC Number</div>
                <div class="predraft-meta-value">${data.lc_number}</div>
            </div>
            <div class="predraft-meta-card">
                <div class="predraft-meta-label">Issue Date</div>
                <div class="predraft-meta-value">${formatDate(data.issue_date)}</div>
            </div>
            <div class="predraft-meta-card success">
                <div class="predraft-meta-label">Status</div>
                <div class="predraft-meta-value">✅ SUCCESS</div>
            </div>
            <div class="predraft-meta-card">
                <div class="predraft-meta-label">PDF Size</div>
                <div class="predraft-meta-value">${(data.pdf_size_bytes / 1024).toFixed(1)} KB</div>
            </div>
        `;

        // Clauses
        if (data.clauses) {
            const clauseNames = {
                partialShipmentClause: 'Partial Shipment',
                transshipmentClause: 'Transshipment',
                insuranceClause: 'Insurance',
                paymentClause: 'Payment',
                toleranceClause: 'Tolerance',
                presentationClause: 'Presentation Period',
                inspectionClause: 'Inspection',
                chargesClause: 'Banking Charges',
                governingRulesClause: 'Governing Rules',
                undertakingClause: 'Bank Undertaking',
            };
            const clauseIcons = {
                partialShipmentClause: '📦',
                transshipmentClause: '🚢',
                insuranceClause: '🛡️',
                paymentClause: '💳',
                toleranceClause: '📏',
                presentationClause: '📅',
                inspectionClause: '🔎',
                chargesClause: '💰',
                governingRulesClause: '⚖️',
                undertakingClause: '🏦',
            };
            const grid = document.getElementById('predraftClausesGrid');
            grid.innerHTML = Object.entries(clauseNames)
                .filter(([key]) => data.clauses[key])
                .map(([key, name]) => `
                    <div class="predraft-clause-card">
                        <div class="predraft-clause-header">
                            <span>${clauseIcons[key] || '📋'} ${name}</span>
                            <span class="predraft-clause-badge">Auto</span>
                        </div>
                        <div class="predraft-clause-text">${data.clauses[key].substring(0, 180)}${data.clauses[key].length > 180 ? '…' : ''}</div>
                    </div>
                `).join('');
        }

        // Fee Schedule
        if (data.fee_schedule) {
            const fs = data.fee_schedule;
            document.getElementById('predraftFeeHeader').innerHTML = `
                <div class="fee-header-row">
                    <div class="fee-header-item"><span class="fee-header-label">Tenor</span><span class="fee-header-val">${fs.tenorMonths} Month(s) — ${fs.tenorBand}</span></div>
                    <div class="fee-header-item"><span class="fee-header-label">Commission Range</span><span class="fee-header-val">${fs.commissionRange}</span></div>
                    <div class="fee-header-item"><span class="fee-header-label">Applied Rate</span><span class="fee-header-val highlight">${fs.appliedRate}%</span></div>
                    <div class="fee-header-item"><span class="fee-header-label">LC Amount</span><span class="fee-header-val">${fs.currency} ${fs.lcAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span></div>
                </div>`;
            document.getElementById('predraftFeeBody').innerHTML = fs.breakdown.map(f => `
                <tr>
                    <td>${f.item}</td>
                    <td><span class="fee-rate-badge">${f.rate}</span></td>
                    <td>${f.currency}</td>
                    <td class="fee-amt">${f.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>
            `).join('') + `
                <tr class="fee-amendment-row">
                    <td>Amendment Fee (per amendment)</td>
                    <td><span class="fee-rate-badge">Flat</span></td>
                    <td>INR</td>
                    <td class="fee-amt">${fs.amendmentFee.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                </tr>`;
            document.getElementById('predraftFeeFoot').innerHTML = `
                <tr class="fee-subtotal"><td colspan="3">Subtotal (Before Tax)</td><td class="fee-amt">${fs.currency} ${fs.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr class="fee-gst"><td colspan="3">GST @ ${fs.gstRate}%</td><td class="fee-amt">${fs.currency} ${fs.gstAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>
                <tr class="fee-grand-total"><td colspan="3">Estimated Total Charges</td><td class="fee-amt">${fs.currency} ${fs.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td></tr>`;
            document.getElementById('predraftFeeNote').textContent = fs.note;
        }

        // Draft text
        document.getElementById('predraftDraftViewer').textContent = data.draft_text;

        // Show success panel
        document.getElementById('predraftSuccessPanel').style.display = 'block';

        showToast(null, `✅ Pre-Draft LC generated: ${data.lc_number} | PDF ready for download`);

    } catch (err) {
        document.getElementById('predraftErrorPanel').style.display = 'block';
        document.getElementById('predraftErrorMsg').textContent = 'Network error: ' + err.message;
        document.getElementById('predraftMissingList').innerHTML = '';
        showToast(null, '⚠️ Pre-Draft LC generation failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg> Generate Pre-Draft LC`;
    }
}
window.generatePreDraft = generatePreDraft;

function renderValidationReport(summary, allPassed) {
    const container = document.getElementById('predraftValidation');
    if (!summary || !summary.fieldStatus) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';
    const grid = document.getElementById('predraftFieldGrid');
    grid.innerHTML = Object.entries(summary.fieldStatus).map(([key, info]) => `
        <div class="predraft-field-item ${info.present ? 'field-ok' : 'field-missing'}">
            <span class="predraft-field-icon">${info.present ? '✅' : '❌'}</span>
            <span class="predraft-field-label">${info.label}</span>
        </div>
    `).join('');
}

function copyDraftText() {
    const text = document.getElementById('predraftDraftViewer').textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        showToast(null, '📋 Draft text copied to clipboard!');
    }).catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(null, '📋 Draft text copied to clipboard!');
    });
}
window.copyDraftText = copyDraftText;

function downloadLCPDF() {
    if (!selectedRef) return;
    // Open the PDF download URL in a new tab
    window.open(API_BASE + `/lc-pdf/${selectedRef}`, '_blank');
}
window.downloadLCPDF = downloadLCPDF;

// Load stored pre-draft when switching to the predraft tab
function populatePreDraftTab(app) {
    // Reset panels
    document.getElementById('predraftErrorPanel').style.display = 'none';
    document.getElementById('predraftSuccessPanel').style.display = 'none';
    document.getElementById('predraftValidation').style.display = 'none';
    document.getElementById('predraftEmptyState').style.display = 'block';
    document.getElementById('predraftWarnings').style.display = 'none';
    lastPredraftResult = null;
}

// ════════════════════════════════════════
//  FINAL LC TAB
// ════════════════════════════════════════

function populateFinalLC(app) {
    if (!app) return;

    const sym = { USD: 'USD ', EUR: 'EUR ', GBP: 'GBP ', INR: 'INR ', JPY: 'JPY ', AED: 'AED ', SGD: 'SGD ', CNY: 'CNY ' }[app.lcCurrency] || (app.lcCurrency + ' ');
    const amt = parseFloat(app.lcAmount || 0).toLocaleString();

    // Generate a deterministic LC number from the app ref
    const lcNum = 'BRC/TF/LC/' + (app.ref || '').replace('BRC-LC-', '') + '/' + new Date().getFullYear();

    // Set field values
    const f = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val || '—';
    };

    f('flc_number', lcNum);
    f('flc_issue_date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }));
    f('flc_issuing_bank', app.issuingBank || 'Barclays Bank PLC, Trade Finance Centre, London E14 5HP');
    f('flc_type', (app.lcType || 'Irrevocable') + ' LC — ' + (app.paymentTerms || ''));
    f('flc_applicant', (app.applicantName || '—') + (app.applicantCity ? ', ' + app.applicantCity : '') + (app.applicantCountry ? ', ' + app.applicantCountry : ''));
    f('flc_beneficiary', (app.beneficiaryName || '—') + (app.beneficiaryCountry ? ', ' + app.beneficiaryCountry : '') + (app.beneficiaryBankName ? ' · ' + app.beneficiaryBankName : ''));
    f('flc_amount', sym + amt + (app.tolerancePct ? ' (±' + app.tolerancePct + '% tolerance)' : ''));
    f('flc_expiry', (formatDate(app.lcExpiryDate) || '—') + (app.lcExpiryPlace ? ' · ' + app.lcExpiryPlace : ''));
    f('flc_advising_bank', app.advisingBank || app.beneficiaryBankName || '—');
    f('flc_payment_terms', app.paymentTerms || '—');

    // Shipment
    const shipParts = [
        app.portLoading ? 'Port of Loading: ' + app.portLoading : null,
        app.portDischarge ? 'Port of Discharge: ' + app.portDischarge : null,
        app.latestShipDate ? 'Latest Shipment Date: ' + formatDate(app.latestShipDate) : null,
        app.incoterms ? 'Incoterms: ' + app.incoterms : null,
        app.partialShipments ? 'Partial Shipments: ' + app.partialShipments : null,
        app.transhipment ? 'Transhipment: ' + app.transhipment : null,
        app.quantity ? 'Quantity: ' + app.quantity : null,
        app.countryOrigin ? 'Country of Origin: ' + app.countryOrigin : null,
    ].filter(Boolean);
    f('flc_shipment', shipParts.length ? shipParts.join(' · ') : '—');

    // Goods
    f('flc_goods', app.goodsDesc || '—');

    // Documents required (numbered list)
    const docs = Array.isArray(app.documents) ? app.documents : [];
    const docsEl = document.getElementById('flc_documents');
    if (docsEl) {
        docsEl.textContent = docs.length
            ? docs.map((d, i) => (i + 1) + '. ' + d).join('\n')
            : '—';
        docsEl.style.whiteSpace = 'pre-line';
    }

    // Charges & governing rules already have default text in HTML
    // (they stay unless app overrides them)

    // Footer
    f('flc_ref', app.ref || '—');
    f('flc_gen_date', new Date().toLocaleString('en-GB'));

    // Officer name from the page
    f('flc_officer_name', 'Riya Mehta');
}

function printFinalLC() {
    if (!selectedRef) {
        alert('Please select an application first.');
        return;
    }
    window.print();
}
window.printFinalLC = printFinalLC;

// ── Hook populateFinalLC into selectApp ──
// Wrap the existing populateDetail to also populate finalLC
const _origPopulateDetail = populateDetail;
window.populateDetail = function (app) {
    _origPopulateDetail(app);
    populateFinalLC(app);
};

// ════════════════════════════════════════
//  SWIFT NETWORK GATEWAY (Tab Functions)
// ════════════════════════════════════════

async function generateSWIFTDraft() {
    if (!selectedRef) return;

    // Reset UI
    document.getElementById('swiftErrorPanel').style.display = 'none';
    document.getElementById('swiftTerminal').style.display = 'none';
    document.getElementById('swiftAuthBox').style.display = 'none';

    const btn = document.getElementById('btnGenSwift');
    const led = document.getElementById('swiftStatusLed');
    btn.disabled = true;
    btn.innerHTML = `<div class="ocr-spinner" style="width:14px;height:14px;border-width:2px;flex-shrink:0;"></div> Validating...`;
    led.className = 'swift-status-indicator processing';
    led.textContent = 'CONNECTING TO MODULE...';

    try {
        const resp = await fetch(API_BASE + `/swift-draft/${selectedRef}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ officer: 'Riya Mehta' }),
        });
        const data = await resp.json();

        if (data.status === 'ERROR' || !data.success) {
            // Show Validation Errors
            document.getElementById('swiftErrorPanel').style.display = 'block';
            const errList = document.getElementById('swiftErrorList');
            errList.innerHTML = (data.validation_errors || [data.message || data.error]).map(e => `<li>${e}</li>`).join('');

            led.className = 'swift-status-indicator error';
            led.textContent = 'VALIDATION FAILED';
            showToast(null, '❌ SWIFT Validation Failed');
            return;
        }

        // Success
        document.getElementById('swiftTerminal').style.display = 'block';
        document.getElementById('swiftMessageText').textContent = data.swift_text;

        document.getElementById('swiftTimestamp').textContent = new Date().toISOString();
        document.getElementById('swiftMsgType').textContent = data.message_type || 'MT700';

        // Show Auth Box Since Transmission requires it
        document.getElementById('swiftAuthBox').style.display = 'block';
        document.getElementById('swiftAuthNote').textContent = data.notes || 'Awaiting Authorization';

        led.className = 'swift-status-indicator ready';
        led.textContent = data.status || 'DRAFT_READY';

        showToast(null, '🌐 SWIFT Draft Generated Successfully');

    } catch (err) {
        document.getElementById('swiftErrorPanel').style.display = 'block';
        document.getElementById('swiftErrorList').innerHTML = `<li>Network Error: ${err.message}</li>`;
        led.className = 'swift-status-indicator error';
        led.textContent = 'SYSTEM ERROR';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Regenerate Draft';
    }
}
window.generateSWIFTDraft = generateSWIFTDraft;

function simulateSWIFTTransmit() {
    if (!selectedRef) return;
    const btn = document.getElementById('btnTransmitSwift');
    btn.disabled = true;
    btn.textContent = 'TRANSMITTING...';

    const led = document.getElementById('swiftStatusLed');
    led.className = 'swift-status-indicator processing';
    led.textContent = 'TRANSMITTING...';

    // Simulate network delay
    setTimeout(async () => {
        btn.textContent = 'TRANSMITTED (ACK)';
        led.className = 'swift-status-indicator transmitted';
        led.textContent = 'TRANSMITTED (ACK)';
        document.getElementById('swiftAuthNote').textContent = '✅ Message successfully dispatched to SWIFT network.';
        showToast(null, '📡 SWIFT Message Transmitted (Simulated)');

        // Update backend status to "Sent to Advising Bank"
        try {
            await fetch(API_BASE + '/applications/' + selectedRef, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: 'Sent to Advising Bank',
                    officerNotes: 'LC sent to Advising Bank via SWIFT Network.',
                    actionBy: 'Riya Mehta'
                })
            });

            // Update UI status badge
            const row = document.querySelector('.app-row.active');
            if (row) {
                const badge = row.querySelector('.status-badge');
                if (badge) {
                    badge.textContent = 'Sent to Advising Bank';
                    badge.className = 'status-badge active';
                }
            }
            const detailStatus = document.getElementById('detailStatus');
            if (detailStatus) {
                detailStatus.innerHTML = '<span class="status-badge active">Sent to Advising Bank</span>';
            }
        } catch (e) {
            console.error('Failed to update status', e);
        }
    }, 2000);
}
window.simulateSWIFTTransmit = simulateSWIFTTransmit;
