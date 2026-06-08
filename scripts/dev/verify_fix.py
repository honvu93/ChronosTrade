
from datetime import datetime, timedelta
import os
import sys

# Import functions from the modified script
sys.path.append(os.path.join(os.getcwd(), "mt5-service"))
from sync_mt5_assets import is_weekend, trading_days_in_range, estimate_bars

def verify():
    btc = "BTCUSDc"
    gold = "XAUUSD"
    
    # Test Saturday (2026-03-07)
    sat = datetime(2026, 3, 7)
    print(f"Is {sat} ({sat.strftime('%A')}) weekend for Gold? {is_weekend(sat, gold)}")
    print(f"Is {sat} ({sat.strftime('%A')}) weekend for BTC? {is_weekend(sat, btc)}")
    
    # Test range: Sat to Sun (1 day)
    d_from = datetime(2026, 3, 7)
    d_to = datetime(2026, 3, 8)
    print(f"\nTrading days in range {d_from.date()} -> {d_to.date()}:")
    print(f"  Gold: {trading_days_in_range(d_from, d_to, gold)}")
    print(f"  BTC: {trading_days_in_range(d_from, d_to, btc)}")
    
    # Test estimation for M1
    print(f"\nEstimate M1 bars for 1 day:")
    print(f"  Gold: {estimate_bars(d_from, d_to, 'M1', gold)}")
    print(f"  BTC: {estimate_bars(d_from, d_to, 'M1', btc)}")

if __name__ == "__main__":
    verify()
