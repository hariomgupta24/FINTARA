"""
validator.py — SWIFT MT700 / MT707 Field Validator
====================================================
Validates LC data before message generation:
  • Mandatory field presence
  • Date format (YYMMDD)
  • Currency code (ISO 4217)
  • Amount format
  • Field length limits per SWIFT standard
"""

import re
from datetime import datetime
from typing import Any, Dict, List, Tuple

# ── SWIFT field length limits (max chars) ──────────────────────────────────
FIELD_LIMITS: Dict[str, int] = {
    "lc_number":           16,
    "goods_description":  1000,
    "additional_conditions": 8000,
    "charges":             35,
}

# ── ISO 4217 subset (common trade currencies) ──────────────────────────────
VALID_CURRENCIES = {
    "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "SGD",
    "HKD", "INR", "AED", "CNY", "MYR", "THB", "ZAR", "BRL",
    "NOK", "SEK", "DKK", "NZD", "KWD", "QAR", "SAR", "BHD",
}

# ── MT707 extra mandatory fields ───────────────────────────────────────────
MT707_REQUIRED = ["amendment_sequence", "amendment_date", "amendments"]


def _parse_date(raw: str) -> Tuple[bool, str]:
    """Try to parse date string in various formats → return (ok, YYMMDD)."""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d", "%d %b %Y", "%d %B %Y"):
        try:
            dt = datetime.strptime(str(raw).strip(), fmt)
            return True, dt.strftime("%y%m%d")
        except ValueError:
            continue
    return False, ""


def _parse_amount(raw: Any) -> Tuple[bool, str]:
    """
    Parse and format amount → SWIFT style (max 15 digits, comma decimal).
    E.g. 1234567.89 → "1234567,89"
    """
    try:
        value = float(str(raw).replace(",", ""))
        if value <= 0:
            return False, ""
        # SWIFT uses comma as decimal separator
        formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", "")
        # Remove thousand separators already gone; just keep digits and comma
        numeric = re.sub(r"[^\d,]", "", f"{value:.2f}".replace(".", ","))
        return True, numeric
    except (ValueError, TypeError):
        return False, ""


def validate_lc_data(lc_data: dict, message_type: str = "MT700") -> Tuple[bool, List[str], dict]:
    """
    Validate LC data dict.

    Returns:
        (is_valid, errors_list, normalised_data)
        normalised_data has dates → YYMMDD, amounts → SWIFT string.
    """
    errors: List[str] = []
    data = dict(lc_data)   # shallow copy for normalisation

    # ── 1. Mandatory fields check ──────────────────────────────────────────
    base_required = {
        "lc_number":           "LC Number (:20:)",
        "issue_date":          "Date of Issue (:31C:)",
        "applicant":           "Applicant (:50:)",
        "beneficiary":         "Beneficiary (:59:)",
        "amount":              "Amount (:32B:)",
        "currency":            "Currency (:32B:)",
        "expiry_date":         "Expiry Date (:31D:)",
        "expiry_place":        "Expiry Place (:31D:)",
        "goods_description":   "Description of Goods (:45A:)",
        "documents_required":  "Documents Required (:46A:)",
        "payment_terms":       "Payment Terms (:41A:)",
    }
    for field, label in base_required.items():
        val = data.get(field)
        if val is None or (isinstance(val, (str, list, dict)) and not val):
            errors.append(f"Missing mandatory field: {label} ('{field}')")

    if message_type == "MT707":
        for field in MT707_REQUIRED:
            if not data.get(field):
                errors.append(f"Missing MT707 field: '{field}'")

    # ── 2. Applicant / Beneficiary structure ──────────────────────────────
    for party in ("applicant", "beneficiary"):
        obj = data.get(party)
        if isinstance(obj, dict):
            if not obj.get("name"):
                errors.append(f"'{party}.name' is required.")
        elif obj is not None:
            errors.append(f"'{party}' must be a dict with at least 'name'.")

    # ── 3. Date validation & normalisation ────────────────────────────────
    for date_field in ("issue_date", "expiry_date", "amendment_date"):
        raw = data.get(date_field)
        if raw:
            ok, normalised = _parse_date(raw)
            if not ok:
                errors.append(
                    f"'{date_field}' has invalid format '{raw}'. "
                    "Expected YYYY-MM-DD or DD/MM/YYYY."
                )
            else:
                data[date_field + "_swift"] = normalised   # store YYMMDD copy

    # ── 4. Currency validation ────────────────────────────────────────────
    currency = str(data.get("currency", "")).upper().strip()
    if currency and currency not in VALID_CURRENCIES:
        errors.append(f"Currency '{currency}' is not a recognised ISO 4217 code.")
    else:
        data["currency"] = currency

    # ── 5. Amount validation & normalisation ──────────────────────────────
    raw_amt = data.get("amount")
    if raw_amt is not None:
        ok, formatted = _parse_amount(raw_amt)
        if not ok:
            errors.append(f"'amount' value '{raw_amt}' is invalid or non-positive.")
        else:
            data["amount_swift"] = formatted
            # Also check 15-digit limit
            digits_only = re.sub(r"\D", "", formatted)
            if len(digits_only) > 15:
                errors.append("'amount' exceeds SWIFT 15-digit maximum.")

    # ── 6. Field length limits ────────────────────────────────────────────
    for field, limit in FIELD_LIMITS.items():
        val = data.get(field, "")
        if isinstance(val, str) and len(val) > limit:
            errors.append(
                f"Field '{field}' exceeds SWIFT maximum length of {limit} chars "
                f"(current: {len(val)} chars)."
            )

    # ── 7. LC Number character check (:20: — no special chars) ───────────
    lc_num = str(data.get("lc_number", ""))
    if lc_num and not re.match(r"^[A-Za-z0-9/\-?:().,'+ ]+$", lc_num):
        errors.append(
            f"'lc_number' contains characters not allowed in SWIFT :20: field."
        )

    # ── 8. Documents Required must be a list ─────────────────────────────
    docs = data.get("documents_required")
    if docs is not None and not isinstance(docs, list):
        errors.append("'documents_required' must be a list of strings.")

    is_valid = len(errors) == 0
    return is_valid, errors, data
