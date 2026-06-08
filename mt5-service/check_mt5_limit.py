import MetaTrader5 as mt5

def main():
    if not mt5.initialize():
        print("initialize() failed, error code =", mt5.last_error())
        return

    term_info = mt5.terminal_info()
    if term_info is not None:
        print(f"Max bars parameter in MT5 Terminal: {term_info.maxbars}")
    else:
        print("Could not get terminal info")

    # Let's try 99,999 bars to see if it works
    symbols = ["XAUUSDc", "XAGUSDc", "BTCUSDc"]
    for s in symbols:
        mt5.symbol_select(s, True)
        for tf, name in [(mt5.TIMEFRAME_M1, "1m"), (mt5.TIMEFRAME_M5, "5m")]:
            r = mt5.copy_rates_from_pos(s, tf, 0, term_info.maxbars)
            if r is not None:
                print(f"{s} {name}: successfully retrieved {len(r)} bars")
            else:
                print(f"{s} {name}: error {mt5.last_error()}")
                
    mt5.shutdown()

if __name__ == "__main__":
    main()
