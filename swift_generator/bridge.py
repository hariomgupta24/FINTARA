"""
bridge.py — Node.js to Python SWIFT Generator Bridge
======================================================
Expects a JSON string of LC Data via stdin or argument 1.
Calls the SWIFT Generator Gateway.
Prints the pure JSON result to stdout.
"""
import sys
import json
from pathlib import Path

# Add project root to sys.path so we can import swift_generator
sys.path.insert(0, str(Path(__file__).parent.parent))

from swift_generator.gateway import generate_swift_message

def main():
    try:
        # Read JSON from argument 1, or fallback to stdin
        if len(sys.argv) > 1:
            input_data = sys.argv[1]
        else:
            input_data = sys.stdin.read()

        if not input_data.strip():
            print(json.dumps({"status": "ERROR", "validation_errors": ["No input provided to bridge.py"]}))
            return

        lc_data = json.loads(input_data)
        
        # Call the generator
        result = generate_swift_message(lc_data)
        
        # Ensure pure JSON output
        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({
            "status": "ERROR",
            "validation_errors": [f"Python Bridge Error: {str(e)}"]
        }))

if __name__ == "__main__":
    main()
