"""
run_example.py — Run SWIFT generator against both example inputs
================================================================
Usage:
    cd "BARCLAY AI MODEL"
    python swift_generator/examples/run_example.py
"""

import json
import sys
from pathlib import Path

# Allow running from the project root
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from swift_generator import generate_swift_message


def pretty_result(result: dict) -> None:
    sep = "=" * 60
    print(f"\n{sep}")
    print(f"  Message Type : {result['message_type']}")
    print(f"  Status       : {result['status']}")
    print(f"  Receiver BIC : {result['receiver_bic']}")
    print(f"  Timestamp    : {result['timestamp']}")

    if result["validation_errors"]:
        print("\n  [VALIDATION ERRORS]")
        for err in result["validation_errors"]:
            print(f"     * {err}")
        print(f"\n  ready_for_transmission : {result['ready_for_transmission']}")
    else:
        print(f"\n  [OK] Draft saved -> {result['draft_file_path']}")
        print(f"\n  NOTE: {result['authorization_note']}")
        print(f"\n{'-'*60}")
        print("  SWIFT MESSAGE TEXT:")
        print(f"{'-'*60}")
        print(result["swift_message"])

    print(f"\n{sep}\n")



def run(filepath: str) -> None:
    print(f"\n  Loading: {filepath}")
    with open(filepath, encoding="utf-8") as fh:
        lc_data = json.load(fh)
    result = generate_swift_message(lc_data)
    pretty_result(result)


if __name__ == "__main__":
    examples = Path(__file__).parent

    print("\n" + "=" * 60)
    print("  Barclays SWIFT Message Generator -- Example Runner")
    print("=" * 60)

    print("\n>>  Example 1: MT700 -- New LC Issuance")
    run(str(examples / "mt700_input.json"))

    print("\n>>  Example 2: MT707 -- LC Amendment")
    run(str(examples / "mt707_input.json"))

