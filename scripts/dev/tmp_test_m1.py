
import MetaTrader5 as mt5
import pandas as pd
from datetime import datetime, timedelta
import os
from dotenv import load_dotenv

load_dotenv("mt5-service/.env")

def test_m1_sync():
    if not mt5.initialize():
        print(f"MT5 initialize failed: {mt5.last_error()}")
        return

    login = int(os.environ.get("MT5_LOGIN"))
    password = os.environ.get("MT5_PASSWORD")
    server = os.environ.get("MT5_SERVER")

    if not mt5.login(login, password, server):
        print(f"MT5 login failed: {mt5.last_error()}")
        mt5.shutdown()
        return

    symbol = "BTCUSDc"
    if not mt5.symbol_select(symbol, True):
        print(f"Failed to select symbol {symbol}: {mt5.last_error()}")
        mt5.shutdown()
        return
    
    # Test 1: Recent M1
    end = datetime.now()
    start = end - timedelta(days=1)
    print(f"Testing {symbol} M1 for recent 1 day: {start} to {end}")
    rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, start, end)
    if rates is not None:
        print(f"  Result: {len(rates)} bars")
    else:
        print(f"  Result: None (Error: {mt5.last_error()})")

    # Find earliest M1
    print("\nFinding earliest M1 data...")
    test_dates = [
        datetime(2012, 1, 1),
        datetime(2015, 1, 1),
        datetime(2018, 1, 1),
        datetime(2020, 1, 1),
        datetime(2022, 1, 1),
        datetime(2023, 1, 1),
        datetime(2024, 1, 1),
        datetime(2025, 1, 1),
    ]
    
    for d in test_dates:
        rates = mt5.copy_rates_range(symbol, mt5.TIMEFRAME_M1, d, d + timedelta(days=7))
        if rates is not None and len(rates) > 10:
            print(f"  Data found starting from {d.date()}: {len(rates)} bars")
            break
        else:
            print(f"  No M1 data in {d.date()}")
    
    mt5.shutdown()

if __name__ == "__main__":
    test_m1_sync()
