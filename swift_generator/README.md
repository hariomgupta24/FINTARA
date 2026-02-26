# Barclays SWIFT Message Generator

A pure-Python module that converts approved LC fields into correctly-structured SWIFT FIN messages (MT 700 / MT 707). **Draft generation only — final transmission requires human authorization.**

---

## Directory Layout

```
swift_generator/
├── __init__.py          ← Public API
├── validator.py         ← Field validator & normaliser
├── swift_mt700.py       ← MT700 / MT707 message builders
├── gateway.py           ← Orchestrator + simulated gateway
├── outbox/              ← Auto-created; stores draft .txt files
└── examples/
    ├── mt700_input.json ← Sample MT700 (new LC)
    ├── mt707_input.json ← Sample MT707 (amendment)
    └── run_example.py   ← Runnable demo
```

---

## Requirements

**Python 3.8+** · No external packages required (stdlib only).

---

## Run Locally

```bash
# From the project root ("BARCLAY AI MODEL")

# Run the built-in demo (MT700 + MT707)
python swift_generator/examples/run_example.py

# Run against your own JSON file
python swift_generator/gateway.py path/to/your_lc.json
```

---

## Programmatic Usage

```python
import json
from swift_generator import generate_swift_message

with open("swift_generator/examples/mt700_input.json") as f:
    lc_data = json.load(f)

result = generate_swift_message(lc_data)

print(result["status"])          # "DRAFT_READY" or "ERROR"
print(result["message_type"])    # "MT700" or "MT707"
print(result["swift_message"])   # Full SWIFT FIN text
print(result["draft_file_path"]) # Path to saved .txt file
print(result["authorization_note"])
```

---

## LC Field → SWIFT Tag Mapping Table

| LC Input Field            | SWIFT Tag | Description                       |
|---------------------------|-----------|-----------------------------------|
| `lc_number`               | `:20:`    | Documentary Credit Number         |
| `issue_date`              | `:31C:`   | Date of Issue (YYMMDD)            |
| `expiry_date` + `expiry_place` | `:31D:` | Expiry Date and Place          |
| `applicant`               | `:50:`    | Applicant                         |
| `beneficiary`             | `:59:`    | Beneficiary                       |
| `currency` + `amount`     | `:32B:`   | Currency Code, Amount             |
| `tolerance_pct`           | `:39A:`   | Amount Tolerance (%)              |
| `payment_terms` + `advising_bank` | `:41A:` | Available With…By…        |
| `payment_terms`           | `:42C:`   | Drafts At (usance/acceptance)     |
| `advising_bank`           | `:42D:`   | Drawee                            |
| `shipment_details.partial_shipments` | `:43P:` | Partial Shipments        |
| `shipment_details.transshipment`     | `:43T:` | Transshipment            |
| `shipment_details.port_of_loading`   | `:44A:` | Port of Loading          |
| `shipment_details.port_of_discharge` | `:44B:` | Port of Discharge        |
| `shipment_details.latest_shipment_date` | `:44C:` | Latest Shipment Date |
| `goods_description`       | `:45A:`   | Description of Goods & Services   |
| `documents_required`      | `:46A:`   | Documents Required                |
| `additional_conditions`   | `:47A:`   | Additional Conditions             |
| `presentation_period_days`| `:48:`    | Period for Presentation           |
| `confirmation`            | `:49:`    | Confirmation Instructions         |
| `charges`                 | `:71B:`   | Charges                           |
| `reimbursing_bank`        | `:53A:`   | Reimbursing Bank                  |
| `instructions_to_bank`    | `:78:`    | Instructions to Paying Bank       |
| **MT707 specific:**       |           |                                   |
| `lc_number` (ref)         | `:21:`    | Documentary Credit Ref (amendment)|
| `amendment_sequence`      | `:26E:`   | Amendment Number                  |
| `amendment_date`          | `:30:`    | Date of Amendment (YYMMDD)        |
| `amendments` (list)       | `:79:`    | Amendment Narrative               |

---

## Output JSON Schema

```json
{
  "message_type": "MT700 | MT707",
  "status": "DRAFT_READY | ERROR",
  "swift_message": "Full SWIFT FIN text string",
  "receiver_bic": "DEUTDEDBHAM",
  "validation_errors": [],
  "timestamp": "2025-02-24T11:00:00+00:00",
  "ready_for_transmission": true,
  "draft_file_path": "swift_generator/outbox/MT700_BRC_TF_LC_2025_001_20250224_110000.txt",
  "authorization_note": "⚠️  DRAFT_READY — AWAITING HUMAN AUTHORIZATION..."
}
```

If validation fails, `status = "ERROR"`, `ready_for_transmission = false`, and `validation_errors` lists all issues.

---

## Message Type Auto-Selection

| Condition                                      | Type selected |
|------------------------------------------------|---------------|
| `message_type: "MT707"` in input              | MT707         |
| `amendment_sequence` or `amendments` present  | MT707         |
| Otherwise                                      | MT700         |

---

## Authorization & Security Note

> **Automation stops before transmission.**
>
> The module generates and saves a draft `.txt` file to the `outbox/` folder and returns a `DRAFT_READY` status. **No message is sent to SWIFT.** A duly authorised Trade Finance Officer must:
>
> 1. Review the draft in `outbox/`
> 2. Approve the message contents
> 3. Manually submit the file through the bank's SWIFT gateway

---

## Sample SWIFT Output (MT700 excerpt)

```
{1:F01BARCGB22XXXX0000000000}{2:I700DEUTDEDBHAMXXXXN}{3:{108:250224XXXX}}
{4:
:27:
1/1
:40A:
IRREVOCABLE
:20:
BRC/TF/LC/2025/001
:31C:
250224
:31D:
250824LONDON
:50:
//10294857361
Sunrise Exports Pvt Ltd
42 Marine Lines, Fort
Mumbai/IN
:59:
//DE89370400440532013000
Global Trading GmbH
Hauptstrasse 88
Hamburg/DE
:32B:
USD750000,00
:41A:
WITH DEUTSCHE BANK AG
BY PAYMENT AT SIGHT
:43P:
NOT ALLOWED
:43T:
NOT ALLOWED
:44A:
NHAVA SHEVA, INDIA
:44B:
HAMBURG, GERMANY
:44C:
250715
:45A:
5000 MT of Basmati Rice (Grade A), Long Grain...
:46A:
+    1. Commercial Invoice in triplicate...
...
:71B:
OUR
:49:
WITHOUT
-}
{5:{CHK:000000000000}}
```
