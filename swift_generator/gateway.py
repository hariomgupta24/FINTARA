"""
gateway.py — SWIFT Gateway Simulation + Authorization Layer
=============================================================
Orchestrates the full pipeline:
  1. Validate input
  2. Choose message type (MT700 vs MT707)
  3. Build SWIFT message text
  4. Store to file (simulated gateway)
  5. Return structured JSON payload — DRAFT_READY status only.

NOTE: Transmission does NOT occur automatically.
      Human authorization is required before sending.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from .validator import validate_lc_data
from .swift_mt700 import build_mt700, build_mt707


# ── Default output directory for stored draft messages ────────────────────
DEFAULT_OUTPUT_DIR = Path(__file__).parent / "outbox"

# ── Issuing bank defaults ─────────────────────────────────────────────────
ISSUING_BANK_BIC = "BARCGB22"
ISSUING_BANK_NAME = "Barclays Bank PLC"


def _ensure_outbox(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _detect_message_type(lc_data: dict) -> str:
    """
    Auto-select MT700 or MT707 based on the 'message_type' flag or
    presence of amendment fields.
    """
    explicit = str(lc_data.get("message_type", "")).upper().strip()
    if "707" in explicit or explicit == "MT707":
        return "MT707"
    if lc_data.get("amendment_sequence") or lc_data.get("amendments"):
        return "MT707"
    return "MT700"


def _derive_receiver_bic(lc_data: dict) -> str:
    """Extract receiver BIC from advising_bank or beneficiary bank."""
    adv = lc_data.get("advising_bank") or {}
    if isinstance(adv, dict) and adv.get("bic"):
        return adv["bic"].strip()
    ben = lc_data.get("beneficiary") or {}
    if isinstance(ben, dict) and ben.get("bank_bic"):
        return ben["bank_bic"].strip()
    return "UNKNOWN"


def _save_draft(
    message_text: str,
    message_type: str,
    lc_number: str,
    output_dir: Path,
) -> str:
    """Save SWIFT draft to outbox; return file path."""
    _ensure_outbox(output_dir)
    safe_num = re.sub(r"[^\w\-]", "_", lc_number)
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{message_type}_{safe_num}_{ts}.txt"
    filepath = output_dir / filename
    filepath.write_text(message_text, encoding="utf-8")
    return str(filepath)


def generate_swift_message(
    lc_data: Dict[str, Any],
    output_dir: str | Path | None = None,
    sender_bic: str = ISSUING_BANK_BIC,
) -> Dict[str, Any]:
    """
    Main entry point.  Validates, generates, stores, and returns the draft
    SWIFT message payload.

    Parameters
    ----------
    lc_data    : dict   — LC fields (see README for schema).
    output_dir : path   — Where to store draft .txt files.
                          Defaults to ./swift_generator/outbox/
    sender_bic : str    — BIC of issuing bank.

    Returns
    -------
    dict with keys:
        message_type, status, swift_message, receiver_bic,
        validation_errors, timestamp, ready_for_transmission,
        draft_file_path, authorization_note
    """
    timestamp = datetime.now(timezone.utc).isoformat()
    out_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR

    # ── 1. Detect message type ────────────────────────────────────────────
    message_type = _detect_message_type(lc_data)

    # ── 2. Validate ───────────────────────────────────────────────────────
    is_valid, errors, normalised = validate_lc_data(lc_data, message_type)

    if not is_valid:
        return {
            "message_type": message_type,
            "status": "ERROR",
            "swift_message": None,
            "receiver_bic": _derive_receiver_bic(lc_data),
            "validation_errors": errors,
            "timestamp": timestamp,
            "ready_for_transmission": False,
            "draft_file_path": None,
            "authorization_note": "Validation failed. Correct errors before re-submission.",
        }

    # ── 3. Build SWIFT message text ───────────────────────────────────────
    try:
        if message_type == "MT707":
            swift_text = build_mt707(normalised, sender_bic=sender_bic)
        else:
            swift_text = build_mt700(normalised, sender_bic=sender_bic)
    except Exception as exc:  # noqa: BLE001
        return {
            "message_type": message_type,
            "status": "ERROR",
            "swift_message": None,
            "receiver_bic": _derive_receiver_bic(lc_data),
            "validation_errors": [f"Message generation error: {exc}"],
            "timestamp": timestamp,
            "ready_for_transmission": False,
            "draft_file_path": None,
            "authorization_note": "Internal generator error.",
        }

    # ── 4. Derive receiver BIC ────────────────────────────────────────────
    receiver_bic = _derive_receiver_bic(normalised)

    # ── 5. Store draft to file ────────────────────────────────────────────
    lc_number = normalised.get("lc_number", "UNKNOWN")
    draft_path = _save_draft(swift_text, message_type, lc_number, out_dir)

    # ── 6. Return DRAFT_READY payload (NO transmission) ──────────────────
    return {
        "message_type": message_type,
        "status": "DRAFT_READY",
        "swift_message": swift_text,
        "receiver_bic": receiver_bic,
        "validation_errors": [],
        "timestamp": timestamp,
        "ready_for_transmission": True,          # ready, but NOT sent
        "draft_file_path": draft_path,
        "authorization_note": (
            "[!] DRAFT_READY -- AWAITING HUMAN AUTHORIZATION. "
            "This message has NOT been transmitted. "
            "A duly authorised officer must review and approve "
            f"'{draft_path}' before initiating SWIFT transmission."
        ),
    }


# ── CLI convenience ───────────────────────────────────────────────────────

def main() -> None:  # pragma: no cover
    """Quick test from the command line using the bundled example."""
    import sys
    examples_dir = Path(__file__).parent / "examples"
    input_file = sys.argv[1] if len(sys.argv) > 1 else str(examples_dir / "mt700_input.json")

    print(f"\n{'='*60}")
    print("  Barclays SWIFT Message Generator")
    print(f"{'='*60}")
    print(f"  Loading input: {input_file}\n")

    with open(input_file, encoding="utf-8") as fh:
        lc_data = json.load(fh)

    result = generate_swift_message(lc_data)

    print(f"  Message Type : {result['message_type']}")
    print(f"  Status       : {result['status']}")
    print(f"  Receiver BIC : {result['receiver_bic']}")
    print(f"  Timestamp    : {result['timestamp']}")

    if result["validation_errors"]:
        print("\n  ❌ Validation Errors:")
        for err in result["validation_errors"]:
            print(f"     • {err}")
    else:
        print(f"\n  ✅ Draft saved → {result['draft_file_path']}")
        print(f"\n  {result['authorization_note']}")
        print(f"\n{'─'*60}\n  SWIFT MESSAGE PREVIEW:\n{'─'*60}")
        print(result["swift_message"])

    print(f"\n{'='*60}\n")


if __name__ == "__main__":
    main()
