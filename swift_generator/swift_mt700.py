"""
swift_mt700.py — MT700 / MT707 SWIFT Message Builder
======================================================
Converts normalised (validated) LC data into a fully-structured
SWIFT FIN message body following MT 700 / 707 field specifications.

References
----------
SWIFT SR 2023 — MT 700 Issue of a Documentary Credit
SWIFT SR 2023 — MT 707 Amendment of a Documentary Credit
"""

from __future__ import annotations

import textwrap
from datetime import datetime
from typing import Any, Dict, List, Optional


# ── SWIFT field tag mapping reference ─────────────────────────────────────
FIELD_MAP = {
    ":20:":  "Documentary Credit Number",
    ":27:":  "Sequence of Total",
    ":40A:": "Form of Documentary Credit",
    ":20:":  "Documentary Credit Number",
    ":31C:": "Date of Issue",
    ":31D:": "Date and Place of Expiry",
    ":50:":  "Applicant",
    ":59:":  "Beneficiary",
    ":32B:": "Currency Code, Amount",
    ":39A:": "Percentage Credit Amount Tolerance",
    ":41A:": "Available With…By…",
    ":42C:": "Drafts At…",
    ":42D:": "Drawee",
    ":43P:": "Partial Shipments",
    ":43T:": "Transshipment",
    ":44A:": "Place of Taking in Charge / Dispatch From",
    ":44B:": "Place of Final Destination",
    ":44C:": "Latest Date of Shipment",
    ":44D:": "Shipment Period",
    ":45A:": "Description of Goods and/or Services",
    ":46A:": "Documents Required",
    ":47A:": "Additional Conditions",
    ":71B:": "Charges",
    ":48:":  "Period for Presentation",
    ":49:":  "Confirmation Instructions",
    ":53A:": "Reimbursing Bank",
    ":78:":  "Instructions to Paying/Accepting/Negotiating Bank",
    # MT707 specific
    ":21:":  "Documentary Credit Number (Amendment)",
    ":26E:": "Number of Amendment",
    ":30:":  "Date of Amendment",
    ":79:":  "Narrative — Amendment Details",
}


def _wrap(text: str, width: int = 65) -> str:
    """Wrap text at SWIFT line width (65 chars) preserving newlines."""
    lines = str(text).splitlines()
    wrapped = []
    for line in lines:
        if len(line) <= width:
            wrapped.append(line)
        else:
            wrapped.extend(textwrap.wrap(line, width=width))
    return "\n".join(wrapped)


def _party_block(party: dict, tag: str) -> str:
    """Format an applicant or beneficiary block."""
    lines = [f":{tag}:"]
    if party.get("account"):
        lines.append(f"//{party['account']}")
    lines.append(party.get("name", ""))
    if party.get("address"):
        for addr_line in str(party["address"]).splitlines():
            lines.append(addr_line.strip())
    if party.get("city"):
        city_line = party["city"]
        if party.get("country"):
            city_line += f"/{party['country']}"
        lines.append(city_line)
    return "\n".join(lines)


def _bank_block(bank: Optional[dict], tag: str) -> str:
    """Format a bank party block (BIC or name/address)."""
    if not bank:
        return ""
    if bank.get("bic"):
        return f":{tag}:\nBIC{bank['bic']}"
    lines = [f":{tag}:"]
    lines.append(bank.get("name", ""))
    if bank.get("address"):
        lines.append(str(bank.get("address", "")))
    return "\n".join(lines)


def _format_availability(payment_terms: str, advising_bank: Optional[dict]) -> str:
    """
    Map payment_terms string → SWIFT :41A: field.
    E.g. 'Sight' → 'BY PAYMENT AT SIGHT'
         'Deferred 90 days' → 'BY DEFERRED PAYMENT'
    """
    t = str(payment_terms).lower()
    if "sight" in t:
        method = "BY PAYMENT AT SIGHT"
    elif "acceptance" in t:
        method = "BY ACCEPTANCE"
    elif "negotiation" in t:
        method = "BY NEGOTIATION"
    elif "deferred" in t or "usance" in t or "days" in t:
        method = "BY DEFERRED PAYMENT"
    else:
        method = "BY PAYMENT"

    bank_name = "ANY BANK"
    if advising_bank and advising_bank.get("name"):
        bank_name = advising_bank["name"].upper()

    return f":41A:\nWITH {bank_name}\n{method}"


def _documents_block(docs: List[Any]) -> str:
    """Format :46A: Documents Required block."""
    lines = [":46A:"]
    for i, doc in enumerate(docs, 1):
        line = str(doc).strip()
        if line:
            lines.append(f"+    {i}. {line}")
    return "\n".join(lines)


def _build_header(receiver_bic: str, message_type: str, sender_bic: str) -> str:
    """Build SWIFT header blocks 1-3 (simplified FIN header)."""
    now = datetime.utcnow()
    session_date = now.strftime("%y%m%d")
    session_time = now.strftime("%H%M")
    return (
        f"{{1:F01{sender_bic}XXXX0000000000}}"
        f"{{2:I{message_type}{receiver_bic}XXXXN}}"
        f"{{3:{{108:{session_date}{session_time}}}}}"
    )


def _build_trailer(checksum: str = "NONE") -> str:
    """Build SWIFT trailer block 5."""
    chk = (checksum[:6].upper() if checksum else "000000").ljust(12, "0")
    return "{5:{CHK:" + chk + "}}"


# ── MT 700 body builder ────────────────────────────────────────────────────

def build_mt700(data: dict, sender_bic: str = "BARCGB22") -> str:
    """
    Build a complete MT 700 SWIFT FIN message string.

    Parameters
    ----------
    data : dict
        Validated & normalised LC data (dates already in _swift YYMMDD keys).
    sender_bic : str
        8/11-char BIC of the issuing bank (Barclays default).

    Returns
    -------
    str : Full SWIFT FIN message text.
    """
    adv_bank: dict = data.get("advising_bank") or {}
    receiver_bic = adv_bank.get("bic", "AAAAGB2LXXX")
    ship: dict = data.get("shipment_details") or {}

    # Tolerance
    tol = data.get("tolerance_pct", "")
    tolerance_tag = f":39A:\n{tol}/{tol}" if tol else ""

    # Charges: map human text → SWIFT code
    charges_raw = str(data.get("charges", "")).upper()
    if "BENEFICIARY" in charges_raw:
        charges_code = "OUR"
    elif "APPLICANT" in charges_raw or "SHARED" in charges_raw:
        charges_code = "SHA"
    else:
        charges_code = data.get("charges", "SHA")

    # Confirmation
    conf_raw = str(data.get("confirmation", "without")).upper()
    if "WITH" in conf_raw and "WITHOUT" not in conf_raw:
        confirmation = "CONFIRM"
    elif "MAY ADD" in conf_raw:
        confirmation = "MAY ADD"
    else:
        confirmation = "WITHOUT"

    # Additional conditions
    add_cond = data.get("additional_conditions", "")

    # Period for presentation (days) — default 21
    presentation_days = data.get("presentation_period_days", 21)

    # Reimbursing bank
    reimb_bank = data.get("reimbursing_bank")

    # Instructions to negotiating bank
    instructions = data.get("instructions_to_bank", "")

    # ── Build field lines ──────────────────────────────────────────────────
    fields: List[str] = []

    fields.append(f":27:\n1/1")
    fields.append(f":40A:\nIRREVOCABLE")
    fields.append(f":20:\n{data['lc_number']}")
    fields.append(f":31C:\n{data['issue_date_swift']}")
    fields.append(
        ":31D:\n" + str(data["expiry_date_swift"]) + str(data["expiry_place"]).upper()[:29]
    )

    # Applicant
    fields.append(_party_block(data["applicant"], "50"))

    # Beneficiary
    fields.append(_party_block(data["beneficiary"], "59"))

    # Currency & Amount
    fields.append(f":32B:\n{data['currency']}{data['amount_swift']}")

    if tolerance_tag:
        fields.append(tolerance_tag)

    # Availability
    fields.append(_format_availability(data.get("payment_terms", ""), adv_bank))

    # Drafts at (if usance/acceptance)
    payment_terms_lc = str(data.get("payment_terms", "")).lower()
    if "sight" not in payment_terms_lc and "deferred" not in payment_terms_lc:
        fields.append(f":42C:\n{data.get('payment_terms', '')}")
        if adv_bank:
            fields.append(_bank_block(adv_bank, "42D"))

    # Partial Shipments
    partial = str(ship.get("partial_shipments", "NOT ALLOWED")).upper()
    fields.append(f":43P:\n{partial}")

    # Transshipment
    trans = str(ship.get("transshipment", "NOT ALLOWED")).upper()
    fields.append(f":43T:\n{trans}")

    # Port of Loading → :44A:
    if ship.get("port_of_loading"):
        fields.append(f":44A:\n{ship['port_of_loading'].upper()}")

    # Port of Discharge → :44B:
    if ship.get("port_of_discharge"):
        fields.append(f":44B:\n{ship['port_of_discharge'].upper()}")

    # Latest Shipment Date → :44C: (YYMMDD)
    if ship.get("latest_shipment_date"):
        from .validator import _parse_date  # lazy import
        ok, ls_swift = _parse_date(ship["latest_shipment_date"])
        if ok:
            fields.append(f":44C:\n{ls_swift}")

    # Description of Goods :45A:
    fields.append(f":45A:\n{_wrap(data['goods_description'])}")

    # Documents Required :46A:
    docs = data.get("documents_required", [])
    if docs:
        fields.append(_documents_block(docs))

    # Additional Conditions :47A:
    if add_cond:
        fields.append(f":47A:\n{_wrap(add_cond)}")

    # Period for Presentation :48:
    fields.append(f":48:\n{presentation_days} DAYS AFTER DATE OF SHIPMENT")

    # Confirmation :49:
    fields.append(f":49:\n{confirmation}")

    # Charges :71B:
    fields.append(f":71B:\n{charges_code}")

    # Reimbursing bank :53A:
    if reimb_bank:
        bic = reimb_bank.get("bic") or ""
        fields.append(f":53A:\nBIC{bic}")

    # Instructions to bank :78:
    if instructions:
        fields.append(f":78:\n{_wrap(instructions)}")

    # ── Assemble ──────────────────────────────────────────────────────────
    header = _build_header(receiver_bic, "700", sender_bic)
    body = "\n".join(f"{f}" for f in fields)
    trailer = _build_trailer()

    return f"{header}\n{{4:\n{body}\n-}}\n{trailer}"


# ── MT 707 body builder ────────────────────────────────────────────────────

def build_mt707(data: dict, sender_bic: str = "BARCGB22") -> str:
    """Build a complete MT 707 Amendment SWIFT FIN message string."""
    adv_bank: dict = data.get("advising_bank") or {}
    receiver_bic = adv_bank.get("bic", "AAAAGB2LXXX")

    fields: List[str] = []

    fields.append(f":27:\n1/1")
    fields.append(f":20:\n{data['lc_number']}")
    fields.append(f":21:\n{data['lc_number']}")
    fields.append(f":26E:\n{data.get('amendment_sequence', 1)}")
    fields.append(f":30:\n{data['amendment_date_swift']}")
    fields.append(f":31C:\n{data['issue_date_swift']}")

    # Amendment details narrative :79:
    amendments: list = data.get("amendments", [])
    if isinstance(amendments, str):
        amendments = [amendments]
    narrative = "\n".join(str(a) for a in amendments)
    fields.append(f":79:\n{_wrap(narrative)}")

    # Optional — new expiry date
    if data.get("expiry_date_swift"):
        fields.append(
            ":31D:\n" + str(data["expiry_date_swift"]) + str(data.get("expiry_place", "")).upper()[:29]
        )

    # Optional — new amount
    if data.get("amount_swift") and data.get("currency"):
        fields.append(f":32B:\n{data['currency']}{data['amount_swift']}")

    # Optional — new goods description
    if data.get("goods_description"):
        fields.append(f":45A:\n{_wrap(data['goods_description'])}")

    # Optional — new documents required
    docs = data.get("documents_required", [])
    if docs:
        fields.append(_documents_block(docs))

    # Optional — new additional conditions
    if data.get("additional_conditions"):
        fields.append(f":47A:\n{_wrap(data['additional_conditions'])}")

    header = _build_header(receiver_bic, "707", sender_bic)
    body = "\n".join(f"{f}" for f in fields)
    trailer = _build_trailer()

    return f"{header}\n{{4:\n{body}\n-}}\n{trailer}"
