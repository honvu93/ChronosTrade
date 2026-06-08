import { SignalRegistry } from './SignalRegistry';
import { songTrapRuntime } from './plugins/songTrap/runtime';
import { createDefaultBlockRegistry } from './blocks/createDefaultBlockRegistry';
import { TechIndicatorRegistry } from './blocks/TechIndicatorRegistry';

export { createDefaultBlockRegistry, TechIndicatorRegistry };

export const createDefaultSignalRegistry = () => {
    const registry = new SignalRegistry();
    registry.register(songTrapRuntime);
    // Composed signals are loaded asynchronously at server startup via loadComposedSignals()
    return registry;
};
