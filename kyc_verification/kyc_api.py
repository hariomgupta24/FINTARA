"""
================================================================
 Barclays Bank — Trade Finance KYC Module
 REST API Layer
 Module: kyc_api.py
 Author: Barclays Trade Finance Engineering
 Version: 1.0.0
================================================================

Exposes kyc_verifier as a lightweight HTTP API using only
Python's built-in libraries (no pip install required).

Endpoints
---------
  POST /api/kyc/verify   → verify company using local CSV registry
  GET  /api/kyc/health   → health check
"""

import os
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── Import the KYC engine (same directory) ─────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kyc_verifier import verify_company  # type: ignore[import]

# ── Config ─────────────────────────────────────────────────────
SCRIPT_DIR    = os.path.dirname(os.path.abspath(__file__))
REGISTRY_PATH = os.environ.get(
    "KYC_REGISTRY_PATH",
    os.path.join(SCRIPT_DIR, "company_registry.csv")
)
PORT = int(os.environ.get("KYC_PORT", 5001))


# ─────────────────────────────────────────────────────────────────
#  REQUEST HANDLER
# ─────────────────────────────────────────────────────────────────

class KYCHandler(BaseHTTPRequestHandler):

    def _send_json(self, status: int, data: dict):
        """Send a JSON response."""
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        """Read and parse the JSON request body. Returns dict or None."""
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    # ── GET ──────────────────────────────────────────────────────
    def do_GET(self):
        if self.path == "/api/kyc/health":
            self._send_json(200, {
                "status": "ok",
                "service": "Barclays KYC Verification API",
                "registry": REGISTRY_PATH,
                "registry_exists": os.path.isfile(REGISTRY_PATH),
            })
        else:
            self._send_json(404, {"error": f"Route not found: {self.path}"})

    # ── POST ─────────────────────────────────────────────────────
    def do_POST(self):
        if self.path == "/api/kyc/verify":
            data = self._read_json_body()
            if data is None:
                self._send_json(400, {
                    "error": "Invalid or missing JSON body.",
                    "hint": "Set Content-Type: application/json and send a valid JSON object."
                })
                return

            result = verify_company(data, REGISTRY_PATH)
            status = 200 if result["decision"] != "INVALID" else 422
            self._send_json(status, result)

        else:
            self._send_json(404, {"error": f"Route not found: {self.path}"})

    def log_message(self, format, *args):  # noqa: A002
        """Custom compact log format."""
        print(f"[KYC API] {self.address_string()} — {format % args}")


# ─────────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), KYCHandler)
    print(f"\n[KYC API] Running on http://0.0.0.0:{PORT}")
    print(f"[KYC API] Registry : {REGISTRY_PATH}")
    print(f"[KYC API] Endpoints:")
    print(f"           GET  http://localhost:{PORT}/api/kyc/health")
    print(f"           POST http://localhost:{PORT}/api/kyc/verify\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[KYC API] Stopped.")
        server.server_close()
