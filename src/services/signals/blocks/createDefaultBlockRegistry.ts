import { TechIndicatorRegistry } from './TechIndicatorRegistry';
import { rsiBlock } from './plugins/RsiBlock';
import { emaCrossBlock } from './plugins/EmaCrossBlock';
import { elliottWaveBlock } from './plugins/ElliottWaveBlock';
import { smcBlock } from './plugins/SmcBlock';
import { fibonacciBlock } from './plugins/FibonacciBlock';
import { atrRegimeBlock } from './plugins/AtrRegimeBlock';
import { marketRegimeBlock } from './plugins/MarketRegimeBlock';
import { sessionBlock } from './plugins/SessionBlock';
import { dowTheoryStructureBlock } from './plugins/DowTheoryStructureBlock';
import { previousPeriodLevelsBlock } from './plugins/PreviousPeriodLevelsBlock';
import { sessionRangeStructureBlock } from './plugins/SessionRangeStructureBlock';
import { smartTrailSwitchBlock } from './plugins/SmartTrailSwitchBlock';
import { confirmationTrendBlock } from './plugins/ConfirmationTrendBlock';
import { trendCatcherBlock } from './plugins/TrendCatcherBlock';
import { volmanPriceActionBlock } from './plugins/VolmanPriceActionBlock';

/**
 * Creates and populates the default TechIndicatorRegistry with all built-in blocks.
 * Add new indicator blocks here as they are implemented.
 */
export const createDefaultBlockRegistry = (): TechIndicatorRegistry => {
    const registry = new TechIndicatorRegistry();

    // Momentum
    registry.register(rsiBlock);

    // Trend & Regime
    registry.register(emaCrossBlock)
        .register(atrRegimeBlock)
        .register(marketRegimeBlock)
        .register(smartTrailSwitchBlock)
        .register(confirmationTrendBlock)
        .register(trendCatcherBlock);

    // Structure / Smart Money
    registry.register(smcBlock);
    registry.register(dowTheoryStructureBlock);
    registry.register(fibonacciBlock);
    registry.register(elliottWaveBlock);
    registry.register(sessionBlock);
    registry.register(previousPeriodLevelsBlock);
    registry.register(sessionRangeStructureBlock);
    registry.register(volmanPriceActionBlock);

    return registry;
};
