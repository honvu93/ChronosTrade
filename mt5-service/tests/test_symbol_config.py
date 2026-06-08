import unittest

import symbol_config


class SymbolConfigTests(unittest.TestCase):
    def test_canonical_backend_symbol_resolves_to_clean_names(self):
        self.assertEqual(symbol_config.canonical_backend_symbol("XAUUSD"), "XAUUSD")
        self.assertEqual(symbol_config.canonical_backend_symbol("XAUUSDc"), "XAUUSD")
        self.assertEqual(symbol_config.canonical_backend_symbol("XAGUSD"), "XAGUSD")
        self.assertEqual(symbol_config.canonical_backend_symbol("BTCUSDc"), "BTCUSD")

    def test_market_detection_uses_explicit_config(self):
        self.assertTrue(symbol_config.is_crypto_symbol("BTCUSDc"))
        self.assertFalse(symbol_config.is_crypto_symbol("XAUUSDc"))
        self.assertFalse(symbol_config.is_crypto_symbol("XAGUSDc"))


if __name__ == "__main__":
    unittest.main()
