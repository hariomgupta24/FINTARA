"""
swift_generator — Barclays SWIFT MT700 / MT707 Message Generator
=================================================================
Public API:

    from swift_generator import generate_swift_message

    result = generate_swift_message(lc_data)   # returns dict
"""

from .gateway import generate_swift_message

__all__ = ["generate_swift_message"]
