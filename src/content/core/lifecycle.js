// Bangit - Feature lifecycle management

/**
 * Feature registry
 * Each feature has: { instance, started, dependencies }
 */
const features = new Map();

/**
 * Lazy-loadable feature loaders
 * Maps feature name to a function that returns Promise<module>
 */
const lazyLoaders = new Map();

/**
 * Register a feature
 * @param {string} name - Unique feature name
 * @param {object} feature - Feature object with start() and stop() methods
 * @param {string[]} dependencies - Names of features this depends on
 */
export function registerFeature(name, feature, dependencies = []) {
  if (features.has(name)) {
    console.warn(`[Bangit] Feature "${name}" already registered, skipping`);
    return;
  }

  features.set(name, {
    instance: feature,
    started: false,
    dependencies,
  });

  console.log(`[Bangit] Feature registered: ${name}`);
}

/**
 * Register a lazy-loadable feature
 * @param {string} name - Feature name
 * @param {Function} loader - Async function that returns the feature module
 * @param {string[]} dependencies - Names of features this depends on
 */
export function registerLazyFeature(name, loader, dependencies = []) {
  lazyLoaders.set(name, { loader, dependencies });
  console.log(`[Bangit] Lazy feature registered: ${name}`);
}

/**
 * Load and register a lazy feature
 * @param {string} name - Feature name
 * @returns {Promise<object>} The loaded feature
 */
export async function loadLazyFeature(name) {
  const lazy = lazyLoaders.get(name);
  if (!lazy) {
    throw new Error(`[Bangit] Lazy feature "${name}" not registered`);
  }

  // Already loaded?
  if (features.has(name)) {
    return features.get(name).instance;
  }

  console.log(`[Bangit] Loading lazy feature: ${name}`);
  const module = await lazy.loader();
  const feature = module.default || module;

  registerFeature(name, feature, lazy.dependencies);
  return feature;
}

/**
 * Start a feature
 * @param {string} name - Feature name
 * @returns {Promise<boolean>} True if started successfully
 */
export async function startFeature(name) {
  // Try to load lazy feature if not registered
  if (!features.has(name) && lazyLoaders.has(name)) {
    await loadLazyFeature(name);
  }

  const feature = features.get(name);
  if (!feature) {
    console.warn(`[Bangit] Feature "${name}" not found`);
    return false;
  }

  if (feature.started) {
    console.log(`[Bangit] Feature "${name}" already started`);
    return true;
  }

  // Start dependencies first
  for (const dep of feature.dependencies) {
    await startFeature(dep);
  }

  // Start this feature
  try {
    if (feature.instance.start) {
      await feature.instance.start();
    }
    feature.started = true;
    console.log(`[Bangit] Feature started: ${name}`);
    return true;
  } catch (error) {
    console.error(`[Bangit] Error starting feature "${name}":`, error);
    return false;
  }
}

/**
 * Stop a feature
 * @param {string} name - Feature name
 * @returns {Promise<boolean>} True if stopped successfully
 */
export async function stopFeature(name) {
  const feature = features.get(name);
  if (!feature) {
    return false;
  }

  if (!feature.started) {
    return true;
  }

  // Stop dependents first (features that depend on this one)
  for (const [depName, depFeature] of features) {
    if (depFeature.dependencies.includes(name) && depFeature.started) {
      await stopFeature(depName);
    }
  }

  // Stop this feature
  try {
    if (feature.instance.stop) {
      await feature.instance.stop();
    }
    feature.started = false;
    console.log(`[Bangit] Feature stopped: ${name}`);
    return true;
  } catch (error) {
    console.error(`[Bangit] Error stopping feature "${name}":`, error);
    return false;
  }
}

/**
 * Start all registered features
 * @returns {Promise<void>}
 */
export async function startAllFeatures() {
  console.log('[Bangit] Starting all features...');

  // Build dependency order
  const started = new Set();
  const toStart = [...features.keys()];

  while (toStart.length > 0) {
    const name = toStart.shift();
    const feature = features.get(name);

    // Check if all dependencies are started
    const depsReady = feature.dependencies.every(dep => started.has(dep));

    if (depsReady) {
      await startFeature(name);
      started.add(name);
    } else {
      // Move to end of queue
      toStart.push(name);
    }

    // Safety: prevent infinite loop
    if (toStart.length > features.size * 2) {
      console.error('[Bangit] Circular dependency detected');
      break;
    }
  }

  console.log('[Bangit] All features started');
}

/**
 * Stop all features
 * @returns {Promise<void>}
 */
export async function stopAllFeatures() {
  console.log('[Bangit] Stopping all features...');

  // Stop in reverse dependency order
  const stopped = new Set();
  const toStop = [...features.keys()].reverse();

  while (toStop.length > 0) {
    const name = toStop.shift();
    const feature = features.get(name);

    if (!feature.started) {
      stopped.add(name);
      continue;
    }

    // Check if all dependents are stopped
    const dependents = [...features.entries()]
      .filter(([_, f]) => f.dependencies.includes(name) && f.started)
      .map(([n]) => n);

    const dependentsReady = dependents.every(dep => stopped.has(dep));

    if (dependentsReady) {
      await stopFeature(name);
      stopped.add(name);
    } else {
      // Move to end of queue
      toStop.push(name);
    }

    // Safety: prevent infinite loop
    if (toStop.length > features.size * 2) {
      console.error('[Bangit] Circular dependency detected');
      break;
    }
  }

  console.log('[Bangit] All features stopped');
}

/**
 * Restart a feature
 * @param {string} name - Feature name
 * @returns {Promise<boolean>}
 */
export async function restartFeature(name) {
  await stopFeature(name);
  return startFeature(name);
}

/**
 * Check if a feature is started
 * @param {string} name - Feature name
 * @returns {boolean}
 */
export function isFeatureStarted(name) {
  const feature = features.get(name);
  return feature?.started || false;
}

/**
 * Get a feature instance
 * @param {string} name - Feature name
 * @returns {object|null}
 */
export function getFeature(name) {
  const feature = features.get(name);
  return feature?.instance || null;
}

/**
 * Get all registered feature names
 * @returns {string[]}
 */
export function getFeatureNames() {
  return [...features.keys(), ...lazyLoaders.keys()];
}
