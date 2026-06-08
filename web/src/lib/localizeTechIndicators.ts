import type {
    TechIndicatorConditionDef,
    TechIndicatorDefinition,
    TechIndicatorFieldSchema,
} from "@/types/signals";
import { AppLocale } from "./appLocale";

interface LocalizedText {
    en: string;
    vi: string;
}

interface FieldTranslation {
    label: LocalizedText;
}

interface ConditionTranslation {
    name: LocalizedText;
    description: LocalizedText;
    paramSchema?: Record<string, FieldTranslation>;
}

interface IndicatorTranslation {
    name: LocalizedText;
    description: LocalizedText;
    paramSchema?: Record<string, FieldTranslation>;
    conditions?: Record<string, ConditionTranslation>;
}

const indicatorTranslations: Record<string, IndicatorTranslation> = {
    RSI: {
        name: { en: "Relative Strength Index (RSI)", vi: "Chỉ số sức mạnh tương đối (RSI)" },
        description: {
            en: "Measures the speed and magnitude of price changes. Commonly used to identify overbought (>70) and oversold (<30) zones.",
            vi: "Đo tốc độ và biên độ thay đổi giá. Thường dùng để nhận biết vùng quá mua (>70) và quá bán (<30).",
        },
        paramSchema: {
            period: { label: { en: "RSI Period", vi: "Chu kỳ RSI" } },
        },
        conditions: {
            value_above: {
                name: { en: "Value above threshold", vi: "Giá trị vượt ngưỡng" },
                description: { en: "RSI is above the configured threshold.", vi: "RSI đang cao hơn ngưỡng đã cấu hình." },
                paramSchema: { threshold: { label: { en: "Threshold", vi: "Ngưỡng" } } },
            },
            value_below: {
                name: { en: "Value below threshold", vi: "Giá trị dưới ngưỡng" },
                description: { en: "RSI is below the configured threshold.", vi: "RSI đang thấp hơn ngưỡng đã cấu hình." },
                paramSchema: { threshold: { label: { en: "Threshold", vi: "Ngưỡng" } } },
            },
            crosses_above: {
                name: { en: "Crosses above threshold", vi: "Cắt lên trên ngưỡng" },
                description: {
                    en: "RSI crosses above the threshold from below (previous bar < threshold, current bar > threshold).",
                    vi: "RSI cắt lên trên ngưỡng từ phía dưới (nến trước < ngưỡng, nến hiện tại > ngưỡng).",
                },
                paramSchema: { threshold: { label: { en: "Threshold", vi: "Ngưỡng" } } },
            },
            crosses_below: {
                name: { en: "Crosses below threshold", vi: "Cắt xuống dưới ngưỡng" },
                description: {
                    en: "RSI crosses below the threshold from above (previous bar > threshold, current bar < threshold).",
                    vi: "RSI cắt xuống dưới ngưỡng từ phía trên (nến trước > ngưỡng, nến hiện tại < ngưỡng).",
                },
                paramSchema: { threshold: { label: { en: "Threshold", vi: "Ngưỡng" } } },
            },
            divergence_bullish: {
                name: { en: "Bullish divergence", vi: "Phân kỳ tăng" },
                description: {
                    en: "Price forms a lower low over the last N bars while RSI forms a higher low, suggesting bullish reversal.",
                    vi: "Giá tạo đáy thấp hơn trong N nến gần nhất trong khi RSI tạo đáy cao hơn, gợi ý đảo chiều tăng.",
                },
                paramSchema: { lookback: { label: { en: "Lookback (bars)", vi: "Khoảng nhìn lại (nến)" } } },
            },
            divergence_bearish: {
                name: { en: "Bearish divergence", vi: "Phân kỳ giảm" },
                description: {
                    en: "Price forms a higher high over the last N bars while RSI forms a lower high, suggesting bearish reversal.",
                    vi: "Giá tạo đỉnh cao hơn trong N nến gần nhất trong khi RSI tạo đỉnh thấp hơn, gợi ý đảo chiều giảm.",
                },
                paramSchema: { lookback: { label: { en: "Lookback (bars)", vi: "Khoảng nhìn lại (nến)" } } },
            },
            crosses_above_ema: {
                name: { en: "Crosses above RSI EMA", vi: "Cắt lên trên EMA của RSI" },
                description: {
                    en: "RSI crosses above its own EMA line (default period 9).",
                    vi: "RSI cắt lên trên đường EMA của chính nó (mặc định chu kỳ 9).",
                },
                paramSchema: { emaPeriod: { label: { en: "EMA Period", vi: "Chu kỳ EMA" } } },
            },
        },
    },
    EMA_CROSS: {
        name: { en: "EMA Crossover", vi: "Giao cắt EMA" },
        description: {
            en: "Tracks the crossover between fast and slow EMA lines. Golden Cross and Death Cross are common trend-transition signals.",
            vi: "Theo dõi giao cắt giữa EMA nhanh và EMA chậm. Golden Cross và Death Cross là các tín hiệu chuyển xu hướng phổ biến.",
        },
        paramSchema: {
            fastPeriod: { label: { en: "Fast EMA Period", vi: "Chu kỳ EMA nhanh" } },
            slowPeriod: { label: { en: "Slow EMA Period", vi: "Chu kỳ EMA chậm" } },
        },
        conditions: {
            price_above_ema: {
                name: { en: "Price above fast EMA", vi: "Giá trên EMA nhanh" },
                description: {
                    en: "Close is above the fast EMA (fastPeriod), confirming bullish direction.",
                    vi: "Giá đóng cửa nằm trên EMA nhanh (fastPeriod), xác nhận hướng tăng.",
                },
            },
            price_below_ema: {
                name: { en: "Price below fast EMA", vi: "Giá dưới EMA nhanh" },
                description: {
                    en: "Close is below the fast EMA (fastPeriod), confirming bearish direction.",
                    vi: "Giá đóng cửa nằm dưới EMA nhanh (fastPeriod), xác nhận hướng giảm.",
                },
            },
            fast_crosses_above: {
                name: { en: "Golden Cross (Fast crosses above Slow)", vi: "Golden Cross (EMA nhanh cắt lên EMA chậm)" },
                description: {
                    en: "Fast EMA crosses above Slow EMA, signaling a potential bullish trend transition.",
                    vi: "EMA nhanh cắt lên trên EMA chậm, báo hiệu khả năng chuyển sang xu hướng tăng.",
                },
            },
            fast_crosses_below: {
                name: { en: "Death Cross (Fast crosses below Slow)", vi: "Death Cross (EMA nhanh cắt xuống EMA chậm)" },
                description: {
                    en: "Fast EMA crosses below Slow EMA, signaling a potential bearish trend transition.",
                    vi: "EMA nhanh cắt xuống dưới EMA chậm, báo hiệu khả năng chuyển sang xu hướng giảm.",
                },
            },
        },
    },
    MARKET_REGIME: {
        name: { en: "Market Regime Detector", vi: "Bộ nhận diện trạng thái thị trường" },
        description: {
            en: "Classifies market regime using ADX (trend strength), ATR (volatility), and EMA (direction).",
            vi: "Phân loại trạng thái thị trường bằng ADX (độ mạnh xu hướng), ATR (biến động) và EMA (hướng đi).",
        },
        paramSchema: {
            adxPeriod: { label: { en: "ADX Period", vi: "Chu kỳ ADX" } },
            atrPeriod: { label: { en: "ATR Period", vi: "Chu kỳ ATR" } },
            emaFilterPeriod: { label: { en: "EMA Filter Period", vi: "Chu kỳ EMA lọc" } },
        },
        conditions: {
            regime_trending_bullish: {
                name: { en: "Trending (Bullish)", vi: "Đang có xu hướng (tăng)" },
                description: { en: "ADX > 25 and price > EMA 200", vi: "ADX > 25 và giá > EMA 200" },
                paramSchema: { adxThreshold: { label: { en: "ADX Threshold", vi: "Ngưỡng ADX" } } },
            },
            regime_trending_bearish: {
                name: { en: "Trending (Bearish)", vi: "Đang có xu hướng (giảm)" },
                description: { en: "ADX > 25 and price < EMA 200", vi: "ADX > 25 và giá < EMA 200" },
                paramSchema: { adxThreshold: { label: { en: "ADX Threshold", vi: "Ngưỡng ADX" } } },
            },
            regime_ranging_chop: {
                name: { en: "Ranging / Chop", vi: "Đi ngang / nhiễu" },
                description: { en: "ADX < 20. The market has no clear directional trend.", vi: "ADX < 20. Thị trường chưa có xu hướng rõ ràng." },
                paramSchema: { adxThreshold: { label: { en: "ADX Threshold", vi: "Ngưỡng ADX" } } },
            },
            regime_high_volatility: {
                name: { en: "High volatility", vi: "Biến động cao" },
                description: {
                    en: "Current ATR is greater than 1.5x the average ATR of the prior 50 bars.",
                    vi: "ATR hiện tại lớn hơn 1,5 lần ATR trung bình của 50 nến trước.",
                },
                paramSchema: { multiplier: { label: { en: "Multiplier", vi: "Hệ số" } } },
            },
        },
    },
    FIBONACCI: {
        name: { en: "Fibonacci Retracement", vi: "Thoái lui Fibonacci" },
        description: {
            en: "Analyzes Fibonacci support and resistance levels (23.6%, 38.2%, 50%, 61.8%, 78.6%) based on the latest swing high/low pair.",
            vi: "Phân tích các mức hỗ trợ và kháng cự Fibonacci (23,6%, 38,2%, 50%, 61,8%, 78,6%) dựa trên cặp swing high/low gần nhất.",
        },
        paramSchema: {
            swingStrength: { label: { en: "Swing Strength", vi: "Độ mạnh swing" } },
            lookback: { label: { en: "Swing Lookback (bars)", vi: "Khoảng nhìn lại swing (nến)" } },
            tolerance: { label: { en: "Touch Tolerance (%)", vi: "Sai số chạm (%)" } },
        },
        conditions: {
            price_touch_236: {
                name: { en: "Price touches Fib 23.6%", vi: "Giá chạm Fib 23,6%" },
                description: { en: "Price (high/low) touches the 23.6% retracement level of the latest swing.", vi: "Giá (đỉnh/đáy) chạm mức thoái lui 23,6% của swing gần nhất." },
            },
            price_touch_382: {
                name: { en: "Price touches Fib 38.2%", vi: "Giá chạm Fib 38,2%" },
                description: { en: "Price (high/low) touches the 38.2% retracement level of the latest swing.", vi: "Giá (đỉnh/đáy) chạm mức thoái lui 38,2% của swing gần nhất." },
            },
            price_touch_500: {
                name: { en: "Price touches Fib 50.0%", vi: "Giá chạm Fib 50,0%" },
                description: { en: "Price (high/low) touches the 50.0% retracement level of the latest swing.", vi: "Giá (đỉnh/đáy) chạm mức thoái lui 50,0% của swing gần nhất." },
            },
            price_touch_618: {
                name: { en: "Price touches Fib 61.8%", vi: "Giá chạm Fib 61,8%" },
                description: { en: "Price (high/low) touches the 61.8% retracement level, the primary Golden Ratio level.", vi: "Giá (đỉnh/đáy) chạm mức thoái lui 61,8%, là mức Golden Ratio chính." },
            },
            price_touch_786: {
                name: { en: "Price touches Fib 78.6%", vi: "Giá chạm Fib 78,6%" },
                description: { en: "Price (high/low) touches the 78.6% retracement level of the latest swing.", vi: "Giá (đỉnh/đáy) chạm mức thoái lui 78,6% của swing gần nhất." },
            },
            price_in_golden_zone: {
                name: { en: "Price in Golden Zone (61.8%-78.6%)", vi: "Giá trong Golden Zone (61,8%-78,6%)" },
                description: { en: "Price is trading inside the Fibonacci Golden Zone between 61.8% and 78.6%.", vi: "Giá đang giao dịch trong vùng Fibonacci Golden Zone giữa 61,8% và 78,6%." },
            },
            bounce_from_618: {
                name: { en: "Bounce from 61.8%", vi: "Bật lên từ 61,8%" },
                description: { en: "Price touches 61.8% and closes in reversal direction, signaling a strong bounce setup.", vi: "Giá chạm 61,8% và đóng cửa theo hướng đảo chiều, báo hiệu một cú bật mạnh." },
            },
        },
    },
    ELLIOTT_WAVE: {
        name: { en: "Elliott Wave (LuxAlgo)", vi: "Sóng Elliott (LuxAlgo)" },
        description: {
            en: "Automatically detects Elliott motive (12345) and corrective (ABC) waves using a ZigZag-based algorithm.",
            vi: "Tự động phát hiện sóng Elliott motive (12345) và corrective (ABC) bằng thuật toán dựa trên ZigZag.",
        },
        paramSchema: {
            pivotLength: { label: { en: "Pivot Length", vi: "Độ dài pivot" } },
        },
        conditions: {
            motive_bullish: {
                name: { en: "Motive Bullish (12345)", vi: "Motive tăng (12345)" },
                description: { en: "Signals completion of a bullish 1-2-3-4-5 motive wave.", vi: "Báo hiệu hoàn tất một sóng motive tăng 1-2-3-4-5." },
            },
            motive_bearish: {
                name: { en: "Motive Bearish (12345)", vi: "Motive giảm (12345)" },
                description: { en: "Signals completion of a bearish 1-2-3-4-5 motive wave.", vi: "Báo hiệu hoàn tất một sóng motive giảm 1-2-3-4-5." },
            },
            corrective_bullish: {
                name: { en: "Corrective Bullish (ABC)", vi: "Corrective tăng (ABC)" },
                description: { en: "Signals completion of an ABC corrective wave after a bullish trend.", vi: "Báo hiệu hoàn tất một sóng corrective ABC sau xu hướng tăng." },
            },
            corrective_bearish: {
                name: { en: "Corrective Bearish (ABC)", vi: "Corrective giảm (ABC)" },
                description: { en: "Signals completion of an ABC corrective wave after a bearish trend.", vi: "Báo hiệu hoàn tất một sóng corrective ABC sau xu hướng giảm." },
            },
        },
    },
    SESSION_FILTER: {
        name: { en: "Session Filter", vi: "Bộ lọc phiên giao dịch" },
        description: { en: "Filters signals by trading session window (UTC).", vi: "Lọc tín hiệu theo khung giờ phiên giao dịch (UTC)." },
        paramSchema: {
            startHour: { label: { en: "Start Hour (UTC)", vi: "Giờ bắt đầu (UTC)" } },
            endHour: { label: { en: "End Hour (UTC)", vi: "Giờ kết thúc (UTC)" } },
        },
        conditions: {
            in_session: {
                name: { en: "Within session window", vi: "Nằm trong khung phiên" },
                description: { en: "Checks whether the current bar falls inside the configured UTC session window.", vi: "Kiểm tra xem nến hiện tại có nằm trong khung giờ UTC đã cấu hình hay không." },
            },
        },
    },
    PD_LEVELS: {
        name: { en: "Previous Period Levels", vi: "Muc gia cua ky truoc" },
        description: {
            en: "Tracks previous UTC day and week highs, lows, and midpoints for breakout, reclaim, and sweep-reclaim logic.",
            vi: "Theo doi dinh, day va midpoint cua ngay va tuan UTC truoc do cho logic breakout, reclaim va sweep-reclaim.",
        },
        conditions: {
            touches_previous_day_high: {
                name: { en: "Price touches previous day high", vi: "Gia cham dinh ngay truoc" },
                description: {
                    en: "Current bar overlaps the previous completed UTC day high.",
                    vi: "Nen hien tai chong len muc dinh cua ngay UTC da hoan tat truoc do.",
                },
            },
            touches_previous_day_low: {
                name: { en: "Price touches previous day low", vi: "Gia cham day ngay truoc" },
                description: {
                    en: "Current bar overlaps the previous completed UTC day low.",
                    vi: "Nen hien tai chong len muc day cua ngay UTC da hoan tat truoc do.",
                },
            },
            closes_above_previous_day_high: {
                name: { en: "Close above previous day high", vi: "Dong cua tren dinh ngay truoc" },
                description: {
                    en: "Current close finishes above the previous completed UTC day high.",
                    vi: "Gia dong cua hien tai nam tren muc dinh cua ngay UTC da hoan tat truoc do.",
                },
            },
            closes_below_previous_day_low: {
                name: { en: "Close below previous day low", vi: "Dong cua duoi day ngay truoc" },
                description: {
                    en: "Current close finishes below the previous completed UTC day low.",
                    vi: "Gia dong cua hien tai nam duoi muc day cua ngay UTC da hoan tat truoc do.",
                },
            },
            closes_above_previous_day_midpoint: {
                name: { en: "Close above previous day midpoint", vi: "Dong cua tren midpoint ngay truoc" },
                description: {
                    en: "Current close finishes above the midpoint of the previous completed UTC day range.",
                    vi: "Gia dong cua hien tai nam tren midpoint cua bien do ngay UTC da hoan tat truoc do.",
                },
            },
            closes_below_previous_day_midpoint: {
                name: { en: "Close below previous day midpoint", vi: "Dong cua duoi midpoint ngay truoc" },
                description: {
                    en: "Current close finishes below the midpoint of the previous completed UTC day range.",
                    vi: "Gia dong cua hien tai nam duoi midpoint cua bien do ngay UTC da hoan tat truoc do.",
                },
            },
            bullish_reclaim_previous_day_low: {
                name: { en: "Bullish reclaim of previous day low", vi: "Bullish reclaim day ngay truoc" },
                description: {
                    en: "Previous close was below the previous day low and the current close reclaims back above it.",
                    vi: "Nen truoc dong duoi day ngay truoc va nen hien tai dong tro lai phia tren muc do.",
                },
            },
            bearish_reclaim_previous_day_high: {
                name: { en: "Bearish reclaim of previous day high", vi: "Bearish reclaim dinh ngay truoc" },
                description: {
                    en: "Previous close was above the previous day high and the current close reclaims back below it.",
                    vi: "Nen truoc dong tren dinh ngay truoc va nen hien tai dong tro lai phia duoi muc do.",
                },
            },
            bullish_sweep_reclaim_previous_day_low: {
                name: { en: "Bullish sweep and reclaim of previous day low", vi: "Bullish sweep-reclaim day ngay truoc" },
                description: {
                    en: "Current bar sweeps below the previous day low and closes back above it.",
                    vi: "Nen hien tai quet xuong duoi day ngay truoc roi dong cua tro lai phia tren muc do.",
                },
            },
            bearish_sweep_reclaim_previous_day_high: {
                name: { en: "Bearish sweep and reclaim of previous day high", vi: "Bearish sweep-reclaim dinh ngay truoc" },
                description: {
                    en: "Current bar sweeps above the previous day high and closes back below it.",
                    vi: "Nen hien tai quet len tren dinh ngay truoc roi dong cua tro lai phia duoi muc do.",
                },
            },
            touches_previous_week_high: {
                name: { en: "Price touches previous week high", vi: "Gia cham dinh tuan truoc" },
                description: {
                    en: "Current bar overlaps the previous completed UTC week high.",
                    vi: "Nen hien tai chong len muc dinh cua tuan UTC da hoan tat truoc do.",
                },
            },
            touches_previous_week_low: {
                name: { en: "Price touches previous week low", vi: "Gia cham day tuan truoc" },
                description: {
                    en: "Current bar overlaps the previous completed UTC week low.",
                    vi: "Nen hien tai chong len muc day cua tuan UTC da hoan tat truoc do.",
                },
            },
            closes_above_previous_week_high: {
                name: { en: "Close above previous week high", vi: "Dong cua tren dinh tuan truoc" },
                description: {
                    en: "Current close finishes above the previous completed UTC week high.",
                    vi: "Gia dong cua hien tai nam tren muc dinh cua tuan UTC da hoan tat truoc do.",
                },
            },
            closes_below_previous_week_low: {
                name: { en: "Close below previous week low", vi: "Dong cua duoi day tuan truoc" },
                description: {
                    en: "Current close finishes below the previous completed UTC week low.",
                    vi: "Gia dong cua hien tai nam duoi muc day cua tuan UTC da hoan tat truoc do.",
                },
            },
        },
    },
    SMC: {
        name: { en: "Smart Money Concepts (SMC)", vi: "Smart Money Concepts (SMC)" },
        description: {
            en: "Tracks order blocks, structure breaks, change-of-character signals, and fair value gaps from swing structure.",
            vi: "Theo dõi order block, break of structure, change of character và fair value gap từ cấu trúc swing.",
        },
        paramSchema: {
            swingStrength: { label: { en: "Swing Strength", vi: "Độ mạnh swing" } },
            lookback: { label: { en: "OB Lookback (bars)", vi: "Khoảng nhìn lại OB (nến)" } },
        },
        conditions: {
            bullish_ob_formed: {
                name: { en: "Bullish OB just formed", vi: "Bullish OB vừa hình thành" },
                description: { en: "A bullish Order Block is confirmed on this bar (the last bearish candle before the bullish impulse).", vi: "Một Order Block tăng được xác nhận trên nến này (nến giảm cuối cùng trước cú đẩy tăng)." },
            },
            bearish_ob_formed: {
                name: { en: "Bearish OB just formed", vi: "Bearish OB vừa hình thành" },
                description: { en: "A bearish Order Block is confirmed on this bar (the last bullish candle before the bearish impulse).", vi: "Một Order Block giảm được xác nhận trên nến này (nến tăng cuối cùng trước cú đẩy giảm)." },
            },
            price_in_bullish_ob: {
                name: { en: "Price inside Bullish OB", vi: "Giá nằm trong Bullish OB" },
                description: { en: "Current price is touching or trading inside an active Bullish Order Block zone.", vi: "Giá hiện tại đang chạm hoặc giao dịch trong vùng Bullish Order Block đang hoạt động." },
            },
            price_in_bearish_ob: {
                name: { en: "Price inside Bearish OB", vi: "Giá nằm trong Bearish OB" },
                description: { en: "Current price is touching or trading inside an active Bearish Order Block zone.", vi: "Giá hiện tại đang chạm hoặc giao dịch trong vùng Bearish Order Block đang hoạt động." },
            },
            bullish_bos: {
                name: { en: "Bullish Break of Structure", vi: "Break of Structure tăng" },
                description: { en: "Close breaks above the nearest swing high, confirming bullish structure.", vi: "Giá đóng cửa phá lên trên swing high gần nhất, xác nhận cấu trúc tăng." },
            },
            bearish_bos: {
                name: { en: "Bearish Break of Structure", vi: "Break of Structure giảm" },
                description: { en: "Close breaks below the nearest swing low, confirming bearish structure.", vi: "Giá đóng cửa phá xuống dưới swing low gần nhất, xác nhận cấu trúc giảm." },
            },
            bullish_choch: {
                name: { en: "Bullish Change of Character", vi: "Change of Character tăng" },
                description: { en: "The first bullish BOS after a bearish BOS sequence, signaling a potential reversal upward.", vi: "Bullish BOS đầu tiên sau chuỗi bearish BOS, báo hiệu khả năng đảo chiều đi lên." },
            },
            bearish_choch: {
                name: { en: "Bearish Change of Character", vi: "Change of Character giảm" },
                description: { en: "The first bearish BOS after a bullish BOS sequence, signaling a potential reversal downward.", vi: "Bearish BOS đầu tiên sau chuỗi bullish BOS, báo hiệu khả năng đảo chiều đi xuống." },
            },
            bullish_fvg: {
                name: { en: "Bullish Fair Value Gap (FVG)", vi: "Bullish Fair Value Gap (FVG)" },
                description: { en: "Bullish price imbalance zone: bar[i-2].high < bar[i].low. Not yet filled.", vi: "Vùng mất cân bằng giá tăng: bar[i-2].high < bar[i].low. Chưa được lấp đầy." },
            },
            bearish_fvg: {
                name: { en: "Bearish Fair Value Gap (FVG)", vi: "Bearish Fair Value Gap (FVG)" },
                description: { en: "Bearish price imbalance zone: bar[i-2].low > bar[i].high. Not yet filled.", vi: "Vùng mất cân bằng giá giảm: bar[i-2].low > bar[i].high. Chưa được lấp đầy." },
            },
        },
    },
    SESSION_RANGE_STRUCTURE: {
        name: { en: "Session Range Structure", vi: "Cấu trúc biên độ phiên" },
        description: {
            en: "Tracks Asian session range and provides signals for London/NY breakouts and sweeps.",
            vi: "Theo dõi biên độ phiên Á và cung cấp tín hiệu cho các cú phá vỡ (breakout) và quét (sweep) trong phiên London/NY.",
        },
        paramSchema: {
            asianStartHour: { label: { en: "Asian Start Hour (UTC)", vi: "Giờ bắt đầu phiên Á (UTC)" } },
            asianEndHour: { label: { en: "Asian End Hour (UTC)", vi: "Giờ kết thúc phiên Á (UTC)" } },
        },
        conditions: {
            touches_asian_high: {
                name: { en: "Price touches Asian high", vi: "Giá chạm đỉnh phiên Á" },
                description: { en: "Current bar (post-Asian) overlaps the Asian session high.", vi: "Nến hiện tại (sau phiên Á) chạm vào mức đỉnh của phiên Á." },
            },
            touches_asian_low: {
                name: { en: "Price touches Asian low", vi: "Giá chạm đáy phiên Á" },
                description: { en: "Current bar (post-Asian) overlaps the Asian session low.", vi: "Nến hiện tại (sau phiên Á) chạm vào mức đáy của phiên Á." },
            },
            closes_above_asian_high: {
                name: { en: "Close above Asian high", vi: "Đóng cửa trên đỉnh phiên Á" },
                description: { en: "Current close finishes above the Asian session high.", vi: "Giá đóng cửa hiện tại nằm trên mức đỉnh của phiên Á." },
            },
            closes_below_asian_low: {
                name: { en: "Close below Asian low", vi: "Đóng cửa dưới đáy phiên Á" },
                description: { en: "Current close finishes below the Asian session low.", vi: "Giá đóng cửa hiện tại nằm dưới mức đáy của phiên Á." },
            },
            bullish_sweep_asian_low: {
                name: { en: "Bullish sweep of Asian low", vi: "Quét đáy phiên Á (Tăng)" },
                description: { en: "Current bar sweeps below Asian low and closes back above it.", vi: "Nến hiện tại quét xuống dưới đáy phiên Á rồi đóng cửa trở lại phía trên." },
            },
            bearish_sweep_asian_high: {
                name: { en: "Bearish sweep of Asian high", vi: "Quét đỉnh phiên Á (Giảm)" },
                description: { en: "Current bar sweeps above Asian high and closes back below it.", vi: "Nến hiện tại quét lên trên đỉnh phiên Á rồi đóng cửa trở lại phía dưới." },
            },
            bullish_reclaim_asian_low: {
                name: { en: "Bullish reclaim of Asian low", vi: "Reclaim đáy phiên Á (Tăng)" },
                description: { en: "Previous close was below Asian low and current close reclaims back above it.", vi: "Giá đóng cửa trước đó ở dưới đáy phiên Á và nến hiện tại đóng cửa trở lại phía trên." },
            },
            bearish_reclaim_asian_high: {
                name: { en: "Bearish reclaim of Asian high", vi: "Reclaim đỉnh phiên Á (Giảm)" },
                description: { en: "Previous close was above Asian high and current close reclaims back below it.", vi: "Giá đóng cửa trước đó ở trên đỉnh phiên Á và nến hiện tại đóng cửa trở lại phía dưới." },
            },
        },
    },
    ATR_REGIME: {
        name: { en: "ATR Volatility Regime", vi: "ATR regime bien dong" },
        description: {
            en: "Classifies volatility by comparing current ATR to its moving average.",
            vi: "Phan loai bien dong bang cach so sanh ATR hien tai voi duong trung binh ATR.",
        },
        paramSchema: {
            atrPeriod: { label: { en: "ATR Period", vi: "Chu ky ATR" } },
            basePeriod: { label: { en: "Base Average Period", vi: "Chu ky ATR trung binh" } },
        },
        conditions: {
            atr_low: {
                name: { en: "Low Volatility", vi: "Bien dong thap" },
                description: { en: "ATR is below its average ATR baseline.", vi: "ATR nam duoi duong co so ATR trung binh." },
                paramSchema: { multiplier: { label: { en: "Multiplier", vi: "He so" } } },
            },
            atr_normal: {
                name: { en: "Normal Volatility", vi: "Bien dong binh thuong" },
                description: { en: "ATR stays inside the configured normal range around its average.", vi: "ATR nam trong vung bien dong binh thuong quanh gia tri trung binh." },
                paramSchema: {
                    minMultiplier: { label: { en: "Min Multiplier", vi: "He so toi thieu" } },
                    maxMultiplier: { label: { en: "Max Multiplier", vi: "He so toi da" } },
                },
            },
            atr_expansion: {
                name: { en: "Volatility Expansion", vi: "Mo rong bien dong" },
                description: { en: "ATR is above its average ATR baseline by the configured multiplier.", vi: "ATR vuot len tren duong co so ATR trung binh theo he so da cau hinh." },
                paramSchema: { multiplier: { label: { en: "Multiplier", vi: "He so" } } },
            },
        },
    },
    SMART_TRAIL_SWITCH: {
        name: { en: "Smart Trail Switch", vi: "Smart Trail Switch" },
        description: {
            en: "ATR-based trail that flips bias when price closes through the adaptive trend line.",
            vi: "Duong trail dua tren ATR dao trang thai khi gia dong cua cat qua duong xu huong thich ung.",
        },
        paramSchema: {
            atrPeriod: { label: { en: "ATR Period", vi: "Chu ky ATR" } },
            multiplier: { label: { en: "ATR Multiplier", vi: "He so ATR" } },
        },
        conditions: {
            bullish_switch: {
                name: { en: "Bullish Smart Trail Switch", vi: "Smart Trail Switch tang" },
                description: { en: "The trail flips from bearish to bullish on the current bar.", vi: "Trang thai trail dao tu giam sang tang tren nen hien tai." },
            },
            bearish_switch: {
                name: { en: "Bearish Smart Trail Switch", vi: "Smart Trail Switch giam" },
                description: { en: "The trail flips from bullish to bearish on the current bar.", vi: "Trang thai trail dao tu tang sang giam tren nen hien tai." },
            },
            bullish_state: {
                name: { en: "Bullish Smart Trail State", vi: "Trang thai Smart Trail tang" },
                description: { en: "The trail is currently in bullish mode.", vi: "Trail hien dang o trang thai tang." },
            },
            bearish_state: {
                name: { en: "Bearish Smart Trail State", vi: "Trang thai Smart Trail giam" },
                description: { en: "The trail is currently in bearish mode.", vi: "Trail hien dang o trang thai giam." },
            },
        },
    },
    CONFIRMATION_TREND: {
        name: { en: "Confirmation Trend", vi: "Xac nhan xu huong" },
        description: {
            en: "Higher-timeframe style trend confirmation using EMA alignment plus ADX strength.",
            vi: "Xac nhan xu huong theo kieu higher timeframe bang canh hang EMA va do manh ADX.",
        },
        paramSchema: {
            fastPeriod: { label: { en: "Fast EMA Period", vi: "Chu ky EMA nhanh" } },
            slowPeriod: { label: { en: "Slow EMA Period", vi: "Chu ky EMA cham" } },
            adxPeriod: { label: { en: "ADX Period", vi: "Chu ky ADX" } },
        },
        conditions: {
            confirmation_uptrend: {
                name: { en: "Confirmation Uptrend", vi: "Xac nhan xu huong tang" },
                description: { en: "Price is above the slow EMA, fast EMA is above slow EMA, and ADX confirms trend strength.", vi: "Gia nam tren EMA cham, EMA nhanh nam tren EMA cham, va ADX xac nhan do manh xu huong." },
                paramSchema: { adxThreshold: { label: { en: "ADX Threshold", vi: "Nguong ADX" } } },
            },
            confirmation_downtrend: {
                name: { en: "Confirmation Downtrend", vi: "Xac nhan xu huong giam" },
                description: { en: "Price is below the slow EMA, fast EMA is below slow EMA, and ADX confirms trend strength.", vi: "Gia nam duoi EMA cham, EMA nhanh nam duoi EMA cham, va ADX xac nhan do manh xu huong." },
                paramSchema: { adxThreshold: { label: { en: "ADX Threshold", vi: "Nguong ADX" } } },
            },
        },
    },
    TREND_CATCHER: {
        name: { en: "Trend Catcher", vi: "Trend Catcher" },
        description: {
            en: "Short-horizon EMA and RSI state used to detect pullbacks or countertrend pockets inside a larger move.",
            vi: "Trang thai EMA va RSI ngan han de bat pullback hoac nhip nguoc xu huong ben trong mot xu huong lon hon.",
        },
        paramSchema: {
            fastPeriod: { label: { en: "Fast EMA Period", vi: "Chu ky EMA nhanh" } },
            slowPeriod: { label: { en: "Slow EMA Period", vi: "Chu ky EMA cham" } },
            rsiPeriod: { label: { en: "RSI Period", vi: "Chu ky RSI" } },
        },
        conditions: {
            trend_catcher_bullish: {
                name: { en: "Trend Catcher Bullish", vi: "Trend Catcher tang" },
                description: { en: "Short-term trend catcher is bullish: price and momentum are aligned upward.", vi: "Trend Catcher ngan han o trang thai tang: gia va dong luong cung huong len." },
                paramSchema: { rsiThreshold: { label: { en: "RSI Threshold", vi: "Nguong RSI" } } },
            },
            trend_catcher_bearish: {
                name: { en: "Trend Catcher Bearish", vi: "Trend Catcher giam" },
                description: { en: "Short-term trend catcher is bearish: price and momentum are aligned downward.", vi: "Trend Catcher ngan han o trang thai giam: gia va dong luong cung huong xuong." },
                paramSchema: { rsiThreshold: { label: { en: "RSI Threshold", vi: "Nguong RSI" } } },
            },
        },
    },
    DOW_THEORY_STRUCTURE: {
        name: { en: "Dow Theory Structure (Single-Asset MVP)", vi: "Cấu trúc Dow Theory (MVP một tài sản)" },
        description: {
            en: "Evaluates confirmed swing-structure trend state, warning state, and close-based reversal confirmation for a single instrument.",
            vi: "Đánh giá trạng thái xu hướng theo swing đã xác nhận, trạng thái cảnh báo và xác nhận đảo chiều theo giá đóng cửa cho một công cụ đơn lẻ.",
        },
        paramSchema: {
            swingStrength: { label: { en: "Swing Strength", vi: "Độ mạnh swing" } },
        },
        conditions: {
            primary_uptrend_confirmed: {
                name: { en: "Primary uptrend confirmed", vi: "Xu hướng tăng chính đã xác nhận" },
                description: { en: "Confirmed swing highs and lows remain in an advancing primary uptrend.", vi: "Các swing high và swing low đã xác nhận vẫn duy trì trong xu hướng tăng chính." },
            },
            primary_downtrend_confirmed: {
                name: { en: "Primary downtrend confirmed", vi: "Xu hướng giảm chính đã xác nhận" },
                description: { en: "Confirmed swing highs and lows remain in a declining primary downtrend.", vi: "Các swing high và swing low đã xác nhận vẫn duy trì trong xu hướng giảm chính." },
            },
            bullish_reversal_warning: {
                name: { en: "Bullish reversal warning", vi: "Cảnh báo đảo chiều tăng" },
                description: { en: "A downtrend shows higher-low non-confirmation, but no close has confirmed the reversal yet.", vi: "Một xu hướng giảm xuất hiện tín hiệu không xác nhận với đáy cao hơn, nhưng chưa có giá đóng cửa nào xác nhận đảo chiều." },
            },
            bearish_reversal_warning: {
                name: { en: "Bearish reversal warning", vi: "Cảnh báo đảo chiều giảm" },
                description: { en: "An uptrend shows lower-high non-confirmation, but no close has confirmed the reversal yet.", vi: "Một xu hướng tăng xuất hiện tín hiệu không xác nhận với đỉnh thấp hơn, nhưng chưa có giá đóng cửa nào xác nhận đảo chiều." },
            },
            bullish_reversal_confirmed: {
                name: { en: "Bullish reversal confirmed", vi: "Đảo chiều tăng đã xác nhận" },
                description: { en: "Price closes above the active reaction high, confirming an upside reversal.", vi: "Giá đóng cửa lên trên reaction high đang hoạt động, xác nhận đảo chiều đi lên." },
            },
            bearish_reversal_confirmed: {
                name: { en: "Bearish reversal confirmed", vi: "Đảo chiều giảm đã xác nhận" },
                description: { en: "Price closes below the active reaction low, confirming a downside reversal.", vi: "Giá đóng cửa xuống dưới reaction low đang hoạt động, xác nhận đảo chiều đi xuống." },
            },
        },
    },
};

function resolveLocalizedText(translation: LocalizedText | undefined, locale: AppLocale, fallback: string): string {
    return translation?.[locale] ?? fallback;
}

function localizeFieldSchema(
    field: TechIndicatorFieldSchema,
    locale: AppLocale,
    translation?: FieldTranslation,
): TechIndicatorFieldSchema {
    return {
        ...field,
        label: resolveLocalizedText(translation?.label, locale, field.label),
    };
}

function localizeCondition(
    condition: TechIndicatorConditionDef,
    locale: AppLocale,
    translation?: ConditionTranslation,
): TechIndicatorConditionDef {
    return {
        ...condition,
        name: resolveLocalizedText(translation?.name, locale, condition.name),
        description: resolveLocalizedText(translation?.description, locale, condition.description),
        paramSchema: condition.paramSchema.map((field) => localizeFieldSchema(
            field,
            locale,
            translation?.paramSchema?.[field.id],
        )),
    };
}

export function localizeTechIndicatorDefinitions(
    definitions: TechIndicatorDefinition[],
    locale: AppLocale,
): TechIndicatorDefinition[] {
    return definitions.map((definition) => {
        const translation = indicatorTranslations[definition.id];

        return {
            ...definition,
            name: resolveLocalizedText(translation?.name, locale, definition.name),
            description: resolveLocalizedText(translation?.description, locale, definition.description),
            paramSchema: definition.paramSchema.map((field) => localizeFieldSchema(
                field,
                locale,
                translation?.paramSchema?.[field.id],
            )),
            conditions: definition.conditions.map((condition) => localizeCondition(
                condition,
                locale,
                translation?.conditions?.[condition.id],
            )),
        };
    });
}
