import unittest

import mt5_connector


class FakeStruct:
    def __init__(self, **values):
        self._values = values

    def _asdict(self):
        return dict(self._values)


class MT5ConnectorTests(unittest.TestCase):
    def setUp(self):
        self.mt5 = mt5_connector.mt5
        self.originals = {}
        for name in [
            "initialize",
            "login",
            "terminal_info",
            "account_info",
            "symbol_select",
            "symbol_info",
            "symbol_info_tick",
            "order_check",
            "order_send",
            "last_error",
        ]:
            self.originals[name] = getattr(self.mt5, name)

    def tearDown(self):
        for name, value in self.originals.items():
            setattr(self.mt5, name, value)

    def test_terminal_disablement_blocks_trade_before_order_send(self):
        order_check_calls = []
        setattr(self.mt5, "initialize", lambda **_: True)
        setattr(self.mt5, "login", lambda **_: True)
        setattr(self.mt5, "terminal_info", lambda: FakeStruct(
            trade_allowed=False,
            tradeapi_disabled=False,
            connected=True,
            dlls_allowed=True,
            path="C:/MT5/terminal64.exe",
            data_path="C:/MT5/data",
        ))
        setattr(self.mt5, "account_info", lambda: FakeStruct(
            login=123456,
            server="Demo-Server",
            trade_allowed=True,
            trade_expert=True,
        ))
        setattr(self.mt5, "symbol_select", lambda *_: True)
        setattr(self.mt5, "symbol_info", lambda *_: FakeStruct(
            filling_mode=0,
            trade_exemode=getattr(self.mt5, "SYMBOL_TRADE_EXECUTION_INSTANT", 0),
        ))
        setattr(self.mt5, "symbol_info_tick", lambda *_: FakeStruct(ask=1.2, bid=1.1))
        setattr(self.mt5, "order_check", lambda *_: order_check_calls.append("called"))
        setattr(self.mt5, "last_error", lambda: (0, "ok"))

        connector = mt5_connector.MT5Connector(login=123456, password="pw", server="Demo-Server")
        result = connector.open_market("BTCUSDc", "LONG", 0.1)

        self.assertFalse(result["accepted"])
        self.assertEqual(result["failure"]["code"], "TERMINAL_AUTOTRADING_DISABLED")
        self.assertEqual(
            result["failure"]["retcode"],
            getattr(self.mt5, "TRADE_RETCODE_CLIENT_DISABLES_AT", 10027),
        )
        self.assertEqual(order_check_calls, [])

    def test_account_trade_disablement_keeps_account_failure_category(self):
        setattr(self.mt5, "initialize", lambda **_: True)
        setattr(self.mt5, "login", lambda **_: True)
        setattr(self.mt5, "terminal_info", lambda: FakeStruct(
            trade_allowed=True,
            tradeapi_disabled=False,
            connected=True,
            dlls_allowed=True,
            path="C:/MT5/terminal64.exe",
            data_path="C:/MT5/data",
        ))
        setattr(self.mt5, "account_info", lambda: FakeStruct(
            login=123456,
            server="Demo-Server",
            trade_allowed=False,
            trade_expert=True,
        ))
        setattr(self.mt5, "symbol_select", lambda *_: True)
        setattr(self.mt5, "symbol_info", lambda *_: FakeStruct(
            filling_mode=0,
            trade_exemode=getattr(self.mt5, "SYMBOL_TRADE_EXECUTION_INSTANT", 0),
        ))
        setattr(self.mt5, "symbol_info_tick", lambda *_: FakeStruct(ask=1.2, bid=1.1))
        setattr(self.mt5, "last_error", lambda: (0, "ok"))

        connector = mt5_connector.MT5Connector(login=123456, password="pw", server="Demo-Server")
        result = connector.open_market("BTCUSDc", "LONG", 0.1)

        self.assertFalse(result["accepted"])
        self.assertEqual(result["failure"]["code"], "ACCOUNT_TRADE_DISABLED")
        self.assertEqual(result["failure"]["category"], "account")
        self.assertIsNone(result["failure"]["retcode"])

    def test_invalid_fill_preflight_retries_next_supported_filling_mode(self):
        order_check_attempts = []
        order_send_attempts = []
        setattr(self.mt5, "initialize", lambda **_: True)
        setattr(self.mt5, "login", lambda **_: True)
        setattr(self.mt5, "terminal_info", lambda: FakeStruct(
            trade_allowed=True,
            tradeapi_disabled=False,
            connected=True,
            dlls_allowed=True,
            path="C:/MT5/terminal64.exe",
            data_path="C:/MT5/data",
        ))
        setattr(self.mt5, "account_info", lambda: FakeStruct(
            login=123456,
            server="Demo-Server",
            trade_allowed=True,
            trade_expert=True,
        ))
        setattr(self.mt5, "symbol_select", lambda *_: True)
        setattr(self.mt5, "symbol_info", lambda *_: FakeStruct(
            filling_mode=(getattr(self.mt5, "SYMBOL_FILLING_IOC", 0) | getattr(self.mt5, "SYMBOL_FILLING_FOK", 0)),
            trade_exemode=getattr(self.mt5, "SYMBOL_TRADE_EXECUTION_INSTANT", 0),
        ))
        setattr(self.mt5, "symbol_info_tick", lambda *_: FakeStruct(ask=1.2, bid=1.1))

        def fake_order_check(request):
            order_check_attempts.append(request["type_filling"])
            if len(order_check_attempts) == 1:
                return FakeStruct(retcode=10030, comment="Unsupported filling mode")
            return FakeStruct(retcode=0, comment="Done")

        setattr(self.mt5, "order_check", fake_order_check)

        def fake_order_send(request):
            order_send_attempts.append(request["type_filling"])
            return FakeStruct(
                retcode=getattr(self.mt5, "TRADE_RETCODE_DONE", 10009),
                comment="Done",
                deal=111,
                order=222,
                position=333,
            )

        setattr(self.mt5, "order_send", fake_order_send)
        setattr(self.mt5, "last_error", lambda: (0, "ok"))

        connector = mt5_connector.MT5Connector(login=123456, password="pw", server="Demo-Server")
        result = connector.open_market("BTCUSDc", "LONG", 0.1)

        self.assertTrue(result["accepted"])
        self.assertEqual(len(order_check_attempts), 2)
        self.assertEqual(len(order_send_attempts), 1)
        self.assertEqual(result["payload"]["preflight"]["retcode"], 0)
        self.assertEqual(result["payload"]["orderSend"]["retcode"], getattr(self.mt5, "TRADE_RETCODE_DONE", 10009))

    def test_ensure_session_fails_when_terminal_stays_logged_into_wrong_account(self):
        setattr(self.mt5, "initialize", lambda **_: True)
        setattr(self.mt5, "login", lambda **_: True)
        setattr(self.mt5, "account_info", lambda: FakeStruct(
            login=999999,
            server="Wrong-Server",
            trade_allowed=True,
            trade_expert=True,
        ))
        setattr(self.mt5, "last_error", lambda: (0, "ok"))

        connector = mt5_connector.MT5Connector(login=123456, password="pw", server="Demo-Server")

        with self.assertRaisesRegex(
            mt5_connector.MT5ConnectorError,
            "unexpected account after login",
        ):
            connector.ensure_session()


if __name__ == "__main__":
    unittest.main()
