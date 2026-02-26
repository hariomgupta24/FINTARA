"""
================================================================
 Barclays Bank — Trade Finance KYC Module
 Document & Company Authenticity Verification
 Module: kyc_verifier.py
 Author: Barclays Trade Finance Engineering
 Version: 1.0.0
 Compliance: UCP 600 / RBI KYC Master Directions
================================================================

PURPOSE
-------
Verifies corporate identity by comparing extracted company data
against a trusted local registry dataset (simulating MCA/ROC DB).

DECISION OUTCOMES
-----------------
  VALID   → CIN found, all critical fields match, status ACTIVE
  REVIEW  → CIN found but one or more inconsistencies detected
  INVALID → CIN not found, company inactive, or critical data missing
"""

import csv
import json
import os
import re
from datetime import datetime
from typing import Optional

# ─────────────────────────────────────────────────────────────────
#  CONSTANTS
# ─────────────────────────────────────────────────────────────────

# Required fields that MUST be present in the input document data
REQUIRED_INPUT_FIELDS = [
    "company_name",
    "cin_number",
    "registration_date",
    "registered_address",
    "status",
]

# Acceptable active statuses (case-insensitive)
ACTIVE_STATUSES = {"active", "active (registered)"}

# Risk score bands (deterministic — no randomness)
RISK_SCORES = {
    "VALID":   {"base": 10, "per_issue": 3},   # 0–20
    "REVIEW":  {"base": 35, "per_issue": 8},   # 21–70
    "INVALID": {"base": 75, "per_issue": 5},   # 71–100
}

# CSV column headers for the registry file
REGISTRY_HEADERS = ["cin", "company_name", "registration_date", "registered_address", "status"]


# ─────────────────────────────────────────────────────────────────
#  SECTION 1 — REGISTRY LOADER
# ─────────────────────────────────────────────────────────────────

def load_registry(registry_path: str) -> dict:
    """
    Loads the CSV registry into a dictionary keyed by CIN (uppercase).
    If the file does not exist, it is created automatically with the correct
    headers and an empty registry is returned.
    If the file is empty or malformed, an empty registry is returned silently.

    Args:
        registry_path: Absolute or relative path to the CSV file.

    Returns:
        Dict mapping CIN → {cin, company_name, registration_date,
                             registered_address, status}
    """
    # ── Auto-create the file if it doesn't exist ───────────────────
    if not os.path.isfile(registry_path):
        parent = os.path.dirname(registry_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(registry_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=REGISTRY_HEADERS)
            writer.writeheader()
        return {}  # Newly created file has no data yet

    registry = {}
    with open(registry_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        # If file is empty, fieldnames will be None — return empty registry
        fieldnames = reader.fieldnames
        if not fieldnames:
            return {}

        # Normalise column names and check for required columns
        actual_cols = {c.strip().lower() for c in fieldnames}
        if not set(REGISTRY_HEADERS).issubset(actual_cols):
            return {}

        for row in reader:
            # Normalise keys (strip whitespace)
            cleaned = {k.strip().lower(): v.strip() for k, v in row.items() if k}
            cin = cleaned.get("cin", "").upper()
            if cin:
                registry[cin] = {
                    "cin": cin,
                    "company_name": cleaned.get("company_name", ""),
                    "registration_date": cleaned.get("registration_date", ""),
                    "registered_address": cleaned.get("registered_address", ""),
                    "status": cleaned.get("status", ""),
                }

    return registry


# ─────────────────────────────────────────────────────────────────
#  SECTION 2 — INPUT VALIDATOR
# ─────────────────────────────────────────────────────────────────

def validate_input(company_data: dict) -> list:
    """
    Checks that all required fields are present and non-empty in the
    submitted company data extracted from the document.

    Args:
        company_data: Dict with extracted fields from the document.

    Returns:
        List of error strings. Empty list means input is valid.
    """
    errors = []
    for field in REQUIRED_INPUT_FIELDS:
        value = company_data.get(field, None)
        if value is None or str(value).strip() == "":
            errors.append(
                f"Missing required field: '{field}' — cannot proceed with verification."
            )
    return errors


# ─────────────────────────────────────────────────────────────────
#  SECTION 3 — FIELD COMPARATORS
# ─────────────────────────────────────────────────────────────────

def normalise_name(name: str) -> str:
    """
    Normalises a company name for comparison:
    - Lowercase
    - Remove common legal suffixes for fuzzy matching
    - Collapse whitespace
    - Remove punctuation
    """
    name = name.lower().strip()
    suffixes = [
        r"\b(pvt\.?\s*ltd\.?|private limited)\b",
        r"\b(ltd\.?|limited)\b",
        r"\b(plc)\b",
        r"\b(llp)\b",
        r"\b(opc)\b",
        r"\b(inc\.?|incorporated)\b",
    ]
    for suffix in suffixes:
        name = re.sub(suffix, "", name, flags=re.IGNORECASE)
    name = re.sub(r"[^\w\s]", " ", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def compare_names(name_a: str, name_b: str) -> tuple:
    """
    Compares two company names.

    Returns:
        (match_level, detail)
        match_level: "EXACT" | "FUZZY" | "MISMATCH"
    """
    if name_a.strip().lower() == name_b.strip().lower():
        return "EXACT", "Company name matches exactly."

    norm_a = normalise_name(name_a)
    norm_b = normalise_name(name_b)

    if norm_a == norm_b:
        return "FUZZY", (
            f"Company name matches after normalisation "
            f"(suffix/punctuation difference). "
            f"Submitted: '{name_a}' | Registry: '{name_b}'"
        )

    if norm_a in norm_b or norm_b in norm_a:
        return "FUZZY", (
            f"Partial name match detected. "
            f"Submitted: '{name_a}' | Registry: '{name_b}'"
        )

    return "MISMATCH", (
        f"Company name mismatch. "
        f"Submitted: '{name_a}' | Registry: '{name_b}'"
    )


def normalise_date(date_str: str) -> Optional[str]:
    """
    Normalises a date string to YYYY-MM-DD format.
    Accepts common formats: YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY,
    DD Mon YYYY, Month DD YYYY.

    Returns:
        Normalised date string or None if parsing fails.
    """
    if not date_str or str(date_str).strip() == "":
        return None

    date_str = str(date_str).strip()
    formats_to_try = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%d %B %Y",
        "%d %b %Y",
        "%B %d, %Y",
        "%b %d, %Y",
        "%Y/%m/%d",
    ]
    for fmt in formats_to_try:
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def compare_dates(date_a: str, date_b: str) -> tuple:
    """
    Compares two date strings after normalisation.

    Returns:
        (match_level, detail)
        match_level: "MATCH" | "MISMATCH" | "UNPARSEABLE"
    """
    norm_a = normalise_date(date_a)
    norm_b = normalise_date(date_b)

    if norm_a is None or norm_b is None:
        return "UNPARSEABLE", (
            f"Could not parse one or both registration dates. "
            f"Submitted: '{date_a}' | Registry: '{date_b}'"
        )

    if norm_a == norm_b:
        return "MATCH", f"Registration date matches: {norm_a}"

    return "MISMATCH", (
        f"Registration date mismatch. "
        f"Submitted: '{norm_a}' | Registry: '{norm_b}'"
    )


def compare_status(status_submitted: str, status_registry: str) -> tuple:
    """
    Checks whether the registry status is ACTIVE.

    Returns:
        (is_active, detail)
    """
    reg_status_norm = status_registry.strip().lower()
    is_active = reg_status_norm in ACTIVE_STATUSES

    if is_active:
        return True, f"Company status is ACTIVE in registry ('{status_registry}')."
    else:
        return False, (
            f"Company is NOT active in registry. "
            f"Registry status: '{status_registry}' — LC issuance is HIGH RISK."
        )


# ─────────────────────────────────────────────────────────────────
#  SECTION 4 — RISK SCORE CALCULATOR
# ─────────────────────────────────────────────────────────────────

def compute_risk_score(decision: str, issue_count: int) -> int:
    """
    Computes a deterministic risk score based on the decision and
    the number of issues/discrepancies found.

    Score bands:
        VALID   → 0–20  (base 10, +3 per minor issue, capped at 20)
        REVIEW  → 21–70 (base 35, +8 per issue, capped at 70)
        INVALID → 71–100 (base 75, +5 per issue, capped at 100)
    """
    band = RISK_SCORES.get(decision, RISK_SCORES["INVALID"])
    raw = band["base"] + (issue_count * band["per_issue"])

    caps   = {"VALID": 20, "REVIEW": 70, "INVALID": 100}
    floors = {"VALID": 0,  "REVIEW": 21, "INVALID": 71}

    capped  = min(raw, caps.get(decision, 100))
    floored = max(capped, floors.get(decision, 0))
    return floored


# ─────────────────────────────────────────────────────────────────
#  SECTION 5 — CORE VERIFICATION ENGINE
# ─────────────────────────────────────────────────────────────────

def verify_company(company_data: dict, registry_path: str) -> dict:
    """
    Main verification function. Compares extracted company data
    against the local registry to determine authenticity.

    Args:
        company_data : Dict with extracted document fields.
        registry_path: Path to the local registry CSV file.

    Returns:
        {
            "decision"       : "VALID" | "REVIEW" | "INVALID",
            "reasons"        : [list of reason strings],
            "matched_record" : {registry row} or null,
            "risk_score"     : 0-100
        }
    """
    reasons = []
    matched_record = None

    # ── STEP 1: Validate input ──────────────────────────────────
    input_errors = validate_input(company_data)
    if input_errors:
        for err in input_errors:
            reasons.append(err)
        score = compute_risk_score("INVALID", len(input_errors))
        return _build_result("INVALID", reasons, None, score)

    # ── STEP 2: Load registry ───────────────────────────────────
    registry = load_registry(registry_path)

    # ── STEP 3: CIN Lookup (primary key) ───────────────────────
    cin_submitted = str(company_data.get("cin_number", "")).strip().upper()
    matched_record = registry.get(cin_submitted, None)

    if matched_record is None:
        reasons.append(
            f"CIN '{cin_submitted}' not found in the official registry. "
            f"Company may be fictitious, unregistered, or CIN is incorrect."
        )
        score = compute_risk_score("INVALID", 1)
        return _build_result("INVALID", reasons, None, score)

    # CIN found — proceed with field comparisons
    reasons.append(f"CIN '{cin_submitted}' found in registry.")

    # ── STEP 4: Company Name Comparison ────────────────────────
    issues = 0
    name_level, name_detail = compare_names(
        company_data["company_name"],
        matched_record["company_name"]
    )
    reasons.append(name_detail)
    if name_level == "MISMATCH":
        issues += 2
    elif name_level == "FUZZY":
        issues += 1

    # ── STEP 5: Registration Date Comparison ───────────────────
    date_level, date_detail = compare_dates(
        company_data["registration_date"],
        matched_record["registration_date"]
    )
    reasons.append(date_detail)
    if date_level == "MISMATCH":
        issues += 2
    elif date_level == "UNPARSEABLE":
        issues += 1

    # ── STEP 6: Status Check (ACTIVE / INACTIVE) ────────────────
    is_active, status_detail = compare_status(
        company_data.get("status", ""),
        matched_record["status"]
    )
    reasons.append(status_detail)

    if not is_active:
        reasons.append(
            "CRITICAL: Company is not ACTIVE. LC cannot be processed for an "
            "inactive, struck-off, or dissolved entity."
        )
        score = compute_risk_score("INVALID", issues + 2)
        return _build_result("INVALID", reasons, matched_record, score)

    # ── STEP 7: Address Note (advisory only) ──────────────────
    addr_submitted = str(company_data.get("registered_address", "")).strip().lower()
    addr_registry  = matched_record["registered_address"].strip().lower()
    if addr_submitted and addr_registry and addr_submitted != addr_registry:
        reasons.append(
            f"Advisory: Registered address shows minor differences. "
            f"Submitted: '{company_data['registered_address']}' | "
            f"Registry: '{matched_record['registered_address']}'. "
            f"Address discrepancy alone does not fail verification."
        )

    # ── STEP 8: Final Decision ─────────────────────────────────
    if issues == 0:
        decision = "VALID"
        reasons.append(
            "[PASS] All critical fields verified. Company is ACTIVE and identity confirmed."
        )
    else:
        decision = "REVIEW"
        reasons.append(
            f"[WARN] {issues} discrepancy(ies) detected. Manual review by compliance officer required."
        )

    score = compute_risk_score(decision, issues)
    return _build_result(decision, reasons, matched_record, score)


def _build_result(
    decision: str,
    reasons: list,
    matched_record: Optional[dict],
    risk_score: int
) -> dict:
    """Assembles the standardised JSON-serialisable output."""
    return {
        "decision": decision,
        "reasons": reasons,
        "matched_record": matched_record,
        "risk_score": risk_score,
    }



# ─────────────────────────────────────────────────────────────────
#  SECTION 6 — CLI / DEMO RUNNER
# ─────────────────────────────────────────────────────────────────

def run_demo(registry_path: str):
    """Runs all decision scenarios and prints formatted results."""
    separator = "=" * 72

    test_cases = [
        {
            "_label": "CASE 1 -- VALID (Tata Steel -- all fields match)",
            "company_name": "Tata Steel Ltd.",
            "cin_number": "L27100MH1907PLC000260",
            "registration_date": "1907-08-26",
            "registered_address": "Bombay House, 24 Homi Mody Street, Fort, Mumbai, Maharashtra 400001",
            "status": "ACTIVE",
        },
        {
            "_label": "CASE 2 -- REVIEW (Infosys -- name suffix differs, date different format)",
            "company_name": "Infosys Technologies",
            "cin_number": "U74999MH2010PLC123456",
            "registration_date": "15-03-2010",
            "registered_address": "Rajiv Gandhi Infotech Park, Pune",
            "status": "ACTIVE",
        },
        {
            "_label": "CASE 3 -- INVALID (Unknown CIN -- not in registry)",
            "company_name": "Shadow Exports Pvt. Ltd.",
            "cin_number": "U00000XX2023PTC999999",
            "registration_date": "2023-01-01",
            "registered_address": "123 Unknown Street, Delhi 110001",
            "status": "ACTIVE",
        },
        {
            "_label": "CASE 4 -- INVALID (Novus Pharma -- company INACTIVE)",
            "company_name": "Novus Pharma Exports",
            "cin_number": "U85110TG2021OPC445678",
            "registration_date": "2021-04-05",
            "registered_address": "Plot 88, IDA Nacharam, Hyderabad, Telangana 500076",
            "status": "ACTIVE",
        },
        {
            "_label": "CASE 5 -- INVALID (Missing required fields)",
            "company_name": "Some Company",
            "cin_number": "",
            "registration_date": "",
            "registered_address": "Delhi",
            "status": "ACTIVE",
        },
        {
            "_label": "CASE 6 -- REVIEW (BHEL -- registration date mismatch)",
            "company_name": "Bharat Heavy Electricals Ltd.",
            "cin_number": "U72200DL2005PLC987654",
            "registration_date": "2005-09-15",
            "registered_address": "BHEL House, Siri Fort, New Delhi 110049",
            "status": "ACTIVE",
        },
    ]

    for case in test_cases:
        label = case.pop("_label")
        print(f"\n{separator}")
        print(f"  {label}")
        print(separator)
        print("\nINPUT:")
        print(json.dumps(case, indent=4))

        result = verify_company(case, registry_path)

        icons = {"VALID": "[VALID]", "REVIEW": "[REVIEW]", "INVALID": "[INVALID]"}
        icon = icons.get(result["decision"], "[?]")

        print("\nOUTPUT:")
        print(json.dumps(result, indent=4, ensure_ascii=False))
        print(f"\n{icon}  DECISION: {result['decision']}  |  RISK SCORE: {result['risk_score']}/100")


# ─────────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    script_dir = os.path.dirname(os.path.abspath(__file__))
    default_registry = os.path.join(script_dir, "company_registry.csv")

    registry_path = sys.argv[1] if len(sys.argv) > 1 else default_registry

    print("\n" + "=" * 72)
    print("   BARCLAYS BANK - KYC COMPANY AUTHENTICITY VERIFICATION MODULE")
    print("   Trade Finance | Document Verification | UCP 600 Compliant")
    print("=" * 72)
    print(f"\nRegistry: {registry_path}")

    run_demo(registry_path)

    print("\n" + "=" * 72)
    print("   END OF VERIFICATION DEMO")
    print("=" * 72 + "\n")
