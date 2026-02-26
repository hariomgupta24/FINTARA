/**
 * ================================================================
 *  Barclays Bank — Pre-Draft Letter of Credit Generation Module
 *  UCP 600 Compliant | Production-Ready | Fully Automated
 *  Module: lc-generator.js
 * ================================================================
 */
'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ────────────────────────────────────────────────────────────
//  SECTION 1 — MANDATORY FIELD VALIDATOR
// ────────────────────────────────────────────────────────────

const MANDATORY_FIELDS = [
    { key: 'applicantName', label: 'Applicant Name' },
    { key: 'beneficiaryName', label: 'Beneficiary Name' },
    { key: 'lcAmount', label: 'LC Amount' },
    { key: 'lcCurrency', label: 'LC Currency' },
    { key: 'lcExpiryDate', label: 'Expiry Date' },
    { key: 'portLoading', label: 'Port of Loading' },
    { key: 'portDischarge', label: 'Port of Discharge' },
    { key: 'goodsDesc', label: 'Description of Goods' },
    { key: 'paymentTerms', label: 'Payment Terms' },
    { key: 'issuingBank', label: 'Issuing Bank' },
];

/**
 * Validates mandatory fields.
 * @param {Object} data - LC application data
 * @returns {{ valid: boolean, missing: string[], warnings: string[], fieldStatus: Object }}
 */
function validateLC(data) {
    const missing = [];
    const fieldStatus = {};

    for (const { key, label } of MANDATORY_FIELDS) {
        const val = data[key];
        const present = val !== undefined && val !== null && String(val).trim() !== '' && String(val).trim() !== '0';
        fieldStatus[key] = { label, present, value: val };
        if (!present) missing.push(label);
    }

    const warnings = [];

    // Logical consistency: shipment date vs expiry date
    if (data.latestShipDate && data.lcExpiryDate) {
        const shipD = new Date(data.latestShipDate);
        const expD = new Date(data.lcExpiryDate);
        if (shipD >= expD) {
            warnings.push(`Latest shipment date (${data.latestShipDate}) must be before LC expiry date (${data.lcExpiryDate}) — UCP 600 Art. 29.`);
        }
    }

    // Amount sanity
    if (data.lcAmount && parseFloat(data.lcAmount) <= 0) {
        warnings.push('LC Amount must be greater than zero.');
    }

    // Currency code check
    const validCurrencies = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'AED', 'SGD', 'CNY', 'CHF', 'CAD', 'AUD'];
    if (data.lcCurrency && !validCurrencies.includes(data.lcCurrency.toUpperCase())) {
        warnings.push(`Currency "${data.lcCurrency}" is non-standard. Verify ISO 4217 code.`);
    }

    return {
        valid: missing.length === 0,
        missing,
        warnings,
        fieldStatus,
    };
}

// ────────────────────────────────────────────────────────────
//  SECTION 2 — CLAUSE AUTO-GENERATOR
// ────────────────────────────────────────────────────────────

/**
 * Auto-generates UCP 600 standard clauses based on application data.
 * @param {Object} d - LC application data
 * @returns {Object} Named clauses
 */
function generateClauses(d) {
    const amt = parseFloat(d.lcAmount || 0);
    const tol = parseFloat(d.tolerancePct || 5);
    const inco = (d.incoterms || '').toUpperCase();
    const specInstr = (d.specialInstructions || '').toLowerCase();
    const payTerms = (d.paymentTerms || 'At Sight').toLowerCase();
    const lcType = (d.lcType || 'Sight').toLowerCase();

    // ── Partial Shipment Clause ──
    const partialShipmentClause = d.partialShipments === 'Yes'
        ? 'Partial shipments are ALLOWED under this documentary credit.'
        : 'Partial shipments are NOT ALLOWED under this documentary credit. Each shipment must be for the full quantity specified herein.';

    // ── Transshipment Clause ──
    const transshipmentClause = d.transhipment === 'Yes'
        ? 'Transshipment is ALLOWED provided the entire voyage is covered by the same Bill of Lading.'
        : 'Transshipment is NOT ALLOWED. Goods must be shipped directly from port of loading to port of discharge without intermediate transshipment.';

    // ── Insurance Clause (Incoterms-driven) ──
    let insuranceClause;
    if (['CIF', 'CIP'].includes(inco)) {
        insuranceClause = `Insurance: As per Incoterms ${inco}, the seller (Beneficiary) is responsible for arranging and paying for cargo insurance. An Insurance Certificate or Insurance Policy endorsed in blank, covering 110% of the invoice value for all risks, must be presented with the documents. Cover must be effective from the place of taking in charge to the place of final destination.`;
    } else if (['FOB', 'EXW', 'FCA', 'FAS'].includes(inco)) {
        insuranceClause = `Insurance: As per Incoterms ${inco}, insurance is the responsibility of the Buyer (Applicant). The Beneficiary is not required to present an insurance document. However, packing must ensure goods are adequately protected during transit.`;
    } else if (['DAP', 'DDP', 'DPU'].includes(inco)) {
        insuranceClause = `Insurance: As per Incoterms ${inco}, the seller (Beneficiary) bears risk until delivery at the named place. Insurance Certificate covering 110% of invoice value is required.`;
    } else {
        insuranceClause = `Insurance: Insurance Certificate or Policy covering 110% of the invoice value for all risks from port of origin to final destination, endorsed in blank, must be presented unless otherwise agreed.`;
    }

    // ── Payment Clause ──
    let paymentClause;
    if (payTerms.includes('sight') || lcType === 'sight') {
        paymentClause = `Payment Clause: This documentary credit is available by PAYMENT AT SIGHT. Upon receipt of documents strictly complying with the terms and conditions of this credit, the Issuing Bank undertakes to effect payment immediately to the Beneficiary or their designated bank. Documents must be presented within the validity period of the credit.`;
    } else if (payTerms.includes('usance') || payTerms.includes('days') || lcType === 'usance') {
        const dayMatch = payTerms.match(/(\d+)\s*day/i);
        const days = dayMatch ? dayMatch[1] : '90';
        paymentClause = `Payment Clause: This documentary credit is available by ACCEPTANCE. Drafts drawn at ${days} days after Bill of Lading date / date of shipment will be accepted by the Drawee Bank. Payment will be effected at maturity of the accepted drafts. The Beneficiary may request discounting of accepted drafts subject to applicable banking charges.`;
    } else if (lcType === 'standby') {
        paymentClause = `Payment Clause: This is a STANDBY Letter of Credit governed by UCP 600. Payment will be effected only upon presentation of a written demand certifying that the Applicant has failed to perform their contractual obligations, accompanied by the relevant documentation as specified herein.`;
    } else if (lcType === 'revolving') {
        paymentClause = `Payment Clause: This is a REVOLVING documentary credit. Upon each utilisation and reinstatement, the available amount is automatically reinstated to the original amount without requiring any amendment, subject to the terms herein. Maximum cumulative drawings shall not exceed the total LC amount within the validity period.`;
    } else {
        paymentClause = `Payment Clause: Available by payment at the counters of the Issuing Bank against presentation of stipulated documents in strict compliance with the terms and conditions of this documentary credit.`;
    }

    // ── Tolerance Clause ──
    const toleranceClause = tol > 0
        ? `Tolerance Clause: A tolerance of ${tol}% more or ${tol}% less in both the unit price and quantity of goods described herein is acceptable, provided the total drawing amount does not exceed the face value of this documentary credit. This tolerance applies per UCP 600 Article 30.`
        : `Tolerance Clause: NO tolerance is permitted. The amount drawn must be exactly equal to the LC face value. Partial drawings are subject to the partial shipment clause.`;

    // ── Inspection Clause ──
    let inspectionClause = null;
    const inspKeywords = ['inspection', 'sgs', 'bv', 'bureau veritas', 'tüv', 'tuv', 'pre-shipment', 'quality check', 'ceig', 'weight'];
    const hasInspection = inspKeywords.some(kw => specInstr.includes(kw));
    if (hasInspection) {
        // Extract which body is mentioned
        const bodies = [];
        if (specInstr.includes('sgs')) bodies.push('SGS');
        if (specInstr.includes('bv') || specInstr.includes('bureau veritas')) bodies.push('Bureau Veritas');
        if (specInstr.includes('tüv') || specInstr.includes('tuv')) bodies.push('TÜV');
        if (specInstr.includes('ceig')) bodies.push('CEIG');
        const bodyStr = bodies.length > 0 ? bodies.join('/') : 'an internationally recognised independent inspection agency';
        inspectionClause = `Inspection Clause: A pre-shipment Inspection Certificate issued by ${bodyStr} confirming that the goods described herein comply with the contractual specifications, quality standards, and applicable regulatory requirements must be presented. Goods not accompanied by a valid Inspection Certificate will be deemed non-compliant.`;
    }

    // ── Charges Clause ──
    const chargesClause = `Charges Clause: All banking charges and commissions levied outside the Republic of India are for the account of the BENEFICIARY. All banking charges and commissions levied within the Republic of India are for the account of the APPLICANT. If any bank outside India deducts charges from the payment proceeds, the Beneficiary shall bear such deductions.`;

    // ── Governing Rules Clause ──
    const governingRulesClause = `Governing Rules: This documentary credit is subject to the Uniform Customs and Practice for Documentary Credits, 2007 Revision, International Chamber of Commerce Publication No. 600 (UCP 600). In matters not covered by UCP 600, the laws of England and Wales shall apply.`;

    // ── Undertaking Clause ──
    const undertakingClause = `Banker's Undertaking: We, ${(d.issuingBank || 'Barclays Bank PLC')}, hereby engage with the Beneficiary, the Confirming Bank (if any), and any Bona Fide Holder, that documents presented under and in strict compliance with the terms and conditions of this Credit will be duly honoured on presentation at our counters. This Credit is irrevocable and we undertake that it shall not be cancelled, modified, or amended without the prior written consent of the Beneficiary and the Applicant.`;

    // ── Presentation Period Clause ──
    const presentationClause = `Presentation Period: Documents must be presented for negotiation or payment not later than 21 (twenty-one) days after the date of shipment, but in any event, not later than the expiry date and place of this credit as stated herein. Late presentation of documents will render them non-compliant under UCP 600 Article 14(c).`;

    return {
        partialShipmentClause,
        transshipmentClause,
        insuranceClause,
        paymentClause,
        toleranceClause,
        inspectionClause,
        chargesClause,
        governingRulesClause,
        undertakingClause,
        presentationClause,
    };
}

// ────────────────────────────────────────────────────────────
//  SECTION 2B — LC FEE & COMMISSION CALCULATOR
// ────────────────────────────────────────────────────────────

/**
 * Barclays LC Fee Schedule — Tenor-Based Commission Rates
 * Rates are midpoints of the published range for standard corporate clients.
 * Actual rates may vary based on client relationship, credit profile, and deal complexity.
 */
const FEE_SCHEDULE = {
    tenorBands: [
        { maxMonths: 3, label: 'Up to 3 months', minRate: 0.10, maxRate: 0.50, midRate: 0.30 },
        { maxMonths: 6, label: 'Up to 6 months', minRate: 0.20, maxRate: 1.00, midRate: 0.60 },
        { maxMonths: 12, label: 'Up to 1 year', minRate: 0.40, maxRate: 2.00, midRate: 1.20 },
        { maxMonths: 999, label: 'Over 1 year', minRate: 0.60, maxRate: 2.50, midRate: 1.55 },
    ],
    fixedFees: {
        advisingFee: { amount: 5000, currency: 'INR', label: 'Advising Fee (Flat)' },
        amendmentFee: { amount: 2500, currency: 'INR', label: 'Amendment Fee (per amendment)' },
        courierSwiftCharges: { amount: 3500, currency: 'INR', label: 'Courier / SWIFT Charges' },
    },
    negotiationFeePct: 0.125,  // % of LC amount
    confirmationPremiumPct: 0.15, // Additional % if confirmation requested
    gstRate: 18, // GST on banking services in India (%)
};

/**
 * Calculates LC fees and commission based on tenor and amount.
 * @param {Object} data - LC application data
 * @returns {Object} Detailed fee breakdown
 */
function calculateLCFees(data) {
    const amount = parseFloat(data.lcAmount || 0);
    const currency = (data.lcCurrency || 'USD').toUpperCase();
    const issueDate = new Date();
    const expiryDate = data.lcExpiryDate ? new Date(data.lcExpiryDate) : null;

    // Calculate tenor in months
    let tenorMonths = 3; // default
    if (expiryDate && !isNaN(expiryDate)) {
        const diffMs = expiryDate - issueDate;
        tenorMonths = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30.44)));
    }

    // Find applicable tenor band
    const band = FEE_SCHEDULE.tenorBands.find(b => tenorMonths <= b.maxMonths)
        || FEE_SCHEDULE.tenorBands[FEE_SCHEDULE.tenorBands.length - 1];

    // Issuance Commission (main fee — % of LC amount)
    const issuanceCommissionPct = band.midRate;
    const issuanceCommission = (amount * issuanceCommissionPct) / 100;

    // Negotiation / Acceptance Fee
    const negotiationFee = (amount * FEE_SCHEDULE.negotiationFeePct) / 100;

    // Confirmation Premium (only if confirming bank is specified)
    const hasConfirmation = !!(data.confirmingBank && data.confirmingBank.trim());
    const confirmationPremium = hasConfirmation
        ? (amount * FEE_SCHEDULE.confirmationPremiumPct) / 100
        : 0;

    // Fixed fees (in INR)
    const advisingFee = FEE_SCHEDULE.fixedFees.advisingFee.amount;
    const amendmentFee = FEE_SCHEDULE.fixedFees.amendmentFee.amount;
    const courierSwift = FEE_SCHEDULE.fixedFees.courierSwiftCharges.amount;

    // Total variable fees (% based)
    const totalVariableFees = issuanceCommission + negotiationFee + confirmationPremium;

    // Total fixed fees (INR)
    const totalFixedFees = advisingFee + courierSwift;

    // GST on all fees
    const gstOnVariable = (totalVariableFees * FEE_SCHEDULE.gstRate) / 100;
    const gstOnFixed = (totalFixedFees * FEE_SCHEDULE.gstRate) / 100;

    // Grand totals
    const totalFeesBeforeGST = totalVariableFees + totalFixedFees;
    const totalGST = gstOnVariable + gstOnFixed;
    const grandTotal = totalFeesBeforeGST + totalGST;

    return {
        tenorMonths,
        tenorBand: band.label,
        commissionRange: `${band.minRate}% – ${band.maxRate}%`,
        appliedRate: band.midRate,
        currency,
        lcAmount: amount,
        breakdown: [
            { item: 'LC Issuance Commission', rate: `${issuanceCommissionPct}%`, amount: round2(issuanceCommission), currency, type: 'variable' },
            { item: 'Negotiation / Acceptance Fee', rate: `${FEE_SCHEDULE.negotiationFeePct}%`, amount: round2(negotiationFee), currency, type: 'variable' },
            ...(hasConfirmation ? [{ item: 'Confirmation Premium', rate: `${FEE_SCHEDULE.confirmationPremiumPct}%`, amount: round2(confirmationPremium), currency, type: 'variable' }] : []),
            { item: 'Advising Fee (Flat)', rate: 'Flat', amount: advisingFee, currency: 'INR', type: 'fixed' },
            { item: 'Courier / SWIFT Charges', rate: 'Flat', amount: courierSwift, currency: 'INR', type: 'fixed' },
        ],
        amendmentFee: { amount: amendmentFee, currency: 'INR', note: 'Per amendment, charged separately' },
        subtotal: round2(totalFeesBeforeGST),
        gstRate: FEE_SCHEDULE.gstRate,
        gstAmount: round2(totalGST),
        grandTotal: round2(grandTotal),
        totalVariableFees: round2(totalVariableFees),
        totalFixedFees: round2(totalFixedFees),
        note: 'Rates are indicative based on standard corporate schedule. Final rates subject to relationship pricing and credit assessment.',
    };
}

function round2(n) { return Math.round(n * 100) / 100; }

// ────────────────────────────────────────────────────────────
//  SECTION 3 — UCP 600 LC TEMPLATE ENGINE
// ────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(iso) {
    if (!iso) return 'NOT SPECIFIED';
    const d = new Date(iso);
    if (isNaN(d)) return iso.toUpperCase();
    return `${pad(d.getDate())} ${d.toLocaleString('en-GB', { month: 'long' }).toUpperCase()} ${d.getFullYear()}`;
}
function fmtDateSwift(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function genLCNumber() {
    const yr = new Date().getFullYear();
    const rnd = Math.floor(100000 + Math.random() * 900000);
    return `BRCIN-LC-${yr}-${rnd}`;
}

/**
 * Main LC draft generator. Validates, generates clauses and produces the full draft text.
 * @param {Object} data - LC application data (camelCase keys matching DB schema)
 * @returns {Object} { status, lcNumber, issueDate, validationSummary, structuredLC, draftText, clauses }
 */
function generateLCDraft(data) {
    // Step 1: Validate
    const validation = validateLC(data);

    if (!validation.valid) {
        return {
            status: 'ERROR',
            message: 'LC draft cannot be generated due to missing mandatory fields.',
            missing_fields: validation.missing,
            warnings: validation.warnings,
            validationSummary: validation,
        };
    }

    // Step 2: Generate clauses
    const clauses = generateClauses(data);

    // Step 2B: Calculate fees
    const feeSchedule = calculateLCFees(data);

    // Step 3: Structured LC Data Object
    const lcNumber = data.ref || genLCNumber();
    const issueDate = new Date().toISOString();
    const issueDateFmt = fmtDate(issueDate);
    const expiryDateFmt = fmtDate(data.lcExpiryDate);
    const shipDateFmt = fmtDate(data.latestShipDate);
    const currency = (data.lcCurrency || 'USD').toUpperCase();
    const amount = parseFloat(data.lcAmount || 0);
    const tolerance = parseFloat(data.tolerancePct || 5);
    const maxAmount = amount * (1 + tolerance / 100);
    const docs = Array.isArray(data.documents) ? data.documents : [];

    // Availability clause
    const lcType = (data.lcType || 'Sight').toLowerCase();
    const availableBy = lcType === 'sight' ? 'PAYMENT'
        : lcType === 'usance' ? 'ACCEPTANCE'
            : lcType === 'standby' ? 'PAYMENT'
                : 'NEGOTIATION';

    const structuredLC = {
        lcNumber,
        issuingBank: data.issuingBank || 'Barclays Bank PLC, India',
        issueBranch: 'Trade Finance Division, Corporate Banking',
        issueDate: issueDate.slice(0, 10),
        formOfCredit: `${(data.lcType || 'Sight').toUpperCase()} IRREVOCABLE`,
        applicantName: data.applicantName,
        applicantAddress: [data.applicantAddress, data.applicantCity, data.applicantCountry].filter(Boolean).join(', '),
        applicantAccount: data.applicantAccount || 'On file',
        beneficiaryName: data.beneficiaryName,
        beneficiaryAddress: [data.beneficiaryAddress, data.beneficiaryCity, data.beneficiaryCountry].filter(Boolean).join(', '),
        beneficiaryBank: data.beneficiaryBankName || data.advisingBank || 'As per Beneficiary instructions',
        beneficiarySwift: data.beneficiarySwift || '',
        currency,
        amount,
        tolerancePct: tolerance,
        maxAmount: parseFloat(maxAmount.toFixed(2)),
        expiryDate: data.lcExpiryDate,
        expiryPlace: data.lcExpiryPlace || data.beneficiaryCountry || 'At Issuing Bank Counters',
        availableWith: data.advisingBank || data.issuingBank || 'Barclays Bank PLC',
        availableBy,
        advisingBank: data.advisingBank || 'To be advised',
        confirmingBank: data.confirmingBank || 'Without confirmation',
        negotiatingBank: data.negotiatingBank || 'Any bank',
        portOfLoading: data.portLoading,
        portOfDischarge: data.portDischarge,
        latestShipmentDate: data.latestShipDate,
        incoterms: (data.incoterms || '').toUpperCase(),
        goodsDescription: data.goodsDesc,
        quantity: data.quantity || '',
        unitPrice: data.unitPrice || '',
        hsCode: data.hsCode || '',
        countryOfOrigin: data.countryOrigin || '',
        requiredDocuments: docs,
        additionalDocuments: data.additionalDocs || '',
        paymentTerms: data.paymentTerms || 'At Sight',
        specialInstructions: data.specialInstructions || '',
        ucpVersion: 'UCP 600 (ICC Publication No. 600, 2007 Revision)',
        governingLaw: 'Laws of England and Wales',
    };

    // Step 4: Generate human-readable draft text
    const LINE = '─'.repeat(72);
    const DLINE = '═'.repeat(72);

    const docsList = docs.length > 0
        ? docs.map((d, i) => `   ${String.fromCharCode(65 + i)}. ${d}`).join('\n')
        : '   A. Commercial Invoice\n   B. Full Set of Clean On-Board Bills of Lading\n   C. Packing List';

    const additionalDocsSection = data.additionalDocs
        ? `\n\n   ADDITIONAL DOCUMENTS:\n   ${data.additionalDocs}`
        : '';

    const inspClause = clauses.inspectionClause
        ? `\n\n─── INSPECTION REQUIREMENTS ───\n${clauses.inspectionClause}`
        : '';

    const confirmationLine = data.confirmingBank
        ? `CONFIRMATION INSTRUCTIONS : CONFIRM\nCONFIRMING BANK              : ${data.confirmingBank.toUpperCase()}`
        : `CONFIRMATION INSTRUCTIONS : WITHOUT`;

    const draftText = `
${DLINE}
              BARCLAYS BANK PLC — DOCUMENTARY LETTER OF CREDIT
                           PRE-DRAFT DOCUMENT
                  Subject to UCP 600 (ICC Publication No. 600)
${DLINE}

DOCUMENTARY CREDIT NUMBER    : ${lcNumber}
DATE OF ISSUE                : ${issueDateFmt}
FORM OF DOCUMENTARY CREDIT   : ${structuredLC.formOfCredit}
APPLICABLE RULES             : ${structuredLC.ucpVersion}

${LINE}
SECTION 1 — PARTIES
${LINE}

ISSUING BANK                 : ${(data.issuingBank || 'BARCLAYS BANK PLC, INDIA').toUpperCase()}
                               TRADE FINANCE DIVISION, CORPORATE BANKING
                               SWIFT: BARCGB22XXX

APPLICANT                    : ${(data.applicantName || '').toUpperCase()}
${data.applicantAddress ? `ADDRESS                      : ${(data.applicantAddress || '').toUpperCase()}` : ''}
${data.applicantCity ? `CITY / COUNTRY               : ${(data.applicantCity || '').toUpperCase()}, ${(data.applicantCountry || '').toUpperCase()}` : ''}
${data.applicantAccount ? `ACCOUNT NUMBER               : ${data.applicantAccount}` : ''}
${data.applicantGST ? `GST / TAX ID                 : ${data.applicantGST}` : ''}

BENEFICIARY                  : ${(data.beneficiaryName || '').toUpperCase()}
${data.beneficiaryAddress ? `ADDRESS                      : ${(data.beneficiaryAddress || '').toUpperCase()}` : ''}
${data.beneficiaryCity ? `CITY / COUNTRY               : ${(data.beneficiaryCity || '').toUpperCase()}, ${(data.beneficiaryCountry || '').toUpperCase()}` : ''}
BENEFICIARY'S BANK           : ${(structuredLC.beneficiaryBank).toUpperCase()}
${data.beneficiarySwift ? `SWIFT CODE                   : ${data.beneficiarySwift.toUpperCase()}` : ''}
${data.beneficiaryIBAN ? `IBAN / ACCOUNT               : ${data.beneficiaryIBAN}` : ''}

ADVISING BANK                : ${(data.advisingBank || 'TO BE ADVISED THROUGH CORRESPONDENT').toUpperCase()}
${confirmationLine}

${LINE}
SECTION 2 — CREDIT TERMS
${LINE}

CURRENCY                     : ${currency}
AMOUNT (FACE VALUE)          : ${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
AMOUNT IN WORDS              : ${numberToWords(amount)} ${currency} ONLY
MAXIMUM CREDIT AMOUNT        : ${currency} ${maxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (WITH ${tolerance}% TOLERANCE)

DATE OF EXPIRY               : ${expiryDateFmt}
PLACE OF EXPIRY              : ${(data.lcExpiryPlace || data.beneficiaryCountry || 'AT ISSUING BANK COUNTERS').toUpperCase()}

AVAILABLE WITH               : ${(structuredLC.availableWith).toUpperCase()}
AVAILABLE BY                 : ${availableBy}
NEGOTIATING BANK             : ${(structuredLC.negotiatingBank).toUpperCase()}

${LINE}
SECTION 3 — SHIPMENT DETAILS
${LINE}

PORT / PLACE OF LOADING      : ${(data.portLoading || '').toUpperCase()}
PORT / PLACE OF DISCHARGE    : ${(data.portDischarge || '').toUpperCase()}
LATEST DATE OF SHIPMENT      : ${shipDateFmt}
INCOTERMS (VERSION 2020)     : ${structuredLC.incoterms}

${LINE}
SECTION 4 — GOODS DESCRIPTION
${LINE}

DESCRIPTION OF GOODS:
   ${(data.goodsDesc || '').toUpperCase()}

${data.quantity ? `QUANTITY                     : ${(data.quantity || '').toUpperCase()}` : ''}
${data.unitPrice ? `UNIT PRICE                   : ${(data.unitPrice || '').toUpperCase()}` : ''}
${data.hsCode ? `HS TARIFF CODE               : ${data.hsCode}` : ''}
${data.countryOrigin ? `COUNTRY OF ORIGIN            : ${(data.countryOrigin || '').toUpperCase()}` : ''}

${LINE}
SECTION 5 — REQUIRED DOCUMENTS
${LINE}

The following documents must be presented in strict compliance with UCP 600:

${docsList}${additionalDocsSection}

All documents must be presented in the ENGLISH LANGUAGE unless otherwise specified.
Original documents must be presented in full sets unless otherwise stated.
Documents presented must bear the Documentary Credit Number: ${lcNumber}

${LINE}
SECTION 6 — TERMS AND CONDITIONS
${LINE}

─── PARTIAL SHIPMENTS ───
${clauses.partialShipmentClause}

─── TRANSSHIPMENT ───
${clauses.transshipmentClause}

─── INSURANCE ───
${clauses.insuranceClause}

─── PAYMENT ───
${clauses.paymentClause}

─── TOLERANCE ───
${clauses.toleranceClause}

─── PERIOD FOR PRESENTATION ───
${clauses.presentationClause}
${inspClause}

${LINE}
SECTION 7 — BANKING CHARGES & FEE SCHEDULE
${LINE}

${clauses.chargesClause}

─── BARCLAYS LC FEE SCHEDULE ───
LC TENOR                     : ${feeSchedule.tenorMonths} MONTH(S) — ${feeSchedule.tenorBand.toUpperCase()}
APPLICABLE COMMISSION RANGE  : ${feeSchedule.commissionRange} OF LC AMOUNT
APPLIED RATE (INDICATIVE)    : ${feeSchedule.appliedRate}% P.A.

FEE BREAKDOWN:
${feeSchedule.breakdown.map(f => `   ${f.item.padEnd(35)} ${f.rate.padEnd(10)} ${f.currency} ${f.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join('\n')}

   ${'AMENDMENT FEE (PER AMENDMENT)'.padEnd(35)} ${'Flat'.padEnd(10)} INR ${feeSchedule.amendmentFee.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}

   SUBTOTAL (BEFORE TAX)${' '.repeat(13)} ${currency} ${feeSchedule.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   GST @ ${feeSchedule.gstRate}%${' '.repeat(24)} ${currency} ${feeSchedule.gstAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
   ────────────────────────────────────────────────────
   ESTIMATED TOTAL CHARGES${' '.repeat(12)} ${currency} ${feeSchedule.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}

NOTE: ${feeSchedule.note}

${LINE}
SECTION 8 — GOVERNING RULES AND UNDERTAKING
${LINE}

${clauses.governingRulesClause}

${clauses.undertakingClause}

${data.specialInstructions ? `\n${LINE}\nSECTION 9 — SPECIAL INSTRUCTIONS\n${LINE}\n\n${(data.specialInstructions || '').toUpperCase()}\n` : ''}

${DLINE}
AUTHORISED SIGNATORIES — FOR AND ON BEHALF OF ${(data.issuingBank || 'BARCLAYS BANK PLC').toUpperCase()}
${DLINE}

____________________________          ____________________________
AUTHORISED SIGNATORY 1                 AUTHORISED SIGNATORY 2
TRADE FINANCE DIVISION                 TRADE FINANCE DIVISION

DATE: ${issueDateFmt}                 PLACE: ${(data.issuingBank || 'BARCLAYS BANK PLC, INDIA').includes(',') ? (data.issuingBank || '').split(',')[1].trim().toUpperCase() : 'INDIA'}

${DLINE}
IMPORTANT NOTICE: This is a computer-generated Pre-Draft Letter of Credit
for review and approval purposes only. This document does not constitute
a binding financial instrument until countersigned by authorised bank
officers and officially issued via SWIFT MT700 message.
${DLINE}
`.trim();

    return {
        status: 'SUCCESS',
        lcNumber,
        issueDate: issueDate.slice(0, 10),
        validationSummary: validation,
        structuredLC,
        clauses,
        feeSchedule,
        draftText,
    };
}

// ────────────────────────────────────────────────────────────
//  SECTION 4 — PDF GENERATOR
// ────────────────────────────────────────────────────────────

/**
 * Generate a formatted PDF from a successful LC draft result.
 * @param {Object} draftResult - Output from generateLCDraft() with status SUCCESS
 * @param {string} outputDir - Directory to write PDF file
 * @returns {Promise<{filePath: string, base64: string}>}
 */
function generateLCPDF(draftResult, outputDir) {
    return new Promise((resolve, reject) => {
        if (draftResult.status !== 'SUCCESS') {
            return reject(new Error('Cannot generate PDF for a failed draft.'));
        }

        const { lcNumber, structuredLC, draftText, issueDate } = draftResult;
        const safeName = lcNumber.replace(/[^a-zA-Z0-9-_]/g, '_');
        const fileName = `LC_PREDRAFT_${safeName}_${issueDate}.pdf`;
        const filePath = path.join(outputDir, fileName);

        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 60, right: 60 },
            info: {
                Title: `Letter of Credit Pre-Draft — ${lcNumber}`,
                Author: 'Barclays Bank PLC — Trade Finance Division',
                Subject: 'Documentary Letter of Credit (UCP 600)',
                Keywords: 'LC, Letter of Credit, UCP 600, Barclays, Trade Finance',
                Creator: 'Barclays LC System v2.0',
            },
        });

        const chunks = [];
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => {
            const pdfBuffer = Buffer.concat(chunks);
            // Write to file
            fs.writeFile(filePath, pdfBuffer, err => {
                if (err) return reject(err);
                resolve({
                    filePath,
                    fileName,
                    base64: pdfBuffer.toString('base64'),
                    sizeBytes: pdfBuffer.length,
                });
            });
        });
        doc.on('error', reject);

        // ── PDF STYLING CONSTANTS ──
        const NAVY = '#00266e';
        const GOLD = '#c8a951';
        const LIGHT_GRAY = '#f5f7fa';
        const DARK_TEXT = '#1a1a2e';
        const MID_TEXT = '#4a4a6a';
        const PAGE_W = doc.page.width - 120; // usable width

        // ── HEADER ──
        // Navy header bar
        doc.rect(0, 0, doc.page.width, 110).fill(NAVY);

        // Bank name
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff')
            .text('BARCLAYS BANK PLC', 60, 28, { align: 'left' });
        doc.font('Helvetica').fontSize(9).fillColor(GOLD)
            .text('TRADE FINANCE DIVISION  ·  CORPORATE BANKING', 60, 52);

        // LC Number & Date top-right
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
            .text(`LC REF: ${lcNumber}`, 60, 72, { align: 'right', width: PAGE_W });
        doc.font('Helvetica').fontSize(8).fillColor(GOLD)
            .text(`DATE OF ISSUE: ${fmtDate(issueDate)}`, 60, 86, { align: 'right', width: PAGE_W });

        // Document title below header
        doc.rect(0, 110, doc.page.width, 36).fill(GOLD);
        doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
            .text('PRE-DRAFT LETTER OF CREDIT  —  UCP 600 COMPLIANT', 60, 120, { align: 'center', width: PAGE_W });

        doc.moveDown(3);

        // ── HELPER FUNCTIONS FOR PDF ──
        function sectionHeader(title) {
            doc.moveDown(0.6);
            doc.rect(60, doc.y, PAGE_W, 20).fill(NAVY);
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
                .text(title, 66, doc.y - 16, { width: PAGE_W - 12 });
            doc.moveDown(0.4);
            doc.fillColor(DARK_TEXT);
        }

        function labelValue(label, value, opts = {}) {
            if (!value || String(value).trim() === '') return;
            const startY = doc.y;
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MID_TEXT)
                .text(label + ':', 60, startY, { width: 185, continued: false });
            doc.font('Helvetica').fontSize(8.5).fillColor(DARK_TEXT)
                .text(String(value), 250, startY, { width: PAGE_W - 190, ...opts });
            doc.moveDown(0.25);
        }

        function clauseBlock(title, text) {
            if (!text) return;
            doc.moveDown(0.3);
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor(NAVY).text(title);
            doc.font('Helvetica').fontSize(8).fillColor(DARK_TEXT)
                .text(text, { indent: 12, paragraphGap: 2 });
            doc.moveDown(0.2);
        }

        function divider() {
            doc.moveDown(0.3);
            doc.moveTo(60, doc.y).lineTo(60 + PAGE_W, doc.y).strokeColor(GOLD).lineWidth(0.8).stroke();
            doc.moveDown(0.3);
        }

        // ── SECTION 1: PARTIES ──
        sectionHeader('SECTION 1 — PARTIES TO THE DOCUMENTARY CREDIT');
        labelValue('Issuing Bank', structuredLC.issuingBank.toUpperCase());
        labelValue('Applicant', structuredLC.applicantName.toUpperCase());
        if (structuredLC.applicantAddress) labelValue('Applicant Address', structuredLC.applicantAddress.toUpperCase());
        if (structuredLC.applicantAccount) labelValue('Account Number', structuredLC.applicantAccount);
        divider();
        labelValue('Beneficiary', structuredLC.beneficiaryName.toUpperCase());
        if (structuredLC.beneficiaryAddress) labelValue('Beneficiary Address', structuredLC.beneficiaryAddress.toUpperCase());
        labelValue('Beneficiary\'s Bank', structuredLC.beneficiaryBank.toUpperCase());
        if (structuredLC.beneficiarySwift) labelValue('SWIFT Code', structuredLC.beneficiarySwift.toUpperCase());
        divider();
        labelValue('Advising Bank', structuredLC.advisingBank.toUpperCase());
        labelValue('Confirming Bank', structuredLC.confirmingBank.toUpperCase());
        labelValue('Negotiating Bank', structuredLC.negotiatingBank.toUpperCase());

        // ── SECTION 2: CREDIT TERMS ──
        sectionHeader('SECTION 2 — CREDIT TERMS');
        labelValue('Form of Credit', structuredLC.formOfCredit);
        labelValue('Currency', structuredLC.currency);
        labelValue('Face Amount', `${structuredLC.currency} ${structuredLC.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        labelValue('Amount in Words', numberToWords(structuredLC.amount) + ' ' + structuredLC.currency + ' Only');
        labelValue('Tolerance', `±${structuredLC.tolerancePct}%  (Max: ${structuredLC.currency} ${structuredLC.maxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
        divider();
        labelValue('Date of Expiry', fmtDate(structuredLC.expiryDate));
        labelValue('Place of Expiry', (structuredLC.expiryPlace || '').toUpperCase());
        labelValue('Available With', structuredLC.availableWith.toUpperCase());
        labelValue('Available By', structuredLC.availableBy);
        labelValue('Applicable Rules', structuredLC.ucpVersion);

        // ── SECTION 3: SHIPMENT ──
        sectionHeader('SECTION 3 — SHIPMENT DETAILS');
        labelValue('Port of Loading', structuredLC.portOfLoading.toUpperCase());
        labelValue('Port of Discharge', structuredLC.portOfDischarge.toUpperCase());
        labelValue('Latest Shipment Date', fmtDate(structuredLC.latestShipmentDate));
        labelValue('Incoterms 2020', structuredLC.incoterms);

        // ── SECTION 4: GOODS ──
        sectionHeader('SECTION 4 — DESCRIPTION OF GOODS');
        doc.font('Helvetica').fontSize(8.5).fillColor(DARK_TEXT)
            .text((structuredLC.goodsDescription || '').toUpperCase(), 60, doc.y, { width: PAGE_W, indent: 0 });
        doc.moveDown(0.3);
        if (structuredLC.quantity) labelValue('Quantity', structuredLC.quantity.toUpperCase());
        if (structuredLC.unitPrice) labelValue('Unit Price', structuredLC.unitPrice.toUpperCase());
        if (structuredLC.hsCode) labelValue('HS Code', structuredLC.hsCode);
        if (structuredLC.countryOfOrigin) labelValue('Country of Origin', structuredLC.countryOfOrigin.toUpperCase());

        // ── SECTION 5: DOCUMENTS ──
        sectionHeader('SECTION 5 — REQUIRED DOCUMENTS');
        const allDocs = structuredLC.requiredDocuments;
        if (allDocs.length > 0) {
            allDocs.forEach((d, i) => {
                doc.font('Helvetica').fontSize(8.5).fillColor(DARK_TEXT)
                    .text(`${String.fromCharCode(65 + i)}.  ${d}`, 66, doc.y, { width: PAGE_W - 12 });
                doc.moveDown(0.2);
            });
        }
        if (structuredLC.additionalDocuments) {
            doc.moveDown(0.2);
            doc.font('Helvetica-Oblique').fontSize(8).fillColor(MID_TEXT)
                .text('Additional: ' + structuredLC.additionalDocuments, 66, doc.y, { width: PAGE_W - 12 });
        }

        // ── SECTION 6: CLAUSES ──
        sectionHeader('SECTION 6 — TERMS AND CONDITIONS');
        const cls = draftResult.clauses;
        clauseBlock('Partial Shipments', cls.partialShipmentClause);
        clauseBlock('Transshipment', cls.transshipmentClause);
        clauseBlock('Insurance', cls.insuranceClause);
        clauseBlock('Payment', cls.paymentClause);
        clauseBlock('Tolerance', cls.toleranceClause);
        clauseBlock('Presentation Period', cls.presentationClause);
        if (cls.inspectionClause) clauseBlock('Inspection Requirements', cls.inspectionClause);

        // ── SECTION 7: CHARGES & FEE SCHEDULE ──
        sectionHeader('SECTION 7 — BANKING CHARGES & FEE SCHEDULE');
        doc.font('Helvetica').fontSize(8).fillColor(DARK_TEXT)
            .text(cls.chargesClause, 60, doc.y, { width: PAGE_W });
        doc.moveDown(0.5);

        // Fee schedule table in PDF
        const fees = draftResult.feeSchedule;
        if (fees) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY)
                .text(`BARCLAYS LC FEE SCHEDULE — TENOR: ${fees.tenorMonths} MONTH(S) (${fees.tenorBand})`, 60, doc.y);
            doc.moveDown(0.3);

            // Table header
            const tblY = doc.y;
            doc.rect(60, tblY, PAGE_W, 16).fill(NAVY);
            doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');
            doc.text('FEE ITEM', 66, tblY + 4, { width: 200 });
            doc.text('RATE', 270, tblY + 4, { width: 70 });
            doc.text('CURRENCY', 340, tblY + 4, { width: 60 });
            doc.text('AMOUNT', 410, tblY + 4, { width: 80, align: 'right' });
            doc.moveDown(0.5);

            // Table rows
            fees.breakdown.forEach((f, idx) => {
                const rowY = doc.y;
                const bgColor = idx % 2 === 0 ? LIGHT_GRAY : '#ffffff';
                doc.rect(60, rowY - 2, PAGE_W, 14).fill(bgColor);
                doc.font('Helvetica').fontSize(7.5).fillColor(DARK_TEXT);
                doc.text(f.item, 66, rowY, { width: 200 });
                doc.text(f.rate, 270, rowY, { width: 70 });
                doc.text(f.currency, 340, rowY, { width: 60 });
                doc.text(f.amount.toLocaleString('en-US', { minimumFractionDigits: 2 }), 410, rowY, { width: 80, align: 'right' });
                doc.moveDown(0.25);
            });

            // Totals
            doc.moveDown(0.3);
            doc.moveTo(60, doc.y).lineTo(60 + PAGE_W, doc.y).strokeColor(GOLD).lineWidth(0.8).stroke();
            doc.moveDown(0.2);
            doc.font('Helvetica-Bold').fontSize(8).fillColor(DARK_TEXT);
            doc.text(`Subtotal (Before Tax):`, 66, doc.y, { width: 340, continued: false });
            doc.text(`${fees.currency} ${fees.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 410, doc.y - 10, { width: 80, align: 'right' });
            doc.moveDown(0.2);
            doc.font('Helvetica').fontSize(8).fillColor(MID_TEXT);
            doc.text(`GST @ ${fees.gstRate}%:`, 66, doc.y, { width: 340 });
            doc.text(`${fees.currency} ${fees.gstAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 410, doc.y - 10, { width: 80, align: 'right' });
            doc.moveDown(0.3);
            doc.rect(60, doc.y, PAGE_W, 18).fill(NAVY);
            doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
            doc.text('ESTIMATED TOTAL CHARGES:', 66, doc.y - 14, { width: 340 });
            doc.text(`${fees.currency} ${fees.grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 410, doc.y - 14, { width: 80, align: 'right' });
            doc.moveDown(0.7);

            doc.font('Helvetica-Oblique').fontSize(7).fillColor(MID_TEXT)
                .text(fees.note, 60, doc.y, { width: PAGE_W });
        }
        doc.moveDown(0.4);

        // ── SECTION 8: GOVERNING RULES ──
        sectionHeader('SECTION 8 — GOVERNING RULES AND BANK UNDERTAKING');
        doc.font('Helvetica').fontSize(8).fillColor(DARK_TEXT)
            .text(cls.governingRulesClause, 60, doc.y, { width: PAGE_W });
        doc.moveDown(0.4);
        doc.font('Helvetica').fontSize(8).fillColor(DARK_TEXT)
            .text(cls.undertakingClause, 60, doc.y, { width: PAGE_W });

        // ── SPECIAL INSTRUCTIONS ──
        if (structuredLC.specialInstructions) {
            sectionHeader('SECTION 9 — SPECIAL INSTRUCTIONS');
            doc.font('Helvetica').fontSize(8).fillColor(DARK_TEXT)
                .text(structuredLC.specialInstructions.toUpperCase(), 60, doc.y, { width: PAGE_W });
        }

        // ── SIGNATURE BLOCK ──
        doc.moveDown(1.5);
        const sigY = doc.y;
        // Two signature lines
        doc.moveTo(60, sigY + 40).lineTo(240, sigY + 40).strokeColor(DARK_TEXT).lineWidth(0.5).stroke();
        doc.moveTo(300, sigY + 40).lineTo(480, sigY + 40).stroke();
        doc.font('Helvetica-Bold').fontSize(8).fillColor(DARK_TEXT)
            .text('AUTHORISED SIGNATORY 1', 60, sigY + 45);
        doc.text('AUTHORISED SIGNATORY 2', 300, sigY + 45);
        doc.font('Helvetica').fontSize(7.5).fillColor(MID_TEXT)
            .text('Trade Finance Division', 60, sigY + 57);
        doc.text('Trade Finance Division', 300, sigY + 57);

        // ── FOOTER (all pages) ──
        const pageRange = doc.bufferedPageRange();
        for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
            doc.switchToPage(i);
            const footerY = doc.page.height - 45;
            doc.rect(0, footerY - 10, doc.page.width, 55).fill(LIGHT_GRAY);
            doc.font('Helvetica').fontSize(7).fillColor(MID_TEXT)
                .text(
                    `IMPORTANT: This is a computer-generated Pre-Draft LC for review purposes only. Not a binding financial instrument until officially issued via SWIFT MT700.  ·  ${structuredLC.ucpVersion}  ·  © Barclays Bank PLC ${new Date().getFullYear()}`,
                    60, footerY, { align: 'center', width: PAGE_W }
                );
            doc.text(`Page ${i + 1} of ${pageRange.count}  ·  Ref: ${lcNumber}`, 60, footerY + 12, { align: 'center', width: PAGE_W });
        }

        doc.end();
    });
}

// ────────────────────────────────────────────────────────────
//  UTILITY — Number to Words (for LC amount)
// ────────────────────────────────────────────────────────────

function numberToWords(num) {
    if (!num || isNaN(num)) return 'ZERO';
    const n = Math.floor(Math.abs(parseFloat(num)));
    if (n === 0) return 'ZERO';

    const ones = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
        'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN',
        'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
    const tens = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

    function helper(n) {
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
        if (n < 1000) return ones[Math.floor(n / 100)] + ' HUNDRED' + (n % 100 ? ' AND ' + helper(n % 100) : '');
        if (n < 100000) return helper(Math.floor(n / 1000)) + ' THOUSAND' + (n % 1000 ? ' ' + helper(n % 1000) : '');
        if (n < 10000000) return helper(Math.floor(n / 100000)) + ' LAKH' + (n % 100000 ? ' ' + helper(n % 100000) : '');
        return helper(Math.floor(n / 10000000)) + ' CRORE' + (n % 10000000 ? ' ' + helper(n % 10000000) : '');
    }

    const dec = parseFloat(num) - n;
    const decStr = dec > 0 ? ` AND ${Math.round(dec * 100)}/100` : '';
    return helper(n) + decStr;
}

// ────────────────────────────────────────────────────────────
//  EXPORTS
// ────────────────────────────────────────────────────────────

module.exports = {
    validateLC,
    generateClauses,
    calculateLCFees,
    generateLCDraft,
    generateLCPDF,
};
