/* =========================================
   Barclays LOC Client Portal — Logic
   API-backed version (Node.js + SQLite)
   =========================================*/
'use strict';

const API_BASE = 'http://localhost:3000/api';

// ── State ──
let currentStep = 1;
const TOTAL_STEPS = 8;

// ── DOM References ──
const stepEls = document.querySelectorAll('.form-section');
const stepItems = document.querySelectorAll('.step-item');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const stepCounter = document.getElementById('stepCounter');
const progressFill = document.getElementById('progressFill');
const progressPct = document.getElementById('progressPct');
const formNav = document.getElementById('formNav');
const submitBtn = document.getElementById('submitBtn');
const reviewGrid = document.getElementById('reviewGrid');

// OCR
const ocrBanner = document.getElementById('ocrBanner');
const ocrUploadBtn = document.getElementById('ocrUploadBtn');
const pdfUpload = document.getElementById('pdfUpload');
const ocrProcessing = document.getElementById('ocrProcessing');
const ocrToast = document.getElementById('ocrToast');
const ocrToastMsg = document.getElementById('ocrToastMsg');
const ocrStatusTitle = document.getElementById('ocrStatusTitle');
const ocrStatusDesc = document.getElementById('ocrStatusDesc');

// ── Server Health Check ──
async function checkServer() {
    try {
        const r = await fetch(`${API_BASE}/stats`, { signal: AbortSignal.timeout(3000) });
        return r.ok;
    } catch {
        return false;
    }
}

function showServerWarning() {
    const warn = document.createElement('div');
    warn.id = 'serverWarn';
    warn.style.cssText = `
    position:fixed; top:70px; left:50%; transform:translateX(-50%);
    background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.4);
    color:#EF4444; padding:12px 24px; border-radius:10px; font-size:0.83rem;
    font-weight:600; z-index:9999; display:flex; align-items:center; gap:10px;
    box-shadow:0 4px 24px rgba(0,0,0,0.3);`;
    warn.innerHTML = `⚠️ Cannot connect to Barclays server at <strong>localhost:3000</strong>.
    Please run <code style="background:rgba(0,0,0,0.2);padding:2px 6px;border-radius:4px;">node server.js</code> and refresh.`;
    document.body.appendChild(warn);
}

// ── Step Navigation ──
function showStep(n) {
    stepEls.forEach(s => s.classList.remove('active'));
    stepItems.forEach((si, i) => {
        si.classList.remove('active');
        if (i + 1 < n) si.classList.add('completed');
        else si.classList.remove('completed');
    });

    const target = document.getElementById('step' + n);
    if (target) target.classList.add('active');
    stepItems[n - 1]?.classList.add('active');

    prevBtn.disabled = n === 1;
    nextBtn.innerHTML = n === TOTAL_STEPS
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Submit`
        : `Next <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>`;
    stepCounter.textContent = `Step ${n} of ${TOTAL_STEPS}`;
    updateProgress(n);

    if (n === TOTAL_STEPS) buildReview();
    if (n === 7) updateCreditPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateProgress(n) {
    const pct = Math.round(((n - 1) / TOTAL_STEPS) * 100);
    progressFill.style.width = pct + '%';
    progressPct.textContent = pct + '%';
}

prevBtn.addEventListener('click', () => { if (currentStep > 1) { currentStep--; showStep(currentStep); } });
nextBtn.addEventListener('click', () => {
    if (currentStep < TOTAL_STEPS) { currentStep++; showStep(currentStep); }
    else handleSubmit();
});
stepItems.forEach((si, i) => {
    si.addEventListener('click', () => { currentStep = i + 1; showStep(currentStep); });
});

// ── LC Type Cards ──
document.getElementById('lcTypeCards').addEventListener('click', e => {
    const card = e.target.closest('.lc-type-card');
    if (!card) return;
    document.querySelectorAll('.lc-type-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    document.getElementById('lcType').value = card.dataset.type;
});

// ── Payment Term Cards ──
document.getElementById('paymentTermsCards').addEventListener('click', e => {
    const card = e.target.closest('.payment-card');
    if (!card) return;
    document.querySelectorAll('.payment-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    document.getElementById('paymentTerms').value = card.dataset.term;
});

// ── Toggle Groups ──
function setupToggle(yesId, noId, hiddenId) {
    const yesEl = document.getElementById(yesId);
    const noEl = document.getElementById(noId);
    const hidden = document.getElementById(hiddenId);
    yesEl.addEventListener('click', () => { yesEl.classList.add('active'); noEl.classList.remove('active'); hidden.value = 'Yes'; });
    noEl.addEventListener('click', () => { noEl.classList.add('active'); yesEl.classList.remove('active'); hidden.value = 'No'; });
}
setupToggle('partialYes', 'partialNo', 'partialShipments');
setupToggle('transhipYes', 'transhipNo', 'transhipment');

// ── Collateral Primary Type Cards (Step 7 STP) ──
const COLLATERAL_SUBFORMS = { FD: 'fdSubForm', GOVT_BOND: 'secSubForm', LIQUID_SECURITY: 'secSubForm', CASH: 'cashSubForm' };

document.getElementById('collateralPrimaryCards').addEventListener('click', e => {
    const card = e.target.closest('.collateral-primary-card');
    if (!card) return;
    document.querySelectorAll('.collateral-primary-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    const type = card.dataset.type;
    document.getElementById('collateralPrimaryType').value = type;
    // Hide all sub-forms
    ['fdSubForm', 'secSubForm', 'cashSubForm'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    // Show relevant sub-form
    const subFormId = COLLATERAL_SUBFORMS[type];
    if (subFormId) { const sf = document.getElementById(subFormId); if (sf) sf.style.display = 'block'; }
    // Update credit preview
    if (currentStep === 7) updateCreditPreview();
});

// FD Lien toggle
setupToggle('fdLienYes', 'fdLienNo', 'fdLienMarked');
// Securities pledge toggle
setupToggle('secPledgedYes', 'secPledgedNo', 'secPledged');


// ── Doc Checkboxes ──
document.querySelectorAll('.doc-checkbox').forEach(label => {
    const cb = label.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
});

// ── Currency symbol ──
document.getElementById('lcCurrency').addEventListener('change', function () {
    const symbols = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AED: 'د.إ', SGD: 'S$', CNY: '¥' };
    document.getElementById('currencySymbol').textContent = symbols[this.value] || this.value;
});

// ── Financial File Upload Box ──
const finDocsBox = document.getElementById('finDocsBox');
const financialDocs = document.getElementById('financialDocs');
finDocsBox.addEventListener('click', () => financialDocs.click());
finDocsBox.addEventListener('dragover', e => { e.preventDefault(); finDocsBox.style.borderColor = 'var(--primary)'; });
finDocsBox.addEventListener('dragleave', () => { finDocsBox.style.borderColor = ''; });
finDocsBox.addEventListener('drop', e => {
    e.preventDefault(); finDocsBox.style.borderColor = '';
    if (e.dataTransfer.files[0]) showFinFile(e.dataTransfer.files[0]);
});
financialDocs.addEventListener('change', () => { if (financialDocs.files[0]) showFinFile(financialDocs.files[0]); });
function showFinFile(file) {
    finDocsBox.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="1.8"><polyline points="20 6 9 17 4 12"/></svg>
    <span>${file.name}</span>
    <small>${(file.size / 1024).toFixed(1)} KB — uploaded</small>`;
}

// ── Credit Scoring ──
function updateCreditPreview() {
    const turnover = parseFloat(document.getElementById('annualTurnover').value) || 0;
    const years = parseFloat(document.getElementById('yearsInBusiness').value) || 0;
    const cibil = parseFloat(document.getElementById('creditScore').value) || 0;
    const collaterals = document.querySelectorAll('input[name="collateral"]:checked');
    const hasCollateral = collaterals.length > 0 && [...collaterals].some(c => c.value !== 'None');

    if (!turnover && !years && !cibil) return;

    const scoreTurnover = Math.min(25, (turnover / 500) * 25);
    const scoreYears = Math.min(25, (years / 20) * 25);
    const scoreCredit = cibil >= 300 ? Math.min(25, ((cibil - 300) / 600) * 25) : 0;
    const scoreCollateral = hasCollateral ? 25 : 10;
    const total = Math.round(scoreTurnover + scoreYears + scoreCredit + scoreCollateral);

    document.getElementById('creditScoreDisplay').textContent = total;
    document.getElementById('barTurnover').style.width = (scoreTurnover / 25 * 100) + '%';
    document.getElementById('barCredit').style.width = (scoreCredit / 25 * 100) + '%';
    document.getElementById('barYears').style.width = (scoreYears / 25 * 100) + '%';
    document.getElementById('barCollateral').style.width = (scoreCollateral / 25 * 100) + '%';
    document.getElementById('scoreTurnover').textContent = Math.round(scoreTurnover);
    document.getElementById('scoreCredit').textContent = Math.round(scoreCredit);
    document.getElementById('scoreYears').textContent = Math.round(scoreYears);
    document.getElementById('scoreCollateral').textContent = Math.round(scoreCollateral);

    const rec = document.getElementById('creditRecommendation');
    if (total >= 75) {
        rec.className = 'credit-recommendation good';
        rec.innerHTML = `✅ <strong>Strong Credit Profile</strong> — You are likely eligible for a high LC limit with minimal collateral requirements.`;
    } else if (total >= 50) {
        rec.className = 'credit-recommendation moderate';
        rec.innerHTML = `⚠️ <strong>Moderate Credit Profile</strong> — You may qualify with additional collateral or a co-applicant. Our team will advise.`;
    } else {
        rec.className = 'credit-recommendation low';
        rec.innerHTML = `❌ <strong>Weak Credit Profile</strong> — Consider providing collateral, a guarantor, or improving your CIBIL score.`;
    }
}

['annualTurnover', 'yearsInBusiness', 'creditScore', 'collateralValue'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => { if (currentStep === 7) updateCreditPreview(); });
});
document.querySelectorAll('input[name="collateral"]').forEach(cb => {
    cb.addEventListener('change', () => { if (currentStep === 7) updateCreditPreview(); });
});

// ── Field helpers ──
function val(id) {
    const el = document.getElementById(id);
    if (!el) return '';
    return el.value.trim();
}

// ── Review Builder ──
function buildReview() {
    const docs = [...document.querySelectorAll('input[name="docs"]:checked')].map(c => c.value).join(', ') || '—';
    const collaterals = [...document.querySelectorAll('input[name="collateral"]:checked')].map(c => c.value).join(', ') || 'None';

    const sections = [
        {
            title: '🏢 Applicant', rows: [
                ['Company Name', val('applicantName') || '—'],
                ['Address', [val('applicantCity'), val('applicantCountry')].filter(Boolean).join(', ') || '—'],
                ['Account No.', val('applicantAccount') || '—'],
                ['Email', val('applicantEmail') || '—'],
                ['Phone', val('applicantPhone') || '—'],
            ]
        },
        {
            title: '🌍 Beneficiary', rows: [
                ['Beneficiary', val('beneficiaryName') || '—'],
                ['Country', val('beneficiaryCountry') || '—'],
                ['Bank', val('beneficiaryBankName') || '—'],
                ['SWIFT/BIC', val('beneficiarySwift') || '—'],
                ['IBAN', val('beneficiaryIBAN') || '—'],
            ]
        },
        {
            title: '📄 LC Details', rows: [
                ['LC Type', val('lcType') || '—'],
                ['Amount', val('lcCurrency') + ' ' + (parseFloat(val('lcAmount')) || 0).toLocaleString()],
                ['Expiry Date', val('lcExpiryDate') || '—'],
                ['Expiry Place', val('lcExpiryPlace') || '—'],
                ['Partial Shipments', val('partialShipments') || '—'],
                ['Transhipment', val('transhipment') || '—'],
                ['Tolerance', (val('tolerancePct') || '0') + '%'],
            ]
        },
        {
            title: '🚢 Shipment', rows: [
                ['Port of Loading', val('portLoading') || '—'],
                ['Port of Discharge', val('portDischarge') || '—'],
                ['Latest Ship Date', val('latestShipDate') || '—'],
                ['Incoterms', val('incoterms') || '—'],
                ['Goods', (val('goodsDesc') || '—').slice(0, 60) + (val('goodsDesc').length > 60 ? '…' : '')],
                ['Quantity', val('quantity') || '—'],
            ]
        },
        {
            title: '🏦 Bank & Payment', rows: [
                ['Issuing Bank', val('issuingBank') || '—'],
                ['Advising Bank', val('advisingBank') || '—'],
                ['Confirming Bank', val('confirmingBank') || '—'],
                ['Payment Terms', val('paymentTerms') || '—'],
            ]
        },
        {
            title: '💼 Credit Assessment', rows: [
                ['Annual Turnover', val('annualTurnover') ? 'INR ' + val('annualTurnover') + ' Cr.' : '—'],
                ['Credit Score', val('creditScore') || '—'],
                ['Years in Business', val('yearsInBusiness') || '—'],
                ['Collateral', collaterals],
            ]
        },
        { title: '📋 Documents', rows: [['Required Documents', docs]] },
    ];

    reviewGrid.innerHTML = sections.map(sec => `
    <div class="review-card">
      <div class="review-card-title">${sec.title}</div>
      ${sec.rows.map(([k, v]) => `
        <div class="review-row">
          <span class="review-key">${k}</span>
          <span class="review-val">${v}</span>
        </div>`).join('')}
    </div>`).join('');
}

// ── Declaration ──
document.getElementById('declarationCheck').addEventListener('change', function () {
    submitBtn.classList.toggle('ready', this.checked);
    submitBtn.disabled = !this.checked;
});

// ── Submit → POST to API ──
async function handleSubmit() {
    buildReview();

    const payload = collectFormData();

    // Show loading state on button
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<div class="btn-spinner"></div> Submitting…`;

    try {
        const response = await fetch(`${API_BASE}/applications`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Submission failed.');
        }

        // Show success screen
        currentStep = 9;
        document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
        formNav.style.display = 'none';
        ocrBanner.style.display = 'none';

        const successSec = document.getElementById('stepSuccess');
        successSec.style.display = 'block';
        successSec.classList.add('active');
        document.getElementById('refNumber').textContent = data.ref;
        window.scrollTo({ top: 0, behavior: 'smooth' });

    } catch (err) {
        submitBtn.disabled = false;
        submitBtn.classList.add('ready');
        submitBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Submit LC Application`;

        // Show inline error
        let errBox = document.getElementById('submitErrorBox');
        if (!errBox) {
            errBox = document.createElement('div');
            errBox.id = 'submitErrorBox';
            errBox.style.cssText = 'margin-top:14px;padding:12px 16px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.4);border-radius:8px;font-size:0.83rem;color:#EF4444;font-weight:600;';
            document.querySelector('.submit-area').appendChild(errBox);
        }
        errBox.textContent = `⚠️ ${err.message} — Make sure the Barclays server is running (node server.js).`;
    }
}

function collectFormData() {
    const docs = [...document.querySelectorAll('input[name="docs"]:checked')].map(c => c.value);
    const collaterals = [...document.querySelectorAll('input[name="collateral"]:checked')].map(c => c.value);
    return {
        // Applicant
        applicantName: val('applicantName'), applicantAddress: val('applicantAddress'),
        applicantCity: val('applicantCity'), applicantCountry: val('applicantCountry'),
        applicantAccount: val('applicantAccount'), applicantGST: val('applicantGST'),
        applicantPhone: val('applicantPhone'), applicantEmail: val('applicantEmail'),
        clientStatus: document.querySelector('input[name="clientStatus"]:checked')?.value || 'existing',
        // Beneficiary
        beneficiaryName: val('beneficiaryName'), beneficiaryAddress: val('beneficiaryAddress'),
        beneficiaryCity: val('beneficiaryCity'), beneficiaryCountry: val('beneficiaryCountry'),
        beneficiaryBankName: val('beneficiaryBankName'), beneficiarySwift: val('beneficiarySwift'),
        beneficiaryIBAN: val('beneficiaryIBAN'), beneficiaryEmail: val('beneficiaryEmail'),
        // LC Details
        lcType: val('lcType'), lcCurrency: val('lcCurrency'), lcAmount: val('lcAmount'),
        lcExpiryDate: val('lcExpiryDate'), lcExpiryPlace: val('lcExpiryPlace'),
        partialShipments: val('partialShipments'), transhipment: val('transhipment'), tolerancePct: val('tolerancePct'),
        // Shipment
        portLoading: val('portLoading'), portDischarge: val('portDischarge'),
        latestShipDate: val('latestShipDate'), incoterms: val('incoterms'),
        goodsDesc: val('goodsDesc'), quantity: val('quantity'), unitPrice: val('unitPrice'),
        hsCode: val('hsCode'), countryOrigin: val('countryOrigin'),
        // Documents
        documents: docs, additionalDocs: val('additionalDocs'),
        // Bank & Payment
        issuingBank: val('issuingBank'), advisingBank: val('advisingBank'),
        confirmingBank: val('confirmingBank'), negotiatingBank: val('negotiatingBank'),
        paymentTerms: val('paymentTerms'), specialInstructions: val('specialInstructions'),
        // Credit Assessment (Basic)
        annualTurnover: val('annualTurnover'), yearsInBusiness: val('yearsInBusiness'),
        creditScore: val('creditScore'), existingBankLimit: val('existingBankLimit'),
        collateral: collaterals, collateralValue: val('collateralValue'),
        paymentAgreement: val('paymentAgreement'),
        creditRating: computeCreditRating(),
        // STEP 5: Collateral Primary Type
        collateralPrimaryType: val('collateralPrimaryType') || 'NONE',
        // FD Details
        fdNumber: val('fdNumber'), fdBank: val('fdBank'), fdAmount: val('fdAmount'),
        fdCurrency: val('fdCurrency'), fdMaturityDate: val('fdMaturityDate'), fdLienMarked: val('fdLienMarked') || 'No',
        // Securities Details
        secISIN: val('secISIN'), secIssuer: val('secIssuer'), secMarketValue: val('secMarketValue'),
        secQuantity: val('secQuantity'), secCustodian: val('secCustodian'),
        secVolatility: val('secVolatility') || 'Low', secPledged: val('secPledged') || 'No',
        // Cash Margin
        cashMarginAmount: val('cashMarginAmount'),
    };
}


function computeCreditRating() {
    const turnover = parseFloat(document.getElementById('annualTurnover').value) || 0;
    const years = parseFloat(document.getElementById('yearsInBusiness').value) || 0;
    const cibil = parseFloat(document.getElementById('creditScore').value) || 0;
    const collaterals = document.querySelectorAll('input[name="collateral"]:checked');
    const hasCollateral = collaterals.length > 0 && [...collaterals].some(c => c.value !== 'None');
    const s = Math.min(25, (turnover / 500) * 25) + Math.min(25, (years / 20) * 25) +
        (cibil >= 300 ? Math.min(25, ((cibil - 300) / 600) * 25) : 0) + (hasCollateral ? 25 : 10);
    return Math.round(s);
}

// ── OCR via Tesseract.js ──
ocrUploadBtn.addEventListener('click', () => pdfUpload.click());
pdfUpload.addEventListener('change', async () => {
    const file = pdfUpload.files[0];
    if (!file) return;
    await runOCR(file);
});

async function runOCR(file) {
    ocrBanner.style.display = 'none';
    ocrProcessing.style.display = 'flex';
    ocrToast.style.display = 'none';

    try {
        let imageDataURL;
        if (file.type === 'application/pdf') {
            ocrStatusTitle.textContent = 'Rendering PDF page…';
            ocrStatusDesc.textContent = 'Converting PDF to image for OCR processing.';
            imageDataURL = await pdfToImageDataURL(file);
        } else {
            imageDataURL = await fileToDataURL(file);
        }

        ocrStatusTitle.textContent = 'Extracting text with AI…';
        ocrStatusDesc.textContent = 'Tesseract OCR is reading your document. This may take 15–30 seconds.';

        const result = await Tesseract.recognize(imageDataURL, 'eng', {
            logger: m => {
                if (m.status === 'recognizing text') {
                    ocrStatusDesc.textContent = `Recognizing text… ${Math.round(m.progress * 100)}%`;
                }
            }
        });

        ocrStatusTitle.textContent = 'Mapping fields…';
        await sleep(500);
        const fields = extractLCFields(result.data.text);
        populateFields(fields);

        ocrProcessing.style.display = 'none';
        ocrBanner.style.display = 'none';
        ocrToast.style.display = 'flex';
        const count = Object.values(fields).filter(v => v).length;
        ocrToastMsg.textContent = `✅ ${count} fields auto-populated from your document!`;
        currentStep = 1; showStep(1);

    } catch (err) {
        console.error('OCR Error:', err);
        ocrProcessing.style.display = 'none';
        ocrBanner.style.display = 'flex';
        ocrToast.style.display = 'flex';
        ocrToast.style.borderColor = 'rgba(239,68,68,0.4)';
        ocrToast.style.background = 'rgba(239,68,68,0.08)';
        ocrToastMsg.textContent = '⚠️ Could not extract text. Please fill fields manually.';
    }
}

async function pdfToImageDataURL(file) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2.0 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toDataURL('image/png');
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Smart Field Extraction (unchanged from original) ──
function extractLCFields(text) {
    const t = text;
    const fields = {};

    function after(pattern) {
        const m = t.match(new RegExp(pattern + '[:\\s]+([^\\n\\r]+)', 'i'));
        return m ? m[1].trim().replace(/\s+/g, ' ') : '';
    }
    function firstMatch(patterns) {
        for (const p of patterns) { const r = after(p); if (r) return r; }
        return '';
    }

    const amtMatch = t.match(/(?:LC|letter of credit|amount)[^0-9]*([A-Z]{0,3})\s*([0-9][0-9,\.]+)/i);
    if (amtMatch) fields.lcAmount = amtMatch[2].replace(/,/g, '');

    fields.applicantName = firstMatch(['applicant(?:\\s+name)?', 'buyer(?:\\s+name)?', 'importer(?:\\s+name)?']);
    fields.applicantAddress = firstMatch(['applicant address', 'buyer address', 'company address']);
    fields.applicantEmail = (t.match(/[\w.-]+@[\w.-]+\.\w{2,4}/) || [])[0] || '';
    fields.applicantPhone = (t.match(/(?:\+?91[-.\s]?)?(?:[6-9]\d{9}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/) || [])[0] || '';
    fields.applicantAccount = firstMatch(['account(?:\\s+no(?:\.)?|\\s+number)', 'a\\/c no']);
    fields.beneficiaryName = firstMatch(['beneficiary(?:\\s+name)?', 'supplier(?:\\s+name)?', 'exporter(?:\\s+name)?', 'seller']);
    fields.beneficiaryCountry = firstMatch(['beneficiary country', 'country of beneficiary', 'supplier country']);
    fields.beneficiaryBankName = firstMatch(['beneficiary bank', 'advising bank name', 'correspondent bank']);
    fields.beneficiarySwift = (t.match(/\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/) || [])[1] || '';
    fields.beneficiaryIBAN = (t.match(/[A-Z]{2}\d{2}[A-Z0-9]{1,30}/) || [])[0] || '';

    fields.lcType = (() => {
        if (/usance/i.test(t)) return 'Usance';
        if (/revolv/i.test(t)) return 'Revolving';
        if (/standby/i.test(t)) return 'Standby';
        if (/sight/i.test(t)) return 'Sight';
        return '';
    })();
    fields.lcCurrency = (() => {
        const m = t.match(/\b(USD|EUR|GBP|INR|JPY|AED|SGD|CNY)\b/i);
        return m ? m[1].toUpperCase() : '';
    })();
    fields.lcExpiryDate = (() => {
        const m = t.match(/expir[yi]\w*\s+date[:\s]+([0-9]{1,2}[/\-.][0-9]{1,2}[/\-.][0-9]{2,4})/i);
        if (m) {
            const parts = m[1].split(/[/\-.]/);
            if (parts.length === 3) {
                const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                return `${y}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        return '';
    })();
    fields.lcExpiryPlace = firstMatch(['place of expiry', 'expiry place']);
    fields.portLoading = firstMatch(['port of loading', 'loading port', 'port of shipment']);
    fields.portDischarge = firstMatch(['port of discharge', 'discharge port', 'destination port']);
    fields.latestShipDate = (() => {
        const m = t.match(/(?:latest|last)\s+(?:ship(?:ment)?|dispatch)\s+date[:\s]+([0-9]{1,2}[/\-.][0-9]{1,2}[/\-.][0-9]{2,4})/i);
        if (m) {
            const parts = m[1].split(/[/\-.]/);
            if (parts.length === 3) {
                const y = parts[2].length === 2 ? '20' + parts[2] : parts[2];
                return `${y}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
        return '';
    })();
    fields.incoterms = (() => { const m = t.match(/\b(FOB|CIF|CFR|EXW|DAP|DDP|FCA|CPT)\b/i); return m ? m[1].toUpperCase() : ''; })();
    fields.goodsDesc = firstMatch(['description of goods', 'goods description', 'merchandise', 'commodity']);
    fields.quantity = firstMatch(['quantity', 'units', 'qty']);
    fields.hsCode = (t.match(/\bHS\s*Code[:\s]+([0-9.]+)/i) || [])[1] || '';
    fields.advisingBank = firstMatch(['advising bank', 'correspondent bank']);
    fields.paymentTerms = (() => {
        if (/at\s+sight/i.test(t)) return 'At Sight';
        const m = t.match(/(\d+)\s*days?/i);
        return m ? m[1] + ' Days' : '';
    })();
    fields.tolerancePct = (t.match(/tolerance\s*[:\s]*([0-9]+)\s*%/i) || [])[1] || '';
    fields.partialShipments = /partial\s+shipment\s+not/i.test(t) ? 'No' : (/partial\s+shipment\s+allowed/i.test(t) ? 'Yes' : '');
    fields.transhipment = /transshipment\s+not/i.test(t) ? 'No' : (/transshipment\s+allowed/i.test(t) ? 'Yes' : '');

    return fields;
}

function populateFields(f) {
    function set(id, value) { const el = document.getElementById(id); if (el && value) el.value = value; }
    set('applicantName', f.applicantName); set('applicantAddress', f.applicantAddress);
    set('applicantEmail', f.applicantEmail); set('applicantPhone', f.applicantPhone);
    set('applicantAccount', f.applicantAccount);
    set('beneficiaryName', f.beneficiaryName); set('beneficiaryCountry', f.beneficiaryCountry);
    set('beneficiaryBankName', f.beneficiaryBankName); set('beneficiarySwift', f.beneficiarySwift);
    set('beneficiaryIBAN', f.beneficiaryIBAN);
    if (f.lcType) {
        document.getElementById('lcType').value = f.lcType;
        document.querySelectorAll('.lc-type-card').forEach(c => c.classList.toggle('active', c.dataset.type === f.lcType));
    }
    if (f.lcCurrency) {
        document.getElementById('lcCurrency').value = f.lcCurrency;
        const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹', JPY: '¥', AED: 'د.إ', SGD: 'S$', CNY: '¥' };
        document.getElementById('currencySymbol').textContent = sym[f.lcCurrency] || f.lcCurrency;
    }
    set('lcAmount', f.lcAmount); set('lcExpiryDate', f.lcExpiryDate); set('lcExpiryPlace', f.lcExpiryPlace);
    if (f.partialShipments === 'No') { document.getElementById('partialNo').classList.add('active'); document.getElementById('partialYes').classList.remove('active'); document.getElementById('partialShipments').value = 'No'; }
    if (f.transhipment === 'No') { document.getElementById('transhipNo').classList.add('active'); document.getElementById('transhipYes').classList.remove('active'); document.getElementById('transhipment').value = 'No'; }
    set('tolerancePct', f.tolerancePct);
    set('portLoading', f.portLoading); set('portDischarge', f.portDischarge);
    set('latestShipDate', f.latestShipDate);
    if (f.incoterms) document.getElementById('incoterms').value = f.incoterms;
    set('goodsDesc', f.goodsDesc); set('quantity', f.quantity); set('hsCode', f.hsCode);
    set('advisingBank', f.advisingBank);
    if (f.paymentTerms) {
        document.getElementById('paymentTerms').value = f.paymentTerms;
        document.querySelectorAll('.payment-card').forEach(c => c.classList.toggle('active', c.dataset.term === f.paymentTerms));
    }
}

// ── Toast Close ──
document.getElementById('ocrToastClose').addEventListener('click', () => { ocrToast.style.display = 'none'; });

// ── Init ──
(async function init() {
    const ok = await checkServer();
    if (!ok) showServerWarning();

    showStep(1);
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('lcExpiryDate').min = today;
    document.getElementById('latestShipDate').min = today;
    document.getElementById('paymentAgreement').min = today;

    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
})();
