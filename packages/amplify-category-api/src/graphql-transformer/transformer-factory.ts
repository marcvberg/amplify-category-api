import { AuthTransformer as AuthTransformerV2 } from '@aws-amplify/graphql-auth-transformer';
import { DefaultValueTransformer as DefaultValueTransformerV2 } from '@aws-amplify/graphql-default-value-transformer';
import { FunctionTransformer as FunctionTransformerV2 } from '@aws-amplify/graphql-function-transformer';
import { HttpTransformer as HttpTransformerV2 } from '@aws-amplify/graphql-http-transformer';
import {
  IndexTransformer as IndexTransformerV2,
  PrimaryKeyTransformer as PrimaryKeyTransformerV2,
} from '@aws-amplify/graphql-index-transformer';
import { MapsToTransformer as MapsToTransformerV2 } from '@aws-amplify/graphql-maps-to-transformer';
import { ModelTransformer as ModelTransformerV2 } from '@aws-amplify/graphql-model-transformer';
import { PredictionsTransformer as PredictionsTransformerV2 } from '@aws-amplify/graphql-predictions-transformer';
import {
  BelongsToTransformer as BelongsToTransformerV2,
  HasManyTransformer as HasManyTransformerV2,
  HasOneTransformer as HasOneTransformerV2,
  ManyToManyTransformer as ManyToManyTransformerV2,
} from '@aws-amplify/graphql-relational-transformer';
import { SearchableModelTransformer as SearchableModelTransformerV2 } from '@aws-amplify/graphql-searchable-transformer';
import { TransformerPluginProvider as TransformerPluginProviderV2 } from '@aws-amplify/graphql-transformer-interfaces';
import { DynamoDBModelTransformer as DynamoDBModelTransformerV1 } from 'graphql-dynamodb-transformer';
import { ModelAuthTransformer as ModelAuthTransformerV1 } from 'graphql-auth-transformer';
import { ModelConnectionTransformer as ModelConnectionTransformerV1 } from 'graphql-connection-transformer';
import { SearchableModelTransformer as SearchableModelTransformerV1 } from 'graphql-elasticsearch-transformer';
import { VersionedModelTransformer as VersionedModelTransformerV1 } from 'graphql-versioned-transformer';
import { FunctionTransformer as FunctionTransformerV1 } from 'graphql-function-transformer';
import { HttpTransformer as HttpTransformerV1 } from 'graphql-http-transformer';
import { PredictionsTransformer as PredictionsTransformerV1 } from 'graphql-predictions-transformer';
import { KeyTransformer as KeyTransformerV1 } from 'graphql-key-transformer';
import {
  $TSAny,
  $TSContext,
  pathManager,
  stateManager,
  ApiCategoryFacade,
  CloudformationProviderFacade,
} from '@aws-amplify/amplify-cli-core';
import { printer } from '@aws-amplify/amplify-prompts';
import {
  loadProject,
  readTransformerConfiguration,
  TRANSFORM_CONFIG_FILE_NAME,
  ITransformer,
  TransformConfig,
} from 'graphql-transformer-core';
import importFrom from 'import-from';
import importGlobal from 'import-global';
import path from 'path';
import { GraphQLTransform } from '@aws-amplify/graphql-transformer-core';
import { parseUserDefinedSlots } from './user-defined-slots';
import { AmplifyCLIFeatureFlagAdapter } from './amplify-cli-feature-flag-adapter';
import { TransformerProjectOptions } from './transformer-options-types';

const PROVIDER_NAME = 'awscloudformation';

type TransformerFactoryArgs = {
    addSearchableTransformer: boolean;
    authConfig: $TSAny;
    storageConfig?: $TSAny;
    adminRoles?: Array<string>;
    identityPoolId?: string;
  };

/**
 * Return the graphql transformer factory based on the projects current transformer version.
 */
export const getTransformerFactory = async (
  context: $TSContext,
  resourceDir: string,
  authConfig?: $TSAny,
): Promise<(options: $TSAny) => Promise<(TransformerPluginProviderV2 | ITransformer)[]>> => {
  const transformerVersion = await ApiCategoryFacade.getTransformerVersion(context);
  return transformerVersion === 2
    ? getTransformerFactoryV2(resourceDir)
    : getTransformerFactoryV1(context, resourceDir, authConfig);
};

const getTransformerFactoryV2 = (
  resourceDir: string,
): (options: TransformerFactoryArgs) => Promise<TransformerPluginProviderV2[]> => async (options?: TransformerFactoryArgs) => {
  const modelTransformer = new ModelTransformerV2();
  const indexTransformer = new IndexTransformerV2();
  const hasOneTransformer = new HasOneTransformerV2();
  const authTransformer = new AuthTransformerV2({
    adminRoles: options.adminRoles ?? [],
    identityPoolId: options.identityPoolId,
  });
  const transformerList: TransformerPluginProviderV2[] = [
    modelTransformer,
    new FunctionTransformerV2(),
    new HttpTransformerV2(),
    new PredictionsTransformerV2(options?.storageConfig),
    new PrimaryKeyTransformerV2(),
    indexTransformer,
    new HasManyTransformerV2(),
    hasOneTransformer,
    new ManyToManyTransformerV2(modelTransformer, indexTransformer, hasOneTransformer, authTransformer),
    new BelongsToTransformerV2(),
    new DefaultValueTransformerV2(),
    authTransformer,
    new MapsToTransformerV2(),
    // TODO: initialize transformer plugins
  ];

  if (options?.addSearchableTransformer) {
    const resourceDirParts = resourceDir.split(path.sep);
    const apiName = resourceDirParts[resourceDirParts.length - 1];
    transformerList.push(new SearchableModelTransformerV2(apiName));
  }

  const customTransformersConfig = await loadProject(resourceDir);
  const customTransformerList = customTransformersConfig?.config?.transformers;
  const customTransformers = (Array.isArray(customTransformerList) ? customTransformerList : [])
    .map(importTransformerModule)
    .map(imported => {
      const CustomTransformer = imported.default;

      if (typeof CustomTransformer === 'function') {
        return new CustomTransformer();
      } if (typeof CustomTransformer === 'object') {
        // Todo: Use a shim to ensure that it adheres to TransformerProvider interface. For now throw error
        // return CustomTransformer;
        throw new Error("Custom Transformers' should implement TransformerProvider interface");
      }

      throw new Error("Custom Transformers' default export must be a function or an object");
    })
    .filter(customTransformer => customTransformer);

  if (customTransformers.length > 0) {
    transformerList.push(...customTransformers);
  }

  return transformerList;
};

function getTransformerFactoryV1(context: $TSContext, resourceDir: string, authConfig?: $TSAny) {
  return async (addSearchableTransformer: boolean, storageConfig?: $TSAny) => {
    const transformerList: ITransformer[] = [
      // TODO: Removing until further discussion. `getTransformerOptions(project, '@model')`
      new DynamoDBModelTransformerV1(),
      new VersionedModelTransformerV1(),
      new FunctionTransformerV1(),
      new HttpTransformerV1(),
      new KeyTransformerV1(),
      new ModelConnectionTransformerV1(),
      new PredictionsTransformerV1(storageConfig),
    ];

    if (addSearchableTransformer) {
      transformerList.push(new SearchableModelTransformerV1());
    }

    const customTransformersConfig: TransformConfig = await readTransformerConfiguration(resourceDir);
    const customTransformers = (
      customTransformersConfig && customTransformersConfig.transformers ? customTransformersConfig.transformers : []
    )
      .map(importTransformerModule)
      .map(imported => {
        const CustomTransformer = imported.default;

        if (typeof CustomTransformer === 'function') {
          return new CustomTransformer();
        } else if (typeof CustomTransformer === 'object') {
          return CustomTransformer;
        }

        throw new Error("Custom Transformers' default export must be a function or an object");
      })
      .filter(customTransformer => customTransformer);

    if (customTransformers.length > 0) {
      transformerList.push(...customTransformers);
    }

    // TODO: Build dependency mechanism into transformers. Auth runs last
    // so any resolvers that need to be protected will already be created.

    let amplifyAdminEnabled: boolean = false;

    try {
      const amplifyMeta = stateManager.getMeta();
      const appId = amplifyMeta?.providers?.[PROVIDER_NAME]?.AmplifyAppId;
      const res = await CloudformationProviderFacade.isAmplifyAdminApp(context, appId);
      amplifyAdminEnabled = res.isAdminApp;
    } catch (err) {
      // if it is not an AmplifyAdmin app, do nothing
    }

    transformerList.push(new ModelAuthTransformerV1({ authConfig, addAwsIamAuthInOutputSchema: amplifyAdminEnabled }));
    return transformerList;
  };
}

/**
 * Attempt to load the module from a transformer name using the following priority order
 * - modulePath is an absolute path to an NPM package
 * - modulePath is a package name, then it will be loaded from the project's root's node_modules with createRequireFromPath.
 * - modulePath is a name of a globally installed package
 */
const importTransformerModule = (transformerName: string) => {
  const fileUrlMatch = /^file:\/\/(.*)\s*$/m.exec(transformerName);
  const modulePath = fileUrlMatch ? fileUrlMatch[1] : transformerName;

  if (!modulePath) {
    throw new Error(`Invalid value specified for transformer: '${transformerName}'`);
  }

  let importedModule;
  const tempModulePath = modulePath.toString();

  try {
    if (path.isAbsolute(tempModulePath)) {
      // Load it by absolute path
      /* eslint-disable-next-line global-require, import/no-dynamic-require */
      importedModule = require(modulePath);
    } else {
      const projectRootPath = pathManager.findProjectRoot();
      const projectNodeModules = path.join(projectRootPath, 'node_modules');

      try {
        importedModule = importFrom(projectNodeModules, modulePath);
      } catch {
        // Intentionally left blank to try global
      }

      // Try global package install
      if (!importedModule) {
        importedModule = importGlobal(modulePath);
      }
    }

    // At this point we've to have an imported module, otherwise module loader, threw an error.
    return importedModule;
  } catch (error) {
    printer.error(`Unable to import custom transformer module(${modulePath}).`);
    printer.error(`You may fix this error by editing transformers at ${path.join(transformerName, TRANSFORM_CONFIG_FILE_NAME)}`);
    throw error;
  }
};

/**
 * Use the options generated from 'transformer-options' to create a V2 GraphQL Transform instance
 * @param opts The options produced by 'transformer-options'
 * @returns GraphQLTransform A brand new instance of the GraphQL Transform
 */
export const constructGraphQLTransformV2 = async (opts: TransformerProjectOptions<TransformerFactoryArgs>): Promise<GraphQLTransform> => {
  const userProjectConfig = opts.projectConfig;
  const stackMapping = userProjectConfig.config.StackMapping;
  const userDefinedSlots = {
    ...parseUserDefinedSlots(userProjectConfig.pipelineFunctions),
    ...parseUserDefinedSlots(userProjectConfig.resolvers),
  };

  // Create the transformer instances, we've to make sure we're not reusing them within the same CLI command
  // because the StackMapping feature already builds the project once.
  const transformers = await opts.transformersFactory(opts.transformersFactoryArgs);
  const transform = new GraphQLTransform({
    transformers,
    stackMapping,
    transformConfig: userProjectConfig.config,
    authConfig: opts.authConfig,
    buildParameters: opts.buildParameters,
    stacks: opts.projectConfig.stacks || {},
    featureFlags: new AmplifyCLIFeatureFlagAdapter(),
    sandboxModeEnabled: opts.sandboxModeEnabled,
    userDefinedSlots,
    resolverConfig: opts.resolverConfig,
    overrideConfig: opts.overrideConfig,
  });

  return transform;
};
