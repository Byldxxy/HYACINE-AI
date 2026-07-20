/** Build a support report that contains state metadata but no user content. */
function countMessages(sessions = {}) {
    return Object.values(sessions).reduce(
        (total, messages) => total + (Array.isArray(messages) ? messages.length : 0),
        0
    );
}

function buildDiagnosticsReport({
    version,
    config = {},
    sessions = {},
    summaries = {},
    persistentMemory = [],
    desktopAwareness = {},
    desktopEngine = {},
    desktopPetAvailable = false,
    desktopPetVisible = false,
    runtimeMode = 'source',
}) {
    return {
        generatedAt: new Date().toISOString(),
        application: {
            name: 'HYACINE-AI',
            version,
            runtimeMode,
            platform: process.platform,
            architecture: process.arch,
            node: process.versions.node,
            electron: process.versions.electron || null,
            uptimeSeconds: Math.round(process.uptime()),
        },
        configuration: {
            schemaVersion: Number(config.configVersion) || null,
            apiEndpointConfigured: Boolean(config.apiEndpoint),
            apiKeyConfigured: Boolean(config.apiKey),
            textModelConfigured: Boolean(config.modelName),
            imageEndpointConfigured: Boolean(config.imageEndpoint || config.apiEndpoint),
            imageModelConfigured: Boolean(config.imageModel),
            proactiveEnabled: Boolean(config.enableProactive),
            desktopAwarenessEnabled: Boolean(config.enableDesktopAwareness),
        },
        memory: {
            sessionCount: Object.keys(sessions).length,
            messageCount: countMessages(sessions),
            summaryCount: Object.keys(summaries).length,
            persistentFactCount: Array.isArray(persistentMemory) ? persistentMemory.length : 0,
        },
        desktop: {
            available: Boolean(desktopPetAvailable),
            visible: Boolean(desktopPetVisible),
            observerStatus: String(desktopAwareness.status || 'unavailable'),
            observerDetailPresent: Boolean(desktopAwareness.detail),
            modelProcessing: Boolean(desktopEngine.processing),
            lastResult: String(desktopEngine.lastResult?.status || 'idle'),
        },
    };
}

module.exports = { buildDiagnosticsReport };
