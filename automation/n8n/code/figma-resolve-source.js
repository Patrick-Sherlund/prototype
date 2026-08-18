const env = (name) => $env[name];

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function designUrlFromKey(fileKey) {
  return fileKey ? `https://www.figma.com/design/${encodeURIComponent(fileKey)}` : '';
}

function designKeyFromUrl(url) {
  const match = String(url || '').match(/figma\.com\/design\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : '';
}

function boolEnv(name, fallback = false) {
  const value = env(name);
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function markHandoff(input, patch) {
  if (!input.handoffId) return;
  const staticData = $getWorkflowStaticData('global');
  staticData.figmaHandoffs = staticData.figmaHandoffs || {};
  staticData.figmaHandoffs[input.handoffId] = {
    ...(staticData.figmaHandoffs[input.handoffId] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

const input = $input.first().json;
if (input.requestFailed || (!input.shouldProcess && !input.retryJiraOnly)) return [{ json: input }];
if (input.retryJiraOnly) return [{ json: input }];

const staticData = $getWorkflowStaticData('global');
staticData.figmaDesignMappings = staticData.figmaDesignMappings || {};
staticData.figmaCanonicalDesign = staticData.figmaCanonicalDesign || {};
staticData.figmaViewMappings = staticData.figmaViewMappings || {};
staticData.figmaArchivedViewMappings = staticData.figmaArchivedViewMappings || {};

const configuredMakeFileKey = clean(env('FIGMA_MAKE_FILE_KEY'), 200);
const incomingMakeFileKey = clean(input.figmaMakeFileKey, 200);
const source = {
  figmaMakeFileKey: incomingMakeFileKey,
  figmaVersionId: clean(input.figmaVersionId, 200),
  figmaVersionLabel: clean(input.figmaVersionLabel, 500),
  figmaVersionDescription: clean(input.figmaVersionDescription, 2000),
  figmaMakeUrl: clean(env('FIGMA_MAKE_URL') || input.figmaMakeUrl || '', 2000),
  figmaMakePublishedUrl: clean(env('FIGMA_MAKE_PUBLISHED_URL') || input.figmaMakePublishedUrl || '', 2000),
  configuredMakeFileKey,
  configuredMakeFileKeyMatched: !configuredMakeFileKey || configuredMakeFileKey === incomingMakeFileKey,
};

const configuredDestinationUrl = clean(env('FIGMA_DESIGN_FILE_URL') || env('FIGMA_DESTINATION_FILE_URL'), 2000);
const configuredDestinationKey = clean(env('FIGMA_DESIGN_FILE_KEY') || env('FIGMA_DESTINATION_FILE_KEY') || designKeyFromUrl(configuredDestinationUrl), 200);
const persistedDestinationUrl = clean(staticData.figmaCanonicalDesign.figmaDesignUrl || '', 2000);
const persistedDestinationKey = clean(staticData.figmaCanonicalDesign.figmaDesignFileKey || designKeyFromUrl(persistedDestinationUrl), 200);
const destinationConfigured = Boolean(configuredDestinationUrl || configuredDestinationKey);
const destinationFileKey = destinationConfigured ? configuredDestinationKey : persistedDestinationKey;
const destinationUrl = destinationConfigured
  ? configuredDestinationUrl || designUrlFromKey(configuredDestinationKey)
  : persistedDestinationUrl || designUrlFromKey(persistedDestinationKey);
const bootstrapAllowed = boolEnv('FIGMA_DESIGN_BOOTSTRAP_ALLOWED', true);
const syncMode = destinationUrl || destinationFileKey ? 'SYNC' : 'BOOTSTRAP';
const syncPageName = clean(env('FIGMA_SYNC_PAGE_NAME') || 'Figma Make Screens', 200);
const archiveRemovedViews = boolEnv('FIGMA_ARCHIVE_REMOVED_VIEWS', true);

if (destinationConfigured && !destinationUrl && !destinationFileKey) {
  return [
    {
      json: {
        ...input,
        requestFailed: true,
        failureStage: 'FIGMA_SOURCE_RESOLVED',
        errorMessage: 'FIGMA_DESIGN_FILE_URL or FIGMA_DESIGN_FILE_KEY was configured but no usable Figma Design file identifier could be derived.',
      },
    },
  ];
}

if (syncMode === 'BOOTSTRAP' && !bootstrapAllowed) {
  return [
    {
      json: {
        ...input,
        requestFailed: true,
        failureStage: 'FIGMA_SOURCE_RESOLVED',
        errorMessage: 'No canonical Figma Design file is configured or persisted, and FIGMA_DESIGN_BOOTSTRAP_ALLOWED is false.',
      },
    },
  ];
}

markHandoff(input, {
  status: 'figma_source_resolved',
  source,
  destination: {
    figmaDesignFileKey: destinationFileKey,
    figmaDesignUrl: destinationUrl,
    syncMode,
    syncPageName,
    canonicalConfigured: destinationConfigured,
  },
});

console.log(
  JSON.stringify({
    stage: 'FIGMA_SOURCE_RESOLVED',
    correlationId: input.correlationId,
    handoffId: input.handoffId,
    fileKey: incomingMakeFileKey,
    syncMode,
    destinationReused: syncMode === 'SYNC',
  }),
);

return [
  {
    json: {
      ...input,
      figmaSourceResolved: true,
      ...source,
      figmaDestinationFileKey: destinationFileKey,
      figmaDestinationUrl: destinationUrl,
      figmaDestinationFromMapping: Boolean(persistedDestinationUrl || persistedDestinationKey),
      figmaCanonicalConfigured: destinationConfigured,
      figmaSyncMode: syncMode,
      figmaSyncPageName: syncPageName,
      figmaDesignBootstrapAllowed: bootstrapAllowed,
      figmaArchiveRemovedViews: archiveRemovedViews,
      figmaViewMappings: staticData.figmaViewMappings,
      figmaArchivedViewMappings: staticData.figmaArchivedViewMappings,
    },
  },
];
