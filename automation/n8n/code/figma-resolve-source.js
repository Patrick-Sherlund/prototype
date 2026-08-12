const env = (name) => $env[name];

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

function designUrlFromKey(fileKey) {
  return fileKey ? `https://www.figma.com/design/${encodeURIComponent(fileKey)}` : '';
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
const mapping = staticData.figmaDesignMappings[input.jiraIssueKey] || {};

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

const destinationFileKey = clean(mapping.figmaDesignFileKey || env('FIGMA_DESTINATION_FILE_KEY'), 200);
const destinationUrl = clean(mapping.figmaDesignUrl || env('FIGMA_DESTINATION_FILE_URL') || designUrlFromKey(destinationFileKey), 2000);

markHandoff(input, {
  status: 'figma_source_resolved',
  source,
  destination: {
    figmaDesignFileKey: destinationFileKey,
    figmaDesignUrl: destinationUrl,
  },
});

console.log(
  JSON.stringify({
    stage: 'FIGMA_SOURCE_RESOLVED',
    correlationId: input.correlationId,
    handoffId: input.handoffId,
    fileKey: incomingMakeFileKey,
    destinationReused: Boolean(mapping.figmaDesignUrl || mapping.figmaDesignFileKey),
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
      figmaDestinationFromMapping: Boolean(mapping.figmaDesignUrl || mapping.figmaDesignFileKey),
    },
  },
];
