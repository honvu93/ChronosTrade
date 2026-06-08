from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    repo_root = Path(__file__).resolve().parent
    ts_script = repo_root / "src" / "scripts" / "runTier1SignalMatrix.ts"

    if not ts_script.exists():
        print(f"Matrix script not found: {ts_script}", file=sys.stderr)
        return 1

    command = [
        "node",
        "-r",
        "ts-node/register",
        str(ts_script),
        *sys.argv[1:],
    ]

    try:
        completed = subprocess.run(command, cwd=repo_root)
    except FileNotFoundError as error:
        print(
            "Unable to start the Tier 1 matrix runner. Make sure Node.js is installed and available in PATH.",
            file=sys.stderr,
        )
        print(str(error), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130

    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
