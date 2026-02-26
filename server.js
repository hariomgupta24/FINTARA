/**
 * ================================================================
 *  Barclays Bank — Letter of Credit System
 *  Full STP (Straight-Through Processing) Backend
 *  Steps 1-12 per Barclays LC Workflow Specification
 * ================================================================
 */
'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { validateLC, generateLCDraft, generateLCPDF } = require('./lc-generator');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'barclay_lc.db');
const PREDRAFTS_DIR = path.join(__dirname, 'predrafts');
if (!fs.existsSync(PREDRAFTS_DIR)) fs.mkdirSync(PREDRAFTS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

const db = new sqlite3.Database(DB_PATH, err => {
  if (err) { console.error('DB open error:', err.message); process.exit(1); }
  console.log('  📂  Connected to SQLite:', DB_PATH);
  initDB();
});

const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const get = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));

// ── DDL ──
async function initDB() {
  await run(`PRAGMA journal_mode=WAL`);

  // Core applications table
  await run(`
    CREATE TABLE IF NOT EXISTS lc_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending Review',
      submitted_at TEXT NOT NULL,
      action_date TEXT, action_by TEXT, officer_notes TEXT,
      credit_rating INTEGER DEFAULT 0,
      -- Applicant
      applicant_name TEXT, applicant_address TEXT, applicant_city TEXT, applicant_country TEXT,
      applicant_account TEXT, applicant_gst TEXT, applicant_phone TEXT, applicant_email TEXT,
      client_status TEXT DEFAULT 'existing',
      -- Beneficiary
      beneficiary_name TEXT, beneficiary_address TEXT, beneficiary_city TEXT, beneficiary_country TEXT,
      beneficiary_bank TEXT, beneficiary_swift TEXT, beneficiary_iban TEXT, beneficiary_email TEXT,
      -- LC Details
      lc_type TEXT, lc_currency TEXT, lc_amount REAL,
      lc_expiry_date TEXT, lc_expiry_place TEXT,
      partial_shipments TEXT DEFAULT 'Yes', transhipment TEXT DEFAULT 'Yes', tolerance_pct REAL DEFAULT 5,
      -- Shipment
      port_loading TEXT, port_discharge TEXT, latest_ship_date TEXT, incoterms TEXT,
      goods_desc TEXT, quantity TEXT, unit_price TEXT, hs_code TEXT, country_origin TEXT,
      -- Documents
      documents TEXT, additional_docs TEXT,
      -- Bank & Payment
      issuing_bank TEXT DEFAULT 'Barclays Bank PLC, India',
      advising_bank TEXT, confirming_bank TEXT, negotiating_bank TEXT,
      payment_terms TEXT, special_instructions TEXT,
      -- Credit Assessment (Basic)
      annual_turnover REAL, years_in_business INTEGER, credit_score INTEGER,
      existing_bank_limit REAL, collateral TEXT, collateral_value REAL, payment_agreement TEXT,
      -- STEP 5: Collateral Sub-Details
      collateral_primary_type TEXT DEFAULT 'NONE',
      -- FD Details
      fd_number TEXT, fd_bank TEXT, fd_amount REAL, fd_currency TEXT,
      fd_maturity_date TEXT, fd_lien_marked TEXT DEFAULT 'No',
      -- Securities Details
      sec_isin TEXT, sec_issuer TEXT, sec_market_value REAL, sec_quantity TEXT,
      sec_custodian TEXT, sec_volatility TEXT DEFAULT 'Low', sec_pledged TEXT DEFAULT 'No',
      -- Cash Margin
      cash_margin_amount REAL,
      -- STEP 6: KYC & Compliance
      kyc_status TEXT DEFAULT 'Pending',
      kyc_notes TEXT,
      sanctions_applicant TEXT DEFAULT 'Pending',
      sanctions_beneficiary TEXT DEFAULT 'Pending',
      sanctions_country_risk TEXT DEFAULT 'Pending',
      aml_status TEXT DEFAULT 'Pending',
      aml_system TEXT DEFAULT 'Temenos',
      compliance_cleared_at TEXT, compliance_cleared_by TEXT,
      -- STEP 7: Credit Limit & Exposure
      approved_credit_facility REAL DEFAULT 0,
      available_limit REAL DEFAULT 0,
      existing_exposures REAL DEFAULT 0,
      -- STEP 8-9: Collateral Valuation & Rule Engine
      haircut_pct REAL DEFAULT 0,
      eligible_collateral_value REAL DEFAULT 0,
      stp_decision TEXT DEFAULT 'PENDING',
      stp_reason TEXT,
      stp_run_at TEXT,
      stp_run_by TEXT,
      -- STEP 11: MT700 Draft
      mt700_draft TEXT,
      mt700_generated_at TEXT
    )
  `);

  // Audit trail table (extended)
  await run(`
    CREATE TABLE IF NOT EXISTS officer_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      action TEXT NOT NULL,
      action_type TEXT DEFAULT 'STATUS_CHANGE',
      notes TEXT, officer TEXT,
      metadata TEXT,
      action_at TEXT NOT NULL
    )
  `);

  // ── Band 3: Document Presentations ──
  await run(`
    CREATE TABLE IF NOT EXISTS document_presentations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      submitted_by TEXT DEFAULT 'Beneficiary',
      commercial_invoice TEXT, bill_of_lading TEXT, packing_list TEXT,
      certificate_of_origin TEXT, insurance_cert TEXT, inspection_cert TEXT,
      weight_cert TEXT, additional_docs TEXT,
      invoice_amount REAL, invoice_currency TEXT, invoice_date TEXT,
      bl_number TEXT, bl_date TEXT, vessel_name TEXT,
      shipment_date TEXT, shipment_port TEXT, discharge_port TEXT,
      status TEXT DEFAULT 'Submitted',
      examiner TEXT, examined_at TEXT, examination_notes TEXT
    )
  `);

  // ── Band 3: Discrepancies ──
  await run(`
    CREATE TABLE IF NOT EXISTS discrepancies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      presentation_id INTEGER,
      field_name TEXT NOT NULL,
      lc_value TEXT, doc_value TEXT,
      severity TEXT DEFAULT 'MINOR',
      rule_matched TEXT,
      description TEXT,
      status TEXT DEFAULT 'Open',
      resolved_at TEXT, resolved_by TEXT,
      resolution_note TEXT
    )
  `);

  // ── Band 3: Amendments ──
  await run(`
    CREATE TABLE IF NOT EXISTS amendments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      amendment_number INTEGER DEFAULT 1,
      requested_at TEXT NOT NULL,
      requested_by TEXT DEFAULT 'Client',
      field_changed TEXT, old_value TEXT, new_value TEXT,
      reason TEXT,
      status TEXT DEFAULT 'Pending',
      approved_by TEXT, approved_at TEXT,
      mt707_draft TEXT,
      fee_impact REAL DEFAULT 0
    )
  `);

  // ── Band 3: Payments & Settlement ──
  await run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      payment_type TEXT DEFAULT 'LC_PAYMENT',
      amount REAL, currency TEXT,
      initiated_at TEXT, authorized_by TEXT,
      status TEXT DEFAULT 'Pending',
      debit_account TEXT, credit_account TEXT,
      settlement_ref TEXT,
      completed_at TEXT,
      payment_method TEXT DEFAULT 'SWIFT',
      mt103_draft TEXT, mt202_draft TEXT
    )
  `);

  // ── Band 4: Notifications ──
  await run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL,
      type TEXT NOT NULL,
      recipient TEXT, channel TEXT DEFAULT 'SYSTEM',
      subject TEXT, body TEXT,
      sent_at TEXT NOT NULL,
      status TEXT DEFAULT 'Sent',
      read_at TEXT
    )
  `);

  // Safe ALTER TABLE for any new columns (idempotent)
  const cols = ['collateral_primary_type', 'fd_number', 'fd_bank', 'fd_amount', 'fd_currency',
    'fd_maturity_date', 'fd_lien_marked', 'sec_isin', 'sec_issuer', 'sec_market_value', 'sec_quantity',
    'sec_custodian', 'sec_volatility', 'sec_pledged', 'cash_margin_amount',
    'kyc_status', 'kyc_notes', 'sanctions_applicant', 'sanctions_beneficiary', 'sanctions_country_risk',
    'aml_status', 'aml_system', 'compliance_cleared_at', 'compliance_cleared_by',
    'approved_credit_facility', 'available_limit', 'existing_exposures',
    'haircut_pct', 'eligible_collateral_value', 'stp_decision', 'stp_reason',
    'stp_run_at', 'stp_run_by', 'mt700_draft', 'mt700_generated_at',
    // Pre-Draft LC Module columns (Step 12)
    'predraft_lc_number', 'predraft_text', 'predraft_pdf_path', 'predraft_generated_at',
    // Band 3 — Post-issuance lifecycle columns
    'doc_presentation_status', 'payment_status', 'fund_blocked_amount', 'fund_block_ref',
    'amendment_count', 'lc_closed_at'];

  const existingCols = await all(`PRAGMA table_info(lc_applications)`);
  const existingNames = new Set(existingCols.map(c => c.name));
  for (const col of cols) {
    if (!existingNames.has(col)) {
      try { await run(`ALTER TABLE lc_applications ADD COLUMN ${col} TEXT`); } catch { }
    }
  }

  // Safe ALTER TABLE for officer_actions new columns
  const actionCols = ['action_type', 'metadata'];
  const existingActionCols = await all(`PRAGMA table_info(officer_actions)`);
  const existingActionNames = new Set(existingActionCols.map(c => c.name));
  for (const col of actionCols) {
    if (!existingActionNames.has(col)) {
      try { await run(`ALTER TABLE officer_actions ADD COLUMN ${col} TEXT`); } catch { }
    }
  }

  console.log('  ✅  Full STP schema ready (Band 1-4 workflow).');
  checkAndSeed();
}

// ── Row → App object ──
function rowToApp(r) {
  if (!r) return null;
  return {
    ref: r.ref, status: r.status, submittedAt: r.submitted_at,
    actionDate: r.action_date, actionBy: r.action_by, officerNotes: r.officer_notes,
    creditRating: r.credit_rating,
    applicantName: r.applicant_name, applicantAddress: r.applicant_address,
    applicantCity: r.applicant_city, applicantCountry: r.applicant_country,
    applicantAccount: r.applicant_account, applicantGST: r.applicant_gst,
    applicantPhone: r.applicant_phone, applicantEmail: r.applicant_email,
    clientStatus: r.client_status,
    beneficiaryName: r.beneficiary_name, beneficiaryAddress: r.beneficiary_address,
    beneficiaryCity: r.beneficiary_city, beneficiaryCountry: r.beneficiary_country,
    beneficiaryBankName: r.beneficiary_bank, beneficiarySwift: r.beneficiary_swift,
    beneficiaryIBAN: r.beneficiary_iban, beneficiaryEmail: r.beneficiary_email,
    lcType: r.lc_type, lcCurrency: r.lc_currency, lcAmount: r.lc_amount,
    lcExpiryDate: r.lc_expiry_date, lcExpiryPlace: r.lc_expiry_place,
    partialShipments: r.partial_shipments, transhipment: r.transhipment, tolerancePct: r.tolerance_pct,
    portLoading: r.port_loading, portDischarge: r.port_discharge,
    latestShipDate: r.latest_ship_date, incoterms: r.incoterms,
    goodsDesc: r.goods_desc, quantity: r.quantity, unitPrice: r.unit_price,
    hsCode: r.hs_code, countryOrigin: r.country_origin,
    documents: safeJSON(r.documents, []), additionalDocs: r.additional_docs,
    issuingBank: r.issuing_bank, advisingBank: r.advising_bank,
    confirmingBank: r.confirming_bank, negotiatingBank: r.negotiating_bank,
    paymentTerms: r.payment_terms, specialInstructions: r.special_instructions,
    annualTurnover: r.annual_turnover, yearsInBusiness: r.years_in_business,
    creditScore: r.credit_score, existingBankLimit: r.existing_bank_limit,
    collateral: safeJSON(r.collateral, []), collateralValue: r.collateral_value,
    paymentAgreement: r.payment_agreement,
    // Step 5 — Collateral Details
    collateralPrimaryType: r.collateral_primary_type || 'NONE',
    fdNumber: r.fd_number, fdBank: r.fd_bank, fdAmount: r.fd_amount,
    fdCurrency: r.fd_currency, fdMaturityDate: r.fd_maturity_date, fdLienMarked: r.fd_lien_marked,
    secISIN: r.sec_isin, secIssuer: r.sec_issuer, secMarketValue: r.sec_market_value,
    secQuantity: r.sec_quantity, secCustodian: r.sec_custodian,
    secVolatility: r.sec_volatility, secPledged: r.sec_pledged,
    cashMarginAmount: r.cash_margin_amount,
    // Step 6 — Compliance
    kycStatus: r.kyc_status || 'Pending',
    kycNotes: r.kyc_notes,
    sanctionsApplicant: r.sanctions_applicant || 'Pending',
    sanctionsBeneficiary: r.sanctions_beneficiary || 'Pending',
    sanctionsCountryRisk: r.sanctions_country_risk || 'Pending',
    amlStatus: r.aml_status || 'Pending',
    amlSystem: r.aml_system || 'Temenos',
    complianceClearedAt: r.compliance_cleared_at,
    complianceClearedBy: r.compliance_cleared_by,
    // Step 7 — Credit Exposure
    approvedCreditFacility: r.approved_credit_facility || 0,
    availableLimit: r.available_limit || 0,
    existingExposures: r.existing_exposures || 0,
    // Step 8-9 — Valuation & Decision
    haircutPct: r.haircut_pct || 0,
    eligibleCollateralValue: r.eligible_collateral_value || 0,
    stpDecision: r.stp_decision || 'PENDING',
    stpReason: r.stp_reason,
    stpRunAt: r.stp_run_at,
    stpRunBy: r.stp_run_by,
    // Step 11 — MT700
    mt700Draft: r.mt700_draft,
    mt700GeneratedAt: r.mt700_generated_at,
    // Band 3 — Post-issuance lifecycle
    docPresentationStatus: r.doc_presentation_status || 'Pending',
    paymentStatus: r.payment_status || 'Pending',
    fundBlockedAmount: r.fund_blocked_amount,
    fundBlockRef: r.fund_block_ref,
    amendmentCount: r.amendment_count || 0,
    lcClosedAt: r.lc_closed_at,
  };
}

function safeJSON(v, fb) { try { return v ? JSON.parse(v) : fb; } catch { return fb; } }
function genRef() { return `BRC-LC-${new Date().getFullYear()}-${String(Math.floor(10000 + Math.random() * 90000))}`; }

// ════════════════════════════════════════════════════════
// STEP 9 — RULE ENGINE (mirrors the spec's Python function)
// ════════════════════════════════════════════════════════
const COLLATERAL_MARGINS = {
  'FD': 0.00,   // Fixed Deposit — 0% haircut
  'LIQUID_SECURITY': 0.15,   // Highly liquid equity — 15%
  'GOVT_BOND': 0.10,   // Government bonds/securities — 10%
  'CASH': 0.00,   // Cash margin — 0%
  'PROPERTY': 0.40,   // Immovable property — 40% (illiquid)
  'MACHINERY': 0.50,   // Plant & Machinery — 50%
  'RECEIVABLES': 0.25,   // Trade receivables — 25%
};

function lcDecision(collateralType, collateralValue, lcAmount) {
  if (!(collateralType in COLLATERAL_MARGINS)) {
    return { decision: 'REVIEW', reason: `Unknown collateral type: ${collateralType}. Manual review required.`, margin: null, eligibleValue: 0 };
  }
  const margin = COLLATERAL_MARGINS[collateralType];
  const eligibleValue = collateralValue * (1 - margin);
  const decision = eligibleValue >= lcAmount ? 'YES' : (eligibleValue >= lcAmount * 0.75 ? 'REVIEW' : 'NO');
  const reason = decision === 'YES'
    ? `Collateral sufficient. Eligible value ${eligibleValue.toFixed(2)} ≥ LC Amount ${lcAmount}.`
    : decision === 'REVIEW'
      ? `Collateral partially covers LC. Eligible ${eligibleValue.toFixed(2)} is 75-100% of LC Amount ${lcAmount}. Manual review advised.`
      : `Insufficient collateral. Eligible value ${eligibleValue.toFixed(2)} < LC Amount ${lcAmount}.`;
  return { decision, margin, eligibleValue, reason };
}

// ════════════════════════════════════════════════════════
// STEP 11 — MT700 DRAFT GENERATOR
// ════════════════════════════════════════════════════════
function generateMT700(app) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amt = parseFloat(app.lc_amount || 0).toFixed(2);
  const currency = (app.lc_currency || 'USD').toUpperCase();
  const expiry = (app.lc_expiry_date || '').replace(/-/g, '').slice(0, 6);
  const expiryFull = (app.lc_expiry_date || '').replace(/-/g, '');
  const latestShip = (app.latest_ship_date || '').replace(/-/g, '');
  const tolerance = app.tolerance_pct || 5;
  const docs = safeJSON(app.documents, []).join(',\n   ');

  return `***** SWIFT MT700 — ISSUE OF A DOCUMENTARY CREDIT *****
Generated by: Barclays LC System | ${new Date().toLocaleString('en-IN')}
======================================================================

:27: SEQUENCE OF TOTAL
  1/1

:40A: FORM OF DOCUMENTARY CREDIT
  ${(app.lc_type || 'SIGHT').toUpperCase()} IRREVOCABLE

:20: DOCUMENTARY CREDIT NUMBER
  ${app.ref || 'TBD'}

:31C: DATE OF ISSUE
  ${dateStr}

:40E: APPLICABLE RULES
  UCP LATEST VERSION

:31D: DATE AND PLACE OF EXPIRY
  ${expiryFull} ${(app.lc_expiry_place || '').toUpperCase()}

:50: APPLICANT
  ${(app.applicant_name || '').toUpperCase()}
  ${(app.applicant_address || '').toUpperCase()}
  ${(app.applicant_city || '').toUpperCase()}, ${(app.applicant_country || '').toUpperCase()}

:59: BENEFICIARY
  ${(app.beneficiary_name || '').toUpperCase()}
  ${(app.beneficiary_address || '').toUpperCase()}
  ${(app.beneficiary_city || '').toUpperCase()}, ${(app.beneficiary_country || '').toUpperCase()}

:32B: CURRENCY CODE, AMOUNT
  ${currency}${amt}

:39A: PERCENTAGE CREDIT AMOUNT TOLERANCE
  ${tolerance}/${tolerance}

:41A: AVAILABLE WITH... BY...
  ${(app.advising_bank || 'BARCLAYS BANK PLC').toUpperCase()}
  BY ${app.lc_type === 'Sight' ? 'PAYMENT' : app.lc_type === 'Usance' ? 'ACCEPTANCE' : 'NEGOTIATION'}

:42C: DRAFTS AT...
  ${app.payment_terms === 'At Sight' ? 'SIGHT' : (app.payment_terms || 'SIGHT').toUpperCase()}

:42A: DRAWEE
  ${(app.issuing_bank || 'BARCLAYS BANK PLC, INDIA').toUpperCase()}

:43P: PARTIAL SHIPMENTS
  ${app.partial_shipments === 'Yes' ? 'ALLOWED' : 'NOT ALLOWED'}

:43T: TRANSHIPMENT
  ${app.transhipment === 'Yes' ? 'ALLOWED' : 'NOT ALLOWED'}

:44E: PORT OF LOADING/AIRPORT OF DEPARTURE
  ${(app.port_loading || '').toUpperCase()}

:44F: PORT OF DISCHARGE/AIRPORT OF DESTINATION
  ${(app.port_discharge || '').toUpperCase()}

:44C: LATEST DATE OF SHIPMENT
  ${latestShip}

:44B: PLACE OF FINAL DESTINATION
  ${(app.port_discharge || '').toUpperCase()}

:45A: DESCRIPTION OF GOODS AND/OR SERVICES
  ${(app.goods_desc || '').toUpperCase()}
  QUANTITY: ${(app.quantity || '').toUpperCase()}
  UNIT PRICE: ${(app.unit_price || '').toUpperCase()}
  HS CODE: ${app.hs_code || 'N/A'}
  COUNTRY OF ORIGIN: ${(app.country_origin || '').toUpperCase()}
  INCOTERMS: ${(app.incoterms || '').toUpperCase()}

:46A: DOCUMENTS REQUIRED
   ${docs.toUpperCase()}
   ${app.additional_docs ? app.additional_docs.toUpperCase() : ''}

:47A: ADDITIONAL CONDITIONS
  ${(app.special_instructions || 'NIL').toUpperCase()}

:71B: CHARGES
  ALL BANKING CHARGES OUTSIDE INDIA ARE FOR ACCOUNT OF BENEFICIARY

:48: PERIOD FOR PRESENTATION
  DOCUMENTS TO BE PRESENTED WITHIN 21 DAYS AFTER DATE OF SHIPMENT
  BUT WITHIN THE VALIDITY OF THE CREDIT.

:49: CONFIRMATION INSTRUCTIONS
  ${app.confirming_bank ? 'CONFIRM' : 'WITHOUT'}

:53A: REIMBURSING BANK
  ${(app.confirming_bank || app.advising_bank || 'BARCLAYS BANK PLC').toUpperCase()}

:78: INSTRUCTIONS TO THE PAYING/ACCEPTING/NEGOTIATING BANK
  ALL DOCUMENTS MUST BE FORWARDED TO US IN ONE LOT BY COURIER.
  UPON RECEIPT OF DOCUMENTS STRICTLY COMPLYING WITH THE TERMS AND
  CONDITIONS OF THIS CREDIT, WE SHALL REIMBURSE AS PER YOUR INSTRUCTIONS.

:72: SENDER TO RECEIVER INFORMATION
  ISSUED SUBJECT TO UCP 600.
  FOR BARCLAYS BANK PLC, ${(app.issuing_bank || 'INDIA').toUpperCase()}

======================================================================
***** END OF MT700 MESSAGE *****`;
}

// ════════════════════════════════════════════════════════
// API ROUTES
// ════════════════════════════════════════════════════════

// GET /api/applications
app.get('/api/applications', async (req, res) => {
  try {
    const { status, q } = req.query;
    let sql = 'SELECT * FROM lc_applications WHERE 1=1';
    const params = [];
    if (status && status !== 'All') { sql += ' AND status = ?'; params.push(status); }
    if (q) {
      const like = `%${q}%`;
      sql += ' AND (applicant_name LIKE ? OR ref LIKE ? OR beneficiary_name LIKE ? OR beneficiary_country LIKE ?)';
      params.push(like, like, like, like);
    }
    sql += ' ORDER BY submitted_at DESC';
    const rows = await all(sql, params);
    res.json({ success: true, applications: rows.map(rowToApp), total: rows.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/applications/:ref
app.get('/api/applications/:ref', async (req, res) => {
  try {
    const row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row) return res.status(404).json({ success: false, error: 'Application not found.' });
    res.json({ success: true, application: rowToApp(row) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/applications
app.post('/api/applications', async (req, res) => {
  const d = req.body;
  const ref = genRef();
  const now = new Date().toISOString();
  try {
    await run(`
      INSERT INTO lc_applications (
        ref, status, submitted_at, credit_rating,
        applicant_name, applicant_address, applicant_city, applicant_country,
        applicant_account, applicant_gst, applicant_phone, applicant_email, client_status,
        beneficiary_name, beneficiary_address, beneficiary_city, beneficiary_country,
        beneficiary_bank, beneficiary_swift, beneficiary_iban, beneficiary_email,
        lc_type, lc_currency, lc_amount, lc_expiry_date, lc_expiry_place,
        partial_shipments, transhipment, tolerance_pct,
        port_loading, port_discharge, latest_ship_date, incoterms,
        goods_desc, quantity, unit_price, hs_code, country_origin,
        documents, additional_docs,
        issuing_bank, advising_bank, confirming_bank, negotiating_bank,
        payment_terms, special_instructions,
        annual_turnover, years_in_business, credit_score, existing_bank_limit,
        collateral, collateral_value, payment_agreement,
        collateral_primary_type,
        fd_number, fd_bank, fd_amount, fd_currency, fd_maturity_date, fd_lien_marked,
        sec_isin, sec_issuer, sec_market_value, sec_quantity, sec_custodian, sec_volatility, sec_pledged,
        cash_margin_amount
      ) VALUES (
        ?,?,?,?,
        ?,?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,
        ?,?,?,?,?,?,?,?,?,
        ?,?,
        ?,?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?,
        ?,?,?,?,?,?,
        ?,?,?,?,?,?,?,
        ?
      )`,
      [
        ref, 'Pending Review', now, d.creditRating || 0,
        d.applicantName || '', d.applicantAddress || '', d.applicantCity || '', d.applicantCountry || '',
        d.applicantAccount || '', d.applicantGST || '', d.applicantPhone || '', d.applicantEmail || '', d.clientStatus || 'existing',
        d.beneficiaryName || '', d.beneficiaryAddress || '', d.beneficiaryCity || '', d.beneficiaryCountry || '',
        d.beneficiaryBankName || '', d.beneficiarySwift || '', d.beneficiaryIBAN || '', d.beneficiaryEmail || '',
        d.lcType || '', d.lcCurrency || '', parseFloat(d.lcAmount) || 0, d.lcExpiryDate || '', d.lcExpiryPlace || '',
        d.partialShipments || 'Yes', d.transhipment || 'Yes', parseFloat(d.tolerancePct) || 5,
        d.portLoading || '', d.portDischarge || '', d.latestShipDate || '', d.incoterms || '',
        d.goodsDesc || '', d.quantity || '', d.unitPrice || '', d.hsCode || '', d.countryOrigin || '',
        JSON.stringify(d.documents || []), d.additionalDocs || '',
        d.issuingBank || 'Barclays Bank PLC, India', d.advisingBank || '', d.confirmingBank || '', d.negotiatingBank || '',
        d.paymentTerms || '', d.specialInstructions || '',
        parseFloat(d.annualTurnover) || 0, parseInt(d.yearsInBusiness) || 0, parseInt(d.creditScore) || 0, parseFloat(d.existingBankLimit) || 0,
        JSON.stringify(d.collateral || []), parseFloat(d.collateralValue) || 0, d.paymentAgreement || '',
        d.collateralPrimaryType || 'NONE',
        d.fdNumber || '', d.fdBank || '', parseFloat(d.fdAmount) || 0, d.fdCurrency || '', d.fdMaturityDate || '', d.fdLienMarked || 'No',
        d.secISIN || '', d.secIssuer || '', parseFloat(d.secMarketValue) || 0, d.secQuantity || '', d.secCustodian || '', d.secVolatility || 'Low', d.secPledged || 'No',
        parseFloat(d.cashMarginAmount) || 0,
      ]
    );
    res.status(201).json({ success: true, ref, message: 'Application submitted successfully.' });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: e.message }); }
});

// PATCH /api/applications/:ref — status + notes
app.patch('/api/applications/:ref', async (req, res) => {
  const { status, officerNotes, actionBy } = req.body;
  const now = new Date().toISOString();
  const officer = actionBy || 'Barclays Officer';
  try {
    const exists = await get('SELECT ref FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!exists) return res.status(404).json({ success: false, error: 'Not found.' });
    const updates = []; const params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (officerNotes !== undefined) { updates.push('officer_notes = ?'); params.push(officerNotes); }
    updates.push('action_date = ?', 'action_by = ?');
    params.push(now, officer, req.params.ref);
    await run(`UPDATE lc_applications SET ${updates.join(', ')} WHERE ref = ?`, params);
    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, status || 'Note Added', 'STATUS_CHANGE', officerNotes || '', officer, now]);
    res.json({ success: true, message: `Updated to "${status}".` });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PATCH /api/compliance/:ref — STEP 6: KYC, Sanctions, AML updates
app.patch('/api/compliance/:ref', async (req, res) => {
  const { kyc, kycNotes, sanctionsApplicant, sanctionsBeneficiary, sanctionsCountryRisk, aml, amlSystem, officer } = req.body;
  const now = new Date().toISOString();
  const by = officer || 'Compliance Officer';
  try {
    const updates = []; const params = [];
    if (kyc !== undefined) { updates.push('kyc_status = ?'); params.push(kyc); }
    if (kycNotes !== undefined) { updates.push('kyc_notes = ?'); params.push(kycNotes); }
    if (sanctionsApplicant !== undefined) { updates.push('sanctions_applicant = ?'); params.push(sanctionsApplicant); }
    if (sanctionsBeneficiary !== undefined) { updates.push('sanctions_beneficiary = ?'); params.push(sanctionsBeneficiary); }
    if (sanctionsCountryRisk !== undefined) { updates.push('sanctions_country_risk = ?'); params.push(sanctionsCountryRisk); }
    if (aml !== undefined) { updates.push('aml_status = ?'); params.push(aml); }
    if (amlSystem !== undefined) { updates.push('aml_system = ?'); params.push(amlSystem); }
    // Check if all cleared
    const row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    const newKyc = kyc ?? row.kyc_status;
    const newSA = sanctionsApplicant ?? row.sanctions_applicant;
    const newSB = sanctionsBeneficiary ?? row.sanctions_beneficiary;
    const newSC = sanctionsCountryRisk ?? row.sanctions_country_risk;
    const newAml = aml ?? row.aml_status;
    if ([newKyc, newSA, newSB, newSC, newAml].every(s => s === 'Cleared')) {
      updates.push('compliance_cleared_at = ?', 'compliance_cleared_by = ?');
      params.push(now, by);
    }
    params.push(req.params.ref);
    await run(`UPDATE lc_applications SET ${updates.join(', ')} WHERE ref = ?`, params);
    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, 'Compliance Updated', 'COMPLIANCE', JSON.stringify(req.body), by, now]);
    res.json({ success: true, message: 'Compliance status updated.' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/decision/:ref — STEPS 8-9: Collateral Valuation + Rule Engine
app.post('/api/decision/:ref', async (req, res) => {
  const officer = req.body.officer || 'System (Auto)';
  try {
    const row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row) return res.status(404).json({ success: false, error: 'Not found.' });

    const collType = (row.collateral_primary_type || 'NONE').toUpperCase();
    const lcAmount = parseFloat(row.lc_amount) || 0;

    // Determine collateral value based on type
    let collValue = 0;
    if (collType === 'FD' || collType === 'CASH') {
      collValue = parseFloat(row.fd_amount || row.cash_margin_amount || row.collateral_value) || 0;
    } else if (['LIQUID_SECURITY', 'GOVT_BOND'].includes(collType)) {
      collValue = parseFloat(row.sec_market_value || row.collateral_value) || 0;
    } else {
      collValue = parseFloat(row.collateral_value) || 0;
    }

    const result = lcDecision(collType, collValue, lcAmount);
    const now = new Date().toISOString();

    // Generate MT700 if decision is YES
    let mt700 = row.mt700_draft || null;
    let mt700At = row.mt700_generated_at || null;
    if (result.decision === 'YES') {
      mt700 = generateMT700(row);
      mt700At = now;
    }

    await run(`
      UPDATE lc_applications SET
        haircut_pct = ?, eligible_collateral_value = ?,
        stp_decision = ?, stp_reason = ?, stp_run_at = ?, stp_run_by = ?,
        mt700_draft = ?, mt700_generated_at = ?
      WHERE ref = ?`,
      [
        (result.margin || 0) * 100, result.eligibleValue || 0,
        result.decision, result.reason, now, officer,
        mt700, mt700At, req.params.ref,
      ]
    );

    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, metadata, action_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, `STP Decision: ${result.decision}`, 'RULE_ENGINE',
      result.reason, officer, JSON.stringify(result), now]);

    res.json({
      success: true, decision: result.decision, eligibleValue: result.eligibleValue,
      margin: result.margin, reason: result.reason, haircutPct: (result.margin || 0) * 100,
      mt700Generated: result.decision === 'YES'
    });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/mt700/:ref — STEP 11: MT700 Draft
app.get('/api/mt700/:ref', async (req, res) => {
  try {
    const row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row) return res.status(404).json({ success: false, error: 'Not found.' });
    if (!row.mt700_draft) {
      // Generate on-demand even if not auto-approved yet
      const draft = generateMT700(row);
      const now = new Date().toISOString();
      await run(`UPDATE lc_applications SET mt700_draft = ?, mt700_generated_at = ? WHERE ref = ?`, [draft, now, req.params.ref]);
      return res.json({ success: true, draft, generatedAt: now, onDemand: true });
    }
    res.json({ success: true, draft: row.mt700_draft, generatedAt: row.mt700_generated_at, onDemand: false });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/stats
app.get('/api/stats', async (req, res) => {
  try {
    const count = s => get(`SELECT COUNT(*) as n FROM lc_applications${s ? ' WHERE status=?' : ''}`, s ? [s] : []);
    const [total, pending, review, approved, rejected, info, stp_yes, stp_no, stp_rev] = await Promise.all([
      count(null), count('Pending Review'), count('Under Review'),
      count('Approved'), count('Rejected'), count('More Info Required'),
      get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='YES'"),
      get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='NO'"),
      get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='REVIEW'"),
    ]);
    res.json({
      success: true, stats: {
        total: total.n, pending: pending.n, review: review.n,
        approved: approved.n, rejected: rejected.n, info: info.n,
        stpAutoApprove: stp_yes.n, stpReject: stp_no.n, stpReview: stp_rev.n,
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/actions/:ref — Full Audit Trail
app.get('/api/actions/:ref', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM officer_actions WHERE ref = ? ORDER BY action_at DESC', [req.params.ref]);
    res.json({ success: true, actions: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/seed
app.post('/api/seed', async (req, res) => {
  try {
    const row = await get('SELECT COUNT(*) as n FROM lc_applications');
    if (row.n > 0) return res.json({ success: true, message: `DB has ${row.n} apps. Skipping.` });

    const DEMO = [
      { ref: 'BRC-LC-2024-71842', status: 'Pending Review', submitted_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), credit_rating: 87, applicant_name: 'Infosys Technologies Ltd.', applicant_city: 'Pune', applicant_country: 'India', applicant_account: '55001234567890', applicant_email: 'finance@infosys.com', applicant_phone: '+91 98765 43210', client_status: 'existing', beneficiary_name: 'Siemens AG', beneficiary_country: 'Germany', beneficiary_bank: 'Deutsche Bank AG, Frankfurt', beneficiary_swift: 'DEUTDEFF', beneficiary_iban: 'DE55200400600266696700', lc_type: 'Sight', lc_currency: 'EUR', lc_amount: 1250000, lc_expiry_date: '2025-06-30', lc_expiry_place: 'Frankfurt, Germany', partial_shipments: 'Yes', transhipment: 'No', tolerance_pct: 5, port_loading: 'Hamburg Port, Germany', port_discharge: 'JNPT, Mumbai, India', latest_ship_date: '2025-05-15', incoterms: 'CIF', goods_desc: 'Industrial CNC Laser Cutting Machines (Model: SIMATIC S7-1500) as per PO-2024-00891', quantity: '8 Units', unit_price: 'EUR 156,250 per unit', hs_code: '8457.10', country_origin: 'Germany', documents: JSON.stringify(['Commercial Invoice', 'Bill of Lading', 'Packing List', 'Certificate of Origin', 'Insurance Certificate']), issuing_bank: 'Barclays Bank PLC, India', advising_bank: 'Deutsche Bank AG', negotiating_bank: 'HSBC, Mumbai', payment_terms: 'At Sight', special_instructions: 'All documents in triplicate. SGS inspection required.', annual_turnover: 85000, years_in_business: 38, credit_score: 832, existing_bank_limit: 500, collateral: JSON.stringify(['Fixed Deposit']), collateral_value: 200, payment_agreement: '2025-07-15', collateral_primary_type: 'FD', fd_number: 'FD/PNB/2024/887654', fd_bank: 'Punjab National Bank', fd_amount: 200, fd_currency: 'INR', fd_maturity_date: '2025-12-31', fd_lien_marked: 'Yes', kyc_status: 'Cleared', sanctions_applicant: 'Cleared', sanctions_beneficiary: 'Cleared', sanctions_country_risk: 'Cleared', aml_status: 'Cleared', stp_decision: 'YES', stp_reason: 'FD collateral sufficient. Eligible 200.00 >= LC Amount 1250000.', haircut_pct: 0, eligible_collateral_value: 200 },
      { ref: 'BRC-LC-2024-64391', status: 'Under Review', submitted_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(), credit_rating: 74, action_by: 'Riya Mehta', officer_notes: 'Under review of transformer specs and CEIG norms.', applicant_name: 'Bharat Heavy Electricals Ltd.', applicant_city: 'New Delhi', applicant_country: 'India', applicant_account: '55009876543210', applicant_email: 'procurement@bhel.in', applicant_phone: '+91 11 2601 2392', client_status: 'existing', beneficiary_name: 'ABB Group', beneficiary_country: 'Switzerland', beneficiary_bank: 'UBS AG, Zurich', beneficiary_swift: 'UBSWCHZH80A', beneficiary_iban: 'CH56 0483 5012 3456 7800 9', lc_type: 'Usance', lc_currency: 'USD', lc_amount: 3700000, lc_expiry_date: '2025-09-30', lc_expiry_place: 'Zurich, Switzerland', partial_shipments: 'Yes', transhipment: 'Yes', tolerance_pct: 10, port_loading: 'Port of Zurich (Air)', port_discharge: 'IGI Airport, New Delhi', latest_ship_date: '2025-08-20', incoterms: 'DAP', goods_desc: 'High Voltage Power Transformers (400kV) for NTPC Vindhyachal Project TN-2024-338', quantity: '4 Nos.', unit_price: 'USD 925,000 per unit', hs_code: '8504.21', country_origin: 'Switzerland', documents: JSON.stringify(['Commercial Invoice', 'Bill of Lading', 'Packing List', 'Certificate of Origin', 'Inspection Certificate', 'Weight/Measurement Certificate']), additional_docs: 'CEIG clearance certificate required', issuing_bank: 'Barclays Bank PLC, India', advising_bank: 'UBS AG, Zurich', confirming_bank: 'Barclays Bank PLC, London', payment_terms: '90 Days', special_instructions: 'Payment deferred 90 days. TÜV certificate mandatory.', annual_turnover: 28000, years_in_business: 60, credit_score: 778, existing_bank_limit: 2000, collateral: JSON.stringify(['Govt. Securities']), collateral_value: 500, payment_agreement: '2025-12-01', collateral_primary_type: 'GOVT_BOND', sec_isin: 'IN0020180066', sec_issuer: 'Government of India', sec_market_value: 500, sec_quantity: '5000 units', sec_custodian: 'NSDL', sec_volatility: 'Low', sec_pledged: 'Yes', kyc_status: 'Cleared', sanctions_applicant: 'Cleared', sanctions_beneficiary: 'Pending', sanctions_country_risk: 'Cleared', aml_status: 'Pending', stp_decision: 'REVIEW', stp_reason: 'Collateral partially covers LC. Manual review advised.', haircut_pct: 10, eligible_collateral_value: 450 },
      { ref: 'BRC-LC-2024-50128', status: 'Approved', submitted_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(), credit_rating: 93, action_date: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), action_by: 'Riya Mehta', officer_notes: 'Strong credit. Tata Steel Premier. Approved.', applicant_name: 'Tata Steel Ltd.', applicant_city: 'Mumbai', applicant_country: 'India', applicant_account: '55007654321098', applicant_email: 'finance@tatasteel.com', applicant_phone: '+91 22 6665 8282', client_status: 'existing', beneficiary_name: 'Nippon Steel Corporation', beneficiary_country: 'Japan', beneficiary_bank: 'Mizuho Bank Ltd, Tokyo', beneficiary_swift: 'MHCBJPJT', lc_type: 'Revolving', lc_currency: 'JPY', lc_amount: 180000000, lc_expiry_date: '2025-12-31', lc_expiry_place: 'Tokyo, Japan', partial_shipments: 'Yes', transhipment: 'No', tolerance_pct: 5, port_loading: 'Port of Tokyo, Japan', port_discharge: 'Nhava Sheva, Mumbai', latest_ship_date: '2025-11-30', incoterms: 'FOB', goods_desc: 'Hot-rolled steel coils and plates (Grade SS400)', quantity: '5,000 MT', unit_price: 'JPY 36,000 per MT', hs_code: '7208.37', country_origin: 'Japan', documents: JSON.stringify(['Commercial Invoice', 'Bill of Lading', 'Packing List', 'Certificate of Origin', 'Insurance Certificate']), additional_docs: 'Mill test certificate per coil', issuing_bank: 'Barclays Bank PLC, India', advising_bank: 'Mizuho Bank Tokyo', negotiating_bank: 'SBI, Mumbai', payment_terms: 'At Sight', special_instructions: 'Revolving LC reinstated monthly.', annual_turnover: 220000, years_in_business: 55, credit_score: 850, existing_bank_limit: 1500, collateral: JSON.stringify(['Fixed Deposit', 'Stocks/Shares']), collateral_value: 350, payment_agreement: '2025-12-15', collateral_primary_type: 'FD', fd_number: 'FD/SBI/2024/TTS-001', fd_bank: 'State Bank of India', fd_amount: 350, fd_currency: 'INR', fd_maturity_date: '2026-06-30', fd_lien_marked: 'Yes', kyc_status: 'Cleared', sanctions_applicant: 'Cleared', sanctions_beneficiary: 'Cleared', sanctions_country_risk: 'Cleared', aml_status: 'Cleared', stp_decision: 'YES', haircut_pct: 0, eligible_collateral_value: 350 },
      { ref: 'BRC-LC-2024-43900', status: 'More Info Required', submitted_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), credit_rating: 31, action_date: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), action_by: 'Riya Mehta', officer_notes: 'New client, low credit. Require 3yr financials.', applicant_name: 'Sunrise Textiles Pvt. Ltd.', applicant_city: 'Surat', applicant_country: 'India', applicant_account: '55002345678901', applicant_email: 'accounts@sunrisetextiles.com', applicant_phone: '+91 94270 55100', client_status: 'new', beneficiary_name: 'Freudenberg Group', beneficiary_country: 'Germany', beneficiary_bank: 'Commerzbank AG', beneficiary_swift: 'COBADEFFXXX', beneficiary_iban: 'DE83 2004 0060 0121 9943 00', lc_type: 'Sight', lc_currency: 'EUR', lc_amount: 425000, lc_expiry_date: '2025-04-30', lc_expiry_place: 'Hamburg, Germany', partial_shipments: 'No', transhipment: 'No', tolerance_pct: 5, port_loading: 'Hamburg Port', port_discharge: 'Mundra Port, Gujarat', latest_ship_date: '2025-03-31', incoterms: 'CIF', goods_desc: 'Non-woven technical fabric rolls for automotive interiors', quantity: '120 MT', unit_price: 'EUR 3,541 per MT', hs_code: '5603.12', country_origin: 'Germany', documents: JSON.stringify(['Commercial Invoice', 'Bill of Lading', 'Packing List', 'Certificate of Origin']), issuing_bank: 'Barclays Bank PLC, India', advising_bank: 'Commerzbank AG', payment_terms: 'At Sight', annual_turnover: 42, years_in_business: 4, credit_score: 640, existing_bank_limit: 10, collateral: JSON.stringify(['None']), collateral_value: 0, payment_agreement: '2025-05-10', collateral_primary_type: 'NONE', kyc_status: 'Pending', sanctions_applicant: 'Cleared', sanctions_beneficiary: 'Cleared', sanctions_country_risk: 'Cleared', aml_status: 'Pending', stp_decision: 'NO', stp_reason: 'Insufficient collateral. Eligible 0.00 < LC Amount 425000.', haircut_pct: 0, eligible_collateral_value: 0 },
      { ref: 'BRC-LC-2024-39015', status: 'Rejected', submitted_at: new Date(Date.now() - 96 * 3600 * 1000).toISOString(), credit_rating: 18, action_date: new Date(Date.now() - 72 * 3600 * 1000).toISOString(), action_by: 'Riya Mehta', officer_notes: 'Rejected: Insufficient credit, no collateral, CIBIL below 600.', applicant_name: 'Novus Pharma Exports', applicant_city: 'Hyderabad', applicant_country: 'India', applicant_account: '55008765432109', applicant_email: 'trade@novuspharma.co.in', applicant_phone: '+91 40 2342 0987', client_status: 'new', beneficiary_name: 'Pfizer Inc.', beneficiary_country: 'USA', beneficiary_bank: 'JPMorgan Chase, New York', beneficiary_swift: 'CHASUS33', lc_type: 'Standby', lc_currency: 'USD', lc_amount: 900000, lc_expiry_date: '2025-03-15', lc_expiry_place: 'New York, USA', partial_shipments: 'No', transhipment: 'Yes', tolerance_pct: 0, port_loading: 'New York', port_discharge: 'Hyderabad', latest_ship_date: '2025-02-28', incoterms: 'DDP', goods_desc: 'Active Pharmaceutical Ingredients (APIs)', quantity: '500 KG', unit_price: 'USD 1,800 per KG', hs_code: '2941.10', country_origin: 'USA', documents: JSON.stringify(['Commercial Invoice', 'Packing List']), issuing_bank: 'Barclays Bank PLC, India', advising_bank: 'JPMorgan Chase', payment_terms: 'At Sight', special_instructions: 'Urgent within 24 hours.', annual_turnover: 18, years_in_business: 2, credit_score: 558, existing_bank_limit: 0, collateral: JSON.stringify(['None']), collateral_value: 0, collateral_primary_type: 'NONE', kyc_status: 'Pending', sanctions_applicant: 'Cleared', sanctions_beneficiary: 'Cleared', sanctions_country_risk: 'Pending', aml_status: 'Failed', stp_decision: 'NO', stp_reason: 'Insufficient collateral and AML flag raised.', haircut_pct: 0, eligible_collateral_value: 0 },
    ];

    const COLS = ['ref', 'status', 'submitted_at', 'credit_rating', 'action_date', 'action_by', 'officer_notes',
      'applicant_name', 'applicant_city', 'applicant_country', 'applicant_account', 'applicant_email', 'applicant_phone', 'client_status',
      'beneficiary_name', 'beneficiary_country', 'beneficiary_bank', 'beneficiary_swift', 'beneficiary_iban',
      'lc_type', 'lc_currency', 'lc_amount', 'lc_expiry_date', 'lc_expiry_place', 'partial_shipments', 'transhipment', 'tolerance_pct',
      'port_loading', 'port_discharge', 'latest_ship_date', 'incoterms', 'goods_desc', 'quantity', 'unit_price', 'hs_code', 'country_origin',
      'documents', 'additional_docs', 'issuing_bank', 'advising_bank', 'confirming_bank', 'negotiating_bank',
      'payment_terms', 'special_instructions', 'annual_turnover', 'years_in_business', 'credit_score', 'existing_bank_limit',
      'collateral', 'collateral_value', 'payment_agreement', 'collateral_primary_type',
      'fd_number', 'fd_bank', 'fd_amount', 'fd_currency', 'fd_maturity_date', 'fd_lien_marked',
      'sec_isin', 'sec_issuer', 'sec_market_value', 'sec_quantity', 'sec_custodian', 'sec_volatility', 'sec_pledged',
      'kyc_status', 'sanctions_applicant', 'sanctions_beneficiary', 'sanctions_country_risk', 'aml_status',
      'stp_decision', 'stp_reason', 'haircut_pct', 'eligible_collateral_value'];

    for (const d of DEMO) {
      const vals = COLS.map(c => d[c] ?? null);
      await run(
        `INSERT OR IGNORE INTO lc_applications (${COLS.join(',')}) VALUES (${COLS.map(() => '?').join(',')})`,
        vals
      );
    }
    res.json({ success: true, message: `Seeded ${DEMO.length} demo applications.` });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: e.message }); }
});

async function checkAndSeed() {
  const row = await get('SELECT COUNT(*) as n FROM lc_applications');
  if (row.n === 0) {
    console.log('  📦  Empty DB — auto-seeding…');
    const http = require('http');
    setTimeout(() => {
      const r = http.request({ hostname: 'localhost', port: PORT, path: '/api/seed', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 0 } }, res => {
        let b = ''; res.on('data', c => b += c); res.on('end', () => { try { const j = JSON.parse(b); console.log('  ✅ ', j.message); } catch { } });
      });
      r.on('error', () => { }); r.end();
    }, 700);
  } else {
    console.log(`  ✅  DB: ${row.n} application(s) ready.`);
  }
}

// ════════════════════════════════════════════════════════
// PRE-DRAFT LC GENERATION MODULE — ROUTES
// ════════════════════════════════════════════════════════

// POST /api/lc-predraft/:ref — Generate & store full pre-draft LC + PDF
app.post('/api/lc-predraft/:ref', async (req, res) => {
  try {
    const row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row) return res.status(404).json({ success: false, status: 'ERROR', error: 'Application not found.' });

    // Map DB row keys → camelCase for the generator
    const data = {
      ref: row.ref,
      applicantName: row.applicant_name,
      applicantAddress: row.applicant_address,
      applicantCity: row.applicant_city,
      applicantCountry: row.applicant_country,
      applicantAccount: row.applicant_account,
      applicantGST: row.applicant_gst,
      beneficiaryName: row.beneficiary_name,
      beneficiaryAddress: row.beneficiary_address,
      beneficiaryCity: row.beneficiary_city,
      beneficiaryCountry: row.beneficiary_country,
      beneficiaryBankName: row.beneficiary_bank,
      beneficiarySwift: row.beneficiary_swift,
      beneficiaryIBAN: row.beneficiary_iban,
      lcType: row.lc_type,
      lcCurrency: row.lc_currency,
      lcAmount: row.lc_amount,
      lcExpiryDate: row.lc_expiry_date,
      lcExpiryPlace: row.lc_expiry_place,
      partialShipments: row.partial_shipments,
      transhipment: row.transhipment,
      tolerancePct: row.tolerance_pct,
      portLoading: row.port_loading,
      portDischarge: row.port_discharge,
      latestShipDate: row.latest_ship_date,
      incoterms: row.incoterms,
      goodsDesc: row.goods_desc,
      quantity: row.quantity,
      unitPrice: row.unit_price,
      hsCode: row.hs_code,
      countryOrigin: row.country_origin,
      documents: safeJSON(row.documents, []),
      additionalDocs: row.additional_docs,
      issuingBank: row.issuing_bank,
      advisingBank: row.advising_bank,
      confirmingBank: row.confirming_bank,
      negotiatingBank: row.negotiating_bank,
      paymentTerms: row.payment_terms,
      specialInstructions: row.special_instructions,
    };

    // Run the generator
    const draftResult = generateLCDraft(data);

    // If validation failed → return structured error (no PDF)
    if (draftResult.status === 'ERROR') {
      return res.status(422).json({
        success: false,
        status: 'ERROR',
        message: draftResult.message,
        missing_fields: draftResult.missing_fields,
        warnings: draftResult.warnings,
        validationSummary: draftResult.validationSummary,
      });
    }

    // Generate PDF
    const pdfResult = await generateLCPDF(draftResult, PREDRAFTS_DIR);

    // Persist to DB
    const now = new Date().toISOString();
    await run(
      `UPDATE lc_applications SET predraft_lc_number=?, predraft_text=?, predraft_pdf_path=?, predraft_generated_at=? WHERE ref=?`,
      [draftResult.lcNumber, draftResult.draftText, pdfResult.filePath, now, row.ref]
    );
    await run(
      `INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [row.ref, 'Pre-Draft LC Generated', 'PREDRAFT_LC', `LC# ${draftResult.lcNumber} | PDF: ${pdfResult.fileName}`, req.body.officer || 'System', now]
    );

    res.json({
      success: true,
      status: 'SUCCESS',
      lc_number: draftResult.lcNumber,
      issue_date: draftResult.issueDate,
      validation_summary: draftResult.validationSummary,
      warnings: draftResult.validationSummary.warnings,
      structured_lc: draftResult.structuredLC,
      clauses: draftResult.clauses,
      fee_schedule: draftResult.feeSchedule,
      draft_text: draftResult.draftText,
      pdf_path: pdfResult.filePath,
      pdf_filename: pdfResult.fileName,
      pdf_base64: pdfResult.base64,
      pdf_size_bytes: pdfResult.sizeBytes,
    });
  } catch (e) {
    console.error('[lc-predraft POST]', e);
    res.status(500).json({ success: false, status: 'ERROR', error: e.message });
  }
});

// GET /api/lc-predraft/:ref — Retrieve stored pre-draft
app.get('/api/lc-predraft/:ref', async (req, res) => {
  try {
    const row = await get('SELECT predraft_lc_number, predraft_text, predraft_pdf_path, predraft_generated_at FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row) return res.status(404).json({ success: false, error: 'Application not found.' });
    if (!row.predraft_text) {
      return res.json({ success: true, status: 'NOT_GENERATED', message: 'Pre-draft LC has not yet been generated for this application.' });
    }
    res.json({
      success: true,
      status: 'SUCCESS',
      lc_number: row.predraft_lc_number,
      generated_at: row.predraft_generated_at,
      draft_text: row.predraft_text,
      pdf_path: row.predraft_pdf_path,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/lc-pdf/:ref — Stream PDF file for download
app.get('/api/lc-pdf/:ref', async (req, res) => {
  try {
    const row = await get('SELECT predraft_pdf_path, predraft_lc_number FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row || !row.predraft_pdf_path) {
      return res.status(404).json({ success: false, error: 'PDF not yet generated. POST to /api/lc-predraft/:ref first.' });
    }
    if (!fs.existsSync(row.predraft_pdf_path)) {
      return res.status(404).json({ success: false, error: 'PDF file not found on disk. Regenerate the pre-draft.' });
    }
    const fileName = path.basename(row.predraft_pdf_path);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    fs.createReadStream(row.predraft_pdf_path).pipe(res);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════
// BAND 3 — DOCUMENT EXAMINATION & DISCREPANCY ENGINE
// ════════════════════════════════════════════════════════

// POST /api/documents/:ref — Submit presented documents
app.post('/api/documents/:ref', async (req, res) => {
  const d = req.body; const now = new Date().toISOString();
  try {
    const lcRow = await get('SELECT ref FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!lcRow) return res.status(404).json({ success: false, error: 'Application not found.' });

    await run(`INSERT INTO document_presentations (
      ref, submitted_at, submitted_by,
      commercial_invoice, bill_of_lading, packing_list,
      certificate_of_origin, insurance_cert, inspection_cert,
      weight_cert, additional_docs,
      invoice_amount, invoice_currency, invoice_date,
      bl_number, bl_date, vessel_name,
      shipment_date, shipment_port, discharge_port, status
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [
      req.params.ref, now, d.submittedBy || 'Beneficiary',
      d.commercialInvoice || '', d.billOfLading || '', d.packingList || '',
      d.certificateOfOrigin || '', d.insuranceCert || '', d.inspectionCert || '',
      d.weightCert || '', d.additionalDocs || '',
      parseFloat(d.invoiceAmount) || 0, d.invoiceCurrency || '', d.invoiceDate || '',
      d.blNumber || '', d.blDate || '', d.vesselName || '',
      d.shipmentDate || '', d.shipmentPort || '', d.dischargePort || '', 'Submitted'
    ]);

    await run(`UPDATE lc_applications SET doc_presentation_status = 'Submitted' WHERE ref = ?`, [req.params.ref]);
    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, 'Documents Submitted', 'DOCUMENT_SUBMISSION', 'Beneficiary submitted shipping documents for examination.', d.submittedBy || 'Beneficiary', now]);

    // Auto-create notification
    await run(`INSERT INTO notifications (ref, type, recipient, channel, subject, body, sent_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, 'DOC_SUBMITTED', 'Officer', 'SYSTEM', 'Documents Submitted for ' + req.params.ref,
        'Shipping documents have been submitted for examination. Please review.', now]);

    res.status(201).json({ success: true, message: 'Documents submitted for examination.' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/documents/:ref — Get document presentations
app.get('/api/documents/:ref', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM document_presentations WHERE ref = ? ORDER BY submitted_at DESC', [req.params.ref]);
    res.json({ success: true, presentations: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Discrepancy Review Engine ──
function runDiscrepancyCheck(lcApp, docPresentation) {
  const discrepancies = [];
  const addDisc = (field, lcVal, docVal, severity, rule, desc) => {
    discrepancies.push({ field_name: field, lc_value: lcVal, doc_value: docVal, severity, rule_matched: rule, description: desc });
  };

  // 1. Amount check with tolerance
  const lcAmt = parseFloat(lcApp.lc_amount) || 0;
  const invoiceAmt = parseFloat(docPresentation.invoice_amount) || 0;
  const tolerance = parseFloat(lcApp.tolerance_pct) || 5;
  const maxAmt = lcAmt * (1 + tolerance / 100);
  const minAmt = lcAmt * (1 - tolerance / 100);
  if (invoiceAmt > maxAmt) {
    addDisc('Invoice Amount', `${lcApp.lc_currency} ${lcAmt}`, `${docPresentation.invoice_currency} ${invoiceAmt}`,
      'MAJOR', 'AMOUNT_EXCEEDS_TOLERANCE', `Invoice amount exceeds LC amount + ${tolerance}% tolerance. Max allowed: ${maxAmt.toFixed(2)}`);
  } else if (invoiceAmt < minAmt * 0.5) {
    addDisc('Invoice Amount', `${lcApp.lc_currency} ${lcAmt}`, `${docPresentation.invoice_currency} ${invoiceAmt}`,
      'MINOR', 'AMOUNT_SIGNIFICANTLY_BELOW', `Invoice amount is significantly below LC amount.`);
  }

  // 2. Currency mismatch
  const lcCur = (lcApp.lc_currency || '').toUpperCase();
  const docCur = (docPresentation.invoice_currency || '').toUpperCase();
  if (docCur && lcCur && docCur !== lcCur) {
    addDisc('Currency', lcCur, docCur, 'FATAL', 'CURRENCY_MISMATCH', 'Document currency does not match LC currency.');
  }

  // 3. Late shipment
  if (lcApp.latest_ship_date && docPresentation.shipment_date) {
    const lcShipDate = new Date(lcApp.latest_ship_date);
    const docShipDate = new Date(docPresentation.shipment_date);
    if (docShipDate > lcShipDate) {
      addDisc('Shipment Date', lcApp.latest_ship_date, docPresentation.shipment_date,
        'MAJOR', 'LATE_SHIPMENT', 'Shipment date exceeds the latest allowed shipment date in the LC.');
    }
  }

  // 4. Port of Loading mismatch
  const lcPort = (lcApp.port_loading || '').toLowerCase().trim();
  const docPort = (docPresentation.shipment_port || '').toLowerCase().trim();
  if (lcPort && docPort && !docPort.includes(lcPort) && !lcPort.includes(docPort)) {
    addDisc('Port of Loading', lcApp.port_loading, docPresentation.shipment_port,
      'MAJOR', 'PORT_MISMATCH', 'Shipment port on B/L does not match LC port of loading.');
  }

  // 5. Port of Discharge mismatch
  const lcDischarge = (lcApp.port_discharge || '').toLowerCase().trim();
  const docDischarge = (docPresentation.discharge_port || '').toLowerCase().trim();
  if (lcDischarge && docDischarge && !docDischarge.includes(lcDischarge) && !lcDischarge.includes(docDischarge)) {
    addDisc('Port of Discharge', lcApp.port_discharge, docPresentation.discharge_port,
      'MAJOR', 'DISCHARGE_PORT_MISMATCH', 'Discharge port on B/L does not match LC.');
  }

  // 6. Missing required documents
  const requiredDocs = safeJSON(lcApp.documents, []);
  const presentedFlags = {
    'Commercial Invoice': docPresentation.commercial_invoice,
    'Bill of Lading': docPresentation.bill_of_lading,
    'Packing List': docPresentation.packing_list,
    'Certificate of Origin': docPresentation.certificate_of_origin,
    'Insurance Certificate': docPresentation.insurance_cert,
    'Inspection Certificate': docPresentation.inspection_cert,
    'Weight/Measurement Certificate': docPresentation.weight_cert,
  };
  for (const doc of requiredDocs) {
    const key = Object.keys(presentedFlags).find(k => doc.toLowerCase().includes(k.toLowerCase().split('/')[0].trim()));
    if (key && (!presentedFlags[key] || presentedFlags[key] === 'No' || presentedFlags[key] === '')) {
      addDisc('Document: ' + doc, 'Required', 'Not Presented',
        'MAJOR', 'MISSING_DOCUMENT', `Required document "${doc}" was not presented.`);
    }
  }

  // 7. Late presentation (21 days after shipment, UCP 600)
  if (docPresentation.shipment_date && docPresentation.submitted_at) {
    const shipDate = new Date(docPresentation.shipment_date);
    const submitDate = new Date(docPresentation.submitted_at);
    const daysDiff = (submitDate - shipDate) / (1000 * 60 * 60 * 24);
    if (daysDiff > 21) {
      addDisc('Presentation Period', '21 days max', `${Math.round(daysDiff)} days`,
        'FATAL', 'LATE_PRESENTATION', 'Documents presented more than 21 days after shipment date (UCP 600 violation).');
    }
  }

  // Summary
  const fatalCount = discrepancies.filter(d => d.severity === 'FATAL').length;
  const majorCount = discrepancies.filter(d => d.severity === 'MAJOR').length;
  const minorCount = discrepancies.filter(d => d.severity === 'MINOR').length;
  const overall = fatalCount > 0 ? 'DISCREPANT' : majorCount > 0 ? 'DISCREPANT' : minorCount > 0 ? 'MINOR_DISCREPANCIES' : 'COMPLIANT';

  return { discrepancies, summary: { overall, fatal: fatalCount, major: majorCount, minor: minorCount, total: discrepancies.length } };
}

// POST /api/examine/:ref — Run discrepancy examination
app.post('/api/examine/:ref', async (req, res) => {
  const officer = req.body.officer || 'Examiner';
  const now = new Date().toISOString();
  try {
    const lcRow = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!lcRow) return res.status(404).json({ success: false, error: 'Application not found.' });

    const presentation = await get('SELECT * FROM document_presentations WHERE ref = ? ORDER BY submitted_at DESC LIMIT 1', [req.params.ref]);
    if (!presentation) return res.status(404).json({ success: false, error: 'No documents submitted yet.' });

    // Run the engine
    const result = runDiscrepancyCheck(lcRow, presentation);

    // Clear old discrepancies for this ref
    await run('DELETE FROM discrepancies WHERE ref = ?', [req.params.ref]);

    // Insert new discrepancies
    for (const d of result.discrepancies) {
      await run(`INSERT INTO discrepancies (ref, presentation_id, field_name, lc_value, doc_value, severity, rule_matched, description, status)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [req.params.ref, presentation.id, d.field_name, d.lc_value, d.doc_value, d.severity, d.rule_matched, d.description, 'Open']);
    }

    // Update presentation status
    const examStatus = result.summary.overall === 'COMPLIANT' ? 'Compliant' : 'Discrepant';
    await run(`UPDATE document_presentations SET status = ?, examiner = ?, examined_at = ?, examination_notes = ? WHERE id = ?`,
      [examStatus, officer, now, `${result.summary.total} discrepancies found (${result.summary.fatal} fatal, ${result.summary.major} major, ${result.summary.minor} minor)`, presentation.id]);

    // Update lc_application
    await run(`UPDATE lc_applications SET doc_presentation_status = ? WHERE ref = ?`, [examStatus, req.params.ref]);

    // Audit
    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, metadata, action_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, `Document Examination: ${examStatus}`, 'DOCUMENT_EXAM',
        `${result.summary.total} discrepancies found.`, officer, JSON.stringify(result.summary), now]);

    res.json({ success: true, result: examStatus, ...result });
  } catch (e) { console.error(e); res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/discrepancies/:ref — Get discrepancy report
app.get('/api/discrepancies/:ref', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM discrepancies WHERE ref = ? ORDER BY severity DESC, id ASC', [req.params.ref]);
    const presentation = await get('SELECT * FROM document_presentations WHERE ref = ? ORDER BY submitted_at DESC LIMIT 1', [req.params.ref]);
    res.json({ success: true, discrepancies: rows, presentation: presentation || null });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/discrepancy-notice/:ref — Generate discrepancy notice
app.post('/api/discrepancy-notice/:ref', async (req, res) => {
  const officer = req.body.officer || 'Compliance Officer';
  const now = new Date().toISOString();
  try {
    const lcRow = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!lcRow) return res.status(404).json({ success: false, error: 'Application not found.' });

    const discs = await all('SELECT * FROM discrepancies WHERE ref = ? AND status = "Open"', [req.params.ref]);
    if (!discs.length) return res.json({ success: true, message: 'No open discrepancies to notify.' });

    // Build MT734-style notice
    const discList = discs.map((d, i) => `  ${i + 1}. ${d.field_name}: LC states "${d.lc_value}" but document shows "${d.doc_value}" [${d.severity}] — ${d.description}`).join('\n');
    const notice = `***** SWIFT MT734 — ADVICE OF REFUSAL *****
Generated by: Barclays LC System | ${new Date().toLocaleString('en-IN')}
======================================================================

:20: DOCUMENTARY CREDIT NUMBER
  ${lcRow.ref}

:21: PRESENTING BANK'S REFERENCE
  ${lcRow.beneficiary_bank || 'ADVISING BANK'}

:32A: DATE AND AMOUNT
  ${now.slice(0, 10).replace(/-/g, '')} ${lcRow.lc_currency || 'USD'}${parseFloat(lcRow.lc_amount || 0).toFixed(2)}

:77J: DISCREPANCIES

${discList}

:77B: DISPOSITION OF DOCUMENTS
  DOCUMENTS HELD AT OUR DISPOSAL PENDING FURTHER INSTRUCTIONS.

:72: SENDER TO RECEIVER INFORMATION
  PLEASE ADVISE WHETHER APPLICANT ACCEPTS DISCREPANCIES.
  OR AMEND THE LC ACCORDINGLY.

======================================================================
***** END OF MT734 MESSAGE *****`;

    // Save notification
    await run(`INSERT INTO notifications (ref, type, recipient, channel, subject, body, sent_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, 'DISCREPANCY_NOTICE', lcRow.beneficiary_name || 'Beneficiary', 'SWIFT_MT734',
        `Discrepancy Notice for LC ${req.params.ref}`, notice, now]);

    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, 'Discrepancy Notice Sent (MT734)', 'DISCREPANCY_NOTICE', `Sent to ${lcRow.beneficiary_name || 'Beneficiary'}`, officer, now]);

    res.json({ success: true, notice, discrepancyCount: discs.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════
// BAND 3 — LC AMENDMENTS
// ════════════════════════════════════════════════════════

// POST /api/amendments/:ref — Submit amendment request
app.post('/api/amendments/:ref', async (req, res) => {
  const d = req.body; const now = new Date().toISOString();
  try {
    const lcRow = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!lcRow) return res.status(404).json({ success: false, error: 'Application not found.' });

    // Get next amendment number
    const latest = await get('SELECT MAX(amendment_number) as n FROM amendments WHERE ref = ?', [req.params.ref]);
    const amendNum = (latest?.n || 0) + 1;

    // Calculate fee impact (flat amendment fee)
    const feeImpact = 2500; // INR flat per amendment

    await run(`INSERT INTO amendments (ref, amendment_number, requested_at, requested_by, field_changed, old_value, new_value, reason, status, fee_impact)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [req.params.ref, amendNum, now, d.requestedBy || 'Client', d.fieldChanged || '', d.oldValue || '', d.newValue || '', d.reason || '', 'Pending', feeImpact]);

    await run(`INSERT INTO notifications (ref, type, recipient, channel, subject, body, sent_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, 'AMENDMENT_REQUEST', 'Officer', 'SYSTEM',
        `Amendment #${amendNum} requested for ${req.params.ref}`,
        `Field: ${d.fieldChanged}. Change: "${d.oldValue}" → "${d.newValue}". Reason: ${d.reason}`, now]);

    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, `Amendment #${amendNum} Requested`, 'AMENDMENT', `${d.fieldChanged}: "${d.oldValue}" → "${d.newValue}"`, d.requestedBy || 'Client', now]);

    res.status(201).json({ success: true, amendmentNumber: amendNum, feeImpact });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/amendments/:ref — Get amendment history
app.get('/api/amendments/:ref', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM amendments WHERE ref = ? ORDER BY amendment_number ASC', [req.params.ref]);
    res.json({ success: true, amendments: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/amendments/:ref/approve — Approve amendment
app.post('/api/amendments/:ref/approve', async (req, res) => {
  const d = req.body; const now = new Date().toISOString();
  const officer = d.officer || 'Officer';
  try {
    const amendment = await get('SELECT * FROM amendments WHERE ref = ? AND status = "Pending" ORDER BY amendment_number DESC LIMIT 1', [req.params.ref]);
    if (!amendment) return res.status(404).json({ success: false, error: 'No pending amendment found.' });

    // Apply the field change to lc_applications
    const fieldMap = {
      'LC Amount': 'lc_amount', 'Expiry Date': 'lc_expiry_date', 'Latest Shipment Date': 'latest_ship_date',
      'Goods Description': 'goods_desc', 'Port of Loading': 'port_loading', 'Port of Discharge': 'port_discharge',
      'Payment Terms': 'payment_terms', 'Tolerance %': 'tolerance_pct', 'Special Instructions': 'special_instructions',
      'Advising Bank': 'advising_bank', 'Beneficiary Name': 'beneficiary_name',
    };
    const dbField = fieldMap[amendment.field_changed];
    if (dbField) {
      await run(`UPDATE lc_applications SET ${dbField} = ? WHERE ref = ?`, [amendment.new_value, req.params.ref]);
    }
    await run(`UPDATE lc_applications SET amendment_count = COALESCE(amendment_count, 0) + 1 WHERE ref = ?`, [req.params.ref]);

    // Generate MT707 draft
    const mt707 = `***** SWIFT MT707 — AMENDMENT TO DOCUMENTARY CREDIT *****
Generated by: Barclays LC System | ${new Date().toLocaleString('en-IN')}
======================================================================

:20: DOCUMENTARY CREDIT NUMBER
  ${req.params.ref}

:21: RELATED REFERENCE
  ${req.params.ref}

:26E: NUMBER OF AMENDMENT
  ${amendment.amendment_number}

:30: DATE OF AMENDMENT
  ${now.slice(0, 10).replace(/-/g, '')}

:79: NARRATIVE — AMENDMENT DETAILS
  FIELD AMENDED: ${amendment.field_changed}
  PREVIOUS VALUE: ${amendment.old_value}
  AMENDED VALUE: ${amendment.new_value}
  REASON: ${amendment.reason || 'As requested'}

  ALL OTHER TERMS AND CONDITIONS REMAIN UNCHANGED.
  THIS AMENDMENT FORMS AN INTEGRAL PART OF THE CREDIT.
  PLEASE ADVISE BENEFICIARY ACCORDINGLY.

======================================================================
***** END OF MT707 MESSAGE *****`;

    await run(`UPDATE amendments SET status = 'Approved', approved_by = ?, approved_at = ?, mt707_draft = ? WHERE id = ?`,
      [officer, now, mt707, amendment.id]);

    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, `Amendment #${amendment.amendment_number} Approved`, 'AMENDMENT_APPROVE', `${amendment.field_changed} changed. MT707 generated.`, officer, now]);

    res.json({ success: true, mt707Draft: mt707, amendmentNumber: amendment.amendment_number });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════
// BAND 3 — PAYMENT RECONCILIATION & SETTLEMENT
// ════════════════════════════════════════════════════════

// POST /api/payment/:ref — Initiate payment
app.post('/api/payment/:ref', async (req, res) => {
  const d = req.body; const now = new Date().toISOString();
  const officer = d.officer || 'Treasury Officer';
  try {
    const lcRow = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!lcRow) return res.status(404).json({ success: false, error: 'Application not found.' });

    const amt = parseFloat(d.amount) || parseFloat(lcRow.lc_amount) || 0;
    const cur = d.currency || lcRow.lc_currency || 'USD';
    const settlementRef = `STL-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;

    await run(`INSERT INTO payments (ref, payment_type, amount, currency, initiated_at, authorized_by, status, debit_account, credit_account, settlement_ref, payment_method)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.ref, d.paymentType || 'LC_PAYMENT', amt, cur, now, officer, 'Authorized',
        d.debitAccount || lcRow.applicant_account || 'BARCLAYS-NOSTRO', d.creditAccount || 'ADVISING-BANK-ACCOUNT', settlementRef, 'SWIFT']);

    // Block funds
    await run(`UPDATE lc_applications SET payment_status = 'Authorized', fund_blocked_amount = ?, fund_block_ref = ? WHERE ref = ?`,
      [amt, settlementRef, req.params.ref]);

    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, `Payment Authorized: ${cur} ${amt.toLocaleString()}`, 'PAYMENT_AUTH', `Settlement Ref: ${settlementRef}`, officer, now]);

    await run(`INSERT INTO notifications (ref, type, recipient, channel, subject, body, sent_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, 'PAYMENT_AUTHORIZED', 'Client', 'SYSTEM',
        `Payment authorized for ${req.params.ref}`, `Amount: ${cur} ${amt.toLocaleString()}. Settlement Ref: ${settlementRef}`, now]);

    res.json({ success: true, settlementRef, amount: amt, currency: cur, status: 'Authorized' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/payment/:ref/settle — Complete settlement
app.post('/api/payment/:ref/settle', async (req, res) => {
  const officer = req.body.officer || 'Treasury Officer';
  const now = new Date().toISOString();
  try {
    const payment = await get('SELECT * FROM payments WHERE ref = ? AND status = "Authorized" ORDER BY initiated_at DESC LIMIT 1', [req.params.ref]);
    if (!payment) return res.status(404).json({ success: false, error: 'No authorized payment found.' });

    await run(`UPDATE payments SET status = 'Settled', completed_at = ? WHERE id = ?`, [now, payment.id]);
    await run(`UPDATE lc_applications SET payment_status = 'Settled' WHERE ref = ?`, [req.params.ref]);

    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, `Payment Settled: ${payment.currency} ${payment.amount}`, 'PAYMENT_SETTLE', `Ref: ${payment.settlement_ref}`, officer, now]);

    await run(`INSERT INTO notifications (ref, type, recipient, channel, subject, body, sent_at) VALUES (?,?,?,?,?,?,?)`,
      [req.params.ref, 'PAYMENT_SETTLED', 'Client', 'SYSTEM',
        `Payment settled for ${req.params.ref}`, `${payment.currency} ${payment.amount} has been settled. Ref: ${payment.settlement_ref}`, now]);

    res.json({ success: true, settlementRef: payment.settlement_ref, status: 'Settled', completedAt: now });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/ledger/:ref — Payment ledger
app.get('/api/ledger/:ref', async (req, res) => {
  try {
    const payments = await all('SELECT * FROM payments WHERE ref = ? ORDER BY initiated_at DESC', [req.params.ref]);
    res.json({ success: true, ledger: payments });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/close/:ref — Close LC
app.post('/api/close/:ref', async (req, res) => {
  const officer = req.body.officer || 'Officer';
  const now = new Date().toISOString();
  try {
    await run(`UPDATE lc_applications SET status = 'Closed', payment_status = 'Closed', lc_closed_at = ? WHERE ref = ?`, [now, req.params.ref]);
    await run(`INSERT INTO officer_actions (ref, action, action_type, notes, officer, action_at) VALUES (?,?,?,?,?,?)`,
      [req.params.ref, 'LC Closed', 'LC_CLOSE', 'Letter of Credit lifecycle completed and closed.', officer, now]);
    res.json({ success: true, message: 'LC closed successfully.', closedAt: now });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════
// BAND 4 — NOTIFICATIONS, PREDICTIONS & REPORTING
// ════════════════════════════════════════════════════════

// GET /api/notifications/:ref
app.get('/api/notifications/:ref', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM notifications WHERE ref = ? ORDER BY sent_at DESC', [req.params.ref]);
    res.json({ success: true, notifications: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/notifications — All notifications (latest 50)
app.get('/api/notifications', async (req, res) => {
  try {
    const rows = await all('SELECT * FROM notifications ORDER BY sent_at DESC LIMIT 50');
    res.json({ success: true, notifications: rows });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/predictions/:ref — Fund blocking prediction
app.get('/api/predictions/:ref', async (req, res) => {
  try {
    const app_row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!app_row) return res.status(404).json({ success: false, error: 'Not found.' });

    const lcAmt = parseFloat(app_row.lc_amount) || 0;
    const creditScore = parseInt(app_row.credit_score) || 600;
    const yearsInBiz = parseInt(app_row.years_in_business) || 0;
    const turnover = parseFloat(app_row.annual_turnover) || 0;

    // Probability model (simplified heuristic)
    let probability = 50;
    if (creditScore >= 750) probability += 20;
    else if (creditScore >= 650) probability += 10;
    else probability -= 15;
    if (yearsInBiz >= 10) probability += 15;
    else if (yearsInBiz >= 5) probability += 8;
    if (turnover >= 100) probability += 10;
    else if (turnover >= 50) probability += 5;
    if (app_row.stp_decision === 'YES') probability += 10;
    probability = Math.min(99, Math.max(5, probability));

    // Fund blocking recommendation
    const blockingFactor = probability / 100;
    const recommendedBlock = Math.round(lcAmt * blockingFactor);

    // Exposure forecast
    const existingExposure = parseFloat(app_row.existing_exposures) || 0;
    const projectedExposure = existingExposure + lcAmt;

    res.json({
      success: true,
      prediction: {
        probability: probability,
        probabilityLabel: probability >= 70 ? 'High' : probability >= 40 ? 'Medium' : 'Low',
        recommendedFundBlock: recommendedBlock,
        recommendedFundBlockFormatted: `${app_row.lc_currency || 'USD'} ${recommendedBlock.toLocaleString()}`,
        creditExposureForecast: projectedExposure,
        riskFactors: {
          creditScore: { value: creditScore, impact: creditScore >= 750 ? 'Positive' : creditScore >= 650 ? 'Neutral' : 'Negative' },
          yearsInBusiness: { value: yearsInBiz, impact: yearsInBiz >= 10 ? 'Positive' : yearsInBiz >= 5 ? 'Neutral' : 'Negative' },
          annualTurnover: { value: turnover, impact: turnover >= 100 ? 'Positive' : turnover >= 50 ? 'Neutral' : 'Negative' },
          stpDecision: { value: app_row.stp_decision, impact: app_row.stp_decision === 'YES' ? 'Positive' : 'Neutral' },
        },
      }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/reports/stp-rate — STP approval rate
app.get('/api/reports/stp-rate', async (req, res) => {
  try {
    const total = await get('SELECT COUNT(*) as n FROM lc_applications');
    const approved = await get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='YES'");
    const review = await get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='REVIEW'");
    const rejected = await get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='NO'");
    const pending = await get("SELECT COUNT(*) as n FROM lc_applications WHERE stp_decision='PENDING' OR stp_decision IS NULL");
    const rate = total.n > 0 ? ((approved.n / total.n) * 100).toFixed(1) : 0;
    res.json({
      success: true,
      report: { total: total.n, autoApproved: approved.n, manualReview: review.n, rejected: rejected.n, pending: pending.n, stpRate: parseFloat(rate) }
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/reports/tat — Turn-around time
app.get('/api/reports/tat', async (req, res) => {
  try {
    const apps = await all("SELECT submitted_at, action_date, status FROM lc_applications WHERE action_date IS NOT NULL");
    let totalHours = 0; let count = 0;
    for (const a of apps) {
      const sub = new Date(a.submitted_at);
      const act = new Date(a.action_date);
      const hours = (act - sub) / (1000 * 60 * 60);
      if (hours > 0) { totalHours += hours; count++; }
    }
    const avgTAT = count > 0 ? (totalHours / count).toFixed(1) : 0;
    const statuses = {};
    for (const a of apps) { statuses[a.status] = (statuses[a.status] || 0) + 1; }
    res.json({ success: true, report: { averageTATHours: parseFloat(avgTAT), processedCount: count, byStatus: statuses } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/reports/exposure — Credit exposure summary
app.get('/api/reports/exposure', async (req, res) => {
  try {
    const rows = await all("SELECT applicant_name, lc_currency, lc_amount, stp_decision, status, collateral_value FROM lc_applications");
    let totalExposure = 0; const byCurrency = {}; const byStatus = {};
    for (const r of rows) {
      const amt = parseFloat(r.lc_amount) || 0;
      totalExposure += amt;
      const cur = r.lc_currency || 'USD';
      byCurrency[cur] = (byCurrency[cur] || 0) + amt;
      byStatus[r.status] = (byStatus[r.status] || 0) + amt;
    }
    res.json({ success: true, report: { totalExposure, byCurrency, byStatus, applicationCount: rows.length } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/audit-log — Full audit trail (paginated)
app.get('/api/audit-log', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const rows = await all('SELECT * FROM officer_actions ORDER BY action_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    const total = await get('SELECT COUNT(*) as n FROM officer_actions');
    res.json({ success: true, auditLog: rows, total: total.n, limit, offset });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ════════════════════════════════════════════════════════
// SWIFT GENERATOR MODULE — ROUTES
// ════════════════════════════════════════════════════════

// POST /api/swift-draft/:ref — Generate SWIFT MT700/MT707 Draft via Python Module
app.post('/api/swift-draft/:ref', async (req, res) => {
  try {
    const row = await get('SELECT * FROM lc_applications WHERE ref = ?', [req.params.ref]);
    if (!row) return res.status(404).json({ success: false, status: 'ERROR', error: 'Application not found.' });

    // Ensure documents is an array
    let docs = safeJSON(row.documents, []);
    if (row.additional_docs) docs.push(row.additional_docs);

    // Map to the JSON structure expected by swift_mt700.py validator
    const lcData = {
      message_type: 'MT700', // For now we only generate MT700 from new apps
      lc_number: row.predraft_lc_number || (row.ref ? row.ref.replace('BRC-LC-', 'BRC/LC/') : 'BRC/LC/YYYY/001').slice(0, 16),
      issue_date: new Date().toISOString().slice(0, 10),
      expiry_date: row.lc_expiry_date || '',
      expiry_place: row.lc_expiry_place || '',

      applicant: {
        name: row.applicant_name,
        address: row.applicant_address,
        city: row.applicant_city,
        country: row.applicant_country,
        account: row.applicant_account
      },

      beneficiary: {
        name: row.beneficiary_name,
        address: row.beneficiary_address,
        city: row.beneficiary_city,
        country: row.beneficiary_country,
        account: row.beneficiary_iban,
        bank_bic: row.beneficiary_swift
      },

      amount: row.lc_amount,
      currency: row.lc_currency,
      tolerance_pct: row.tolerance_pct,

      payment_terms: row.payment_terms,
      confirmation: row.confirming_bank ? 'Confirm' : 'Without',

      advising_bank: {
        name: row.advising_bank || '',
        bic: ''
      },

      shipment_details: {
        port_of_loading: row.port_loading || '',
        port_of_discharge: row.port_discharge || '',
        latest_shipment_date: row.latest_ship_date || '',
        partial_shipments: row.partial_shipments === 'Yes' ? 'PERMITTED' : 'NOT ALLOWED',
        transhipment: row.transhipment === 'Yes' ? 'PERMITTED' : 'NOT ALLOWED',
        incoterms: row.incoterms || ''
      },

      goods_description: row.goods_desc || '',
      documents_required: docs,
      additional_conditions: row.special_instructions || '',
      charges: 'OUR' // default from spec
    };

    // Spawn Python Process
    const { spawn } = require('child_process');
    const pyPath = path.join(__dirname, 'swift_generator', 'bridge.py');
    const pythonProc = spawn('python', [pyPath]);

    let output = '';
    let errOutput = '';

    pythonProc.stdout.on('data', (data) => output += data.toString());
    pythonProc.stderr.on('data', (data) => errOutput += data.toString());

    pythonProc.on('close', (code) => {
      try {
        const result = JSON.parse(output);

        if (result.status === 'ERROR') {
          return res.status(422).json({ success: false, ...result });
        }
        res.json({ success: true, ...result });
      } catch (parseErr) {
        console.error('Python Output:', output);
        console.error('Python Error:', errOutput);
        res.status(500).json({
          success: false,
          status: 'ERROR',
          error: 'Failed to parse SWIFT Generator output.',
          raw: output,
          stderr: errOutput
        });
      }
    });

    pythonProc.stdin.write(JSON.stringify(lcData));
    pythonProc.stdin.end();

  } catch (e) {
    console.error('[swift-draft POST]', e);
    res.status(500).json({ success: false, status: 'ERROR', error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║   Barclays LC System — Full STP Server Running   ║');
  console.log(`  ║   http://localhost:${PORT}                          ║`);
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║   Client Portal : /loc-client.html               ║`);
  console.log(`  ║   Officer Dash  : /loc-officer.html              ║`);
  console.log(`  ║   Rule Engine   : POST /api/decision/:ref        ║`);
  console.log(`  ║   MT700 Draft   : GET  /api/mt700/:ref           ║`);
  console.log(`  ║   Compliance    : PATCH /api/compliance/:ref     ║`);
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});
