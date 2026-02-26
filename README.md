<p align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/7/7b/Barclays_logo.svg" alt="Barclays Logo" width="220"/>
</p>

<h1 align="center">FINTARA</h1>

<p align="center">
  <strong>Barclays Bank — Letter of Credit Digital Processing System</strong><br/>
  End-to-end Straight-Through Processing (STP) for Trade Finance
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v16+-339933?style=flat-square&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=flat-square&logo=express&logoColor=white"/>
  <img src="https://img.shields.io/badge/SQLite-3-003B57?style=flat-square&logo=sqlite&logoColor=white"/>
  <img src="https://img.shields.io/badge/Python-3.8+-3776AB?style=flat-square&logo=python&logoColor=white"/>
  <img src="https://img.shields.io/badge/UCP_600-Compliant-00457C?style=flat-square"/>
  <img src="https://img.shields.io/badge/SWIFT-MT700_/_MT707-FF6200?style=flat-square"/>
</p>

---

## Overview

**FINTARA** is a full-stack trade finance platform that digitises the entire Letter of Credit (LC) lifecycle — from client application through compliance checks, credit assessment, collateral valuation, decision engine processing, SWIFT message generation, and final issuance. Built on a 12-step STP workflow aligned with Barclays LC processing standards.

### Key Capabilities

| Module | Description |
|--------|-------------|
| **AI Chat Interface** | Natural-language banking assistant with LC status queries |
| **Client Portal** | Multi-step LC application with real-time tracking |
| **Officer Dashboard** | Review, approve/reject, annotate, and manage applications |
| **KYC Verification** | Python-based document & company authenticity engine |
| **SWIFT Generator** | MT700/MT707 FIN message builder with draft-only safety |
| **LC Draft Engine** | UCP 600-compliant PDF generation with fee calculator |
| **Decision Engine** | Rule-based credit & collateral assessment with risk scoring |

---

## Architecture

```
FINTARA/
├── server.js              # Express backend — 12-step STP API
├── app.js                 # AI chat interface logic
├── index.html             # Main chat UI
├── loc-client.html/js/css # Client portal (apply, track, upload docs)
├── loc-officer.html/js/css# Officer dashboard (review, approve, notes)
├── lc-generator.js        # UCP 600 LC draft & PDF generator
├── kyc_verification/      # Python KYC module
│   ├── kyc_verifier.py    #   Core verification engine
│   ├── kyc_api.py         #   REST API wrapper
│   └── company_registry.csv#  Trusted registry dataset
├── swift_generator/       # SWIFT message module
│   ├── swift_mt700.py     #   MT700/MT707 message builders
│   ├── validator.py       #   Field validator & normaliser
│   ├── gateway.py         #   Orchestrator + simulated gateway
│   └── examples/          #   Sample inputs & demo runner
├── package.json
├── start.bat              # One-click Windows launcher
└── .gitignore
```

---

## STP Workflow (12 Steps)

| Step | Stage | Description |
|------|-------|-------------|
| 1 | **Application** | Client submits LC details via the portal |
| 2 | **Document Upload** | Supporting trade documents attached |
| 3 | **Initial Review** | Officer reviews completeness |
| 4 | **Credit Assessment** | Credit rating & financial profile evaluation |
| 5 | **Collateral Valuation** | Asset-type haircuts (FD, securities, property, cash) |
| 6 | **Compliance Checks** | KYC, sanctions screening, AML verification |
| 7 | **Risk Scoring** | Deterministic risk score computation |
| 8 | **Fee Calculation** | Tenor-based commission, issuance & amendment fees |
| 9 | **Decision Engine** | Rule-based approve / refer / decline |
| 10 | **LC Draft Generation** | UCP 600-compliant draft with all clauses |
| 11 | **SWIFT MT700 Draft** | FIN message generation (draft only) |
| 12 | **Issuance & Advising** | Final approval and dispatch to advising bank |

---

## Getting Started

### Prerequisites

- **Node.js** v16 or higher — [Download](https://nodejs.org)
- **Python** 3.8+ (for KYC module only)

### Quick Start (Windows)

Double-click **`start.bat`** — it will install dependencies and launch the server automatically.

### Manual Start

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The server starts on **http://localhost:3000**.

### Access Points

| Page | URL |
|------|-----|
| AI Chat Interface | http://localhost:3000/index.html |
| Client Portal | http://localhost:3000/loc-client.html |
| Officer Dashboard | http://localhost:3000/loc-officer.html |

---

## Modules

### AI Chat Interface

A conversational banking assistant that handles queries about account balances, loans, mortgages, investments, savings, and **Letter of Credit status lookups** by reference number.

### Client Portal

- Multi-step LC application form with field validation
- Real-time application status tracking
- Document upload support
- Fee estimates and collateral requirement guidance

### Officer Dashboard

- Application queue with filtering and search
- Detailed review panels for each LC application
- Compliance check controls (KYC, Sanctions, AML)
- Officer notes and audit trail
- Approve / Reject / Send to Advising Bank actions

### KYC Verification Engine

A standalone Python module that verifies company authenticity against a trusted registry:

- **CIN-based lookup** against `company_registry.csv`
- **Fuzzy name matching** with normalised comparisons
- **Date verification** across multiple formats
- **Deterministic risk scoring** (0–100 scale)
- **Three-tier verdict**: `VALID` | `REVIEW` | `INVALID`

```bash
# Run standalone verification
cd kyc_verification
python kyc_verifier.py
```

### SWIFT Message Generator

Generates standards-compliant SWIFT FIN messages:

- **MT700** — Issuance of a Documentary Credit
- **MT707** — Amendment to a Documentary Credit
- Auto-detection of message type based on input fields
- Draft files saved to `swift_generator/outbox/` for human review

> ⚠️ **Safety**: No messages are transmitted — all outputs are drafts requiring manual authorization.

```bash
# Run the demo
python swift_generator/examples/run_example.py
```

### LC Draft & PDF Generator

- UCP 600-compliant clause auto-generation
- Tenor-based fee and commission calculator
- Professional PDF output with Barclays branding
- Supports sight, usance, and deferred payment terms

---

## API Reference

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/applications` | List all LC applications (filterable) |
| `GET` | `/api/applications/:ref` | Get a single application by reference |
| `POST` | `/api/applications` | Submit a new LC application |
| `PATCH` | `/api/applications/:ref` | Update status & officer notes |
| `PATCH` | `/api/compliance/:ref` | Update KYC/Sanctions/AML checks |
| `POST` | `/api/applications/:ref/decision` | Run the decision engine |
| `POST` | `/api/applications/:ref/generate-lc` | Generate LC draft |
| `GET` | `/api/applications/:ref/lc-pdf` | Download LC draft as PDF |
| `POST` | `/api/applications/:ref/generate-mt700` | Generate SWIFT MT700 |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js, Express 4.x |
| **Database** | SQLite 3 (via `better-sqlite3`) |
| **PDF Generation** | PDFKit |
| **KYC Engine** | Python 3.8+ (stdlib only) |
| **SWIFT Module** | Python 3.8+ (stdlib only) |
| **Frontend** | Vanilla HTML, CSS, JavaScript |

---

## Environment Variables

Create a `.env` file in the project root (optional):

```env
PORT=3000
```

---

## License

This project is developed for **Barclays Bank** trade finance operations. All rights reserved.

---

<p align="center">
  <sub>Built with precision for modern trade finance.</sub>
</p>