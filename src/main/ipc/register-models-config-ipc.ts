import type { BrowserWindow } from 'electron'
import {
  modelsConfigGetDefaultsContract,
  modelsConfigListRemoteContract,
  modelsConfigBuiltinProvidersContract,
  modelsConfigLoadContract,
  modelsConfigLookupCatalogContract,
  modelsConfigProviderCatalogContract,
  modelsConfigSetProviderKeyContract,
  modelsConfigSaveAndRestartContract,
  modelsConfigSaveContract,
  modelsConfigSetDefaultContract,
  modelsConfigTestContract,
} from '../../shared/ipc/contracts'
import {
  ModelsConfigError,
  type ModelsConfigController,
} from '../models-config/models-config-service'
import { listRemoteModels, RemoteModelListError } from '../models-config/remote-model-list'
import type { ApplicationUrlPolicy } from '../security/url-policy'
import {
  createTrustedSenderValidator,
  MainProcessError,
  registerValidatedHandler,
} from './validated-handler'

interface RegisterModelsConfigIpcOptions {
  controller: ModelsConfigController
  getMainWindow(): BrowserWindow | null
  policy: ApplicationUrlPolicy
}

function mapModelsConfigError(error: unknown): never {
  if (error instanceof ModelsConfigError) {
    throw new MainProcessError(error.code, error.message)
  }
  throw error
}

export function registerModelsConfigIpc({
  controller,
  getMainWindow,
  policy,
}: RegisterModelsConfigIpcOptions) {
  const isTrustedSender = createTrustedSenderValidator(policy, getMainWindow)
  registerValidatedHandler(
    modelsConfigLoadContract,
    isTrustedSender,
    ({ target }) => controller.load(target).catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigSaveContract,
    isTrustedSender,
    ({ target, content, expectedFingerprint }) =>
      controller
        .save(target, content, expectedFingerprint, false)
        .catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigSaveAndRestartContract,
    isTrustedSender,
    ({ target, content, expectedFingerprint }) =>
      controller
        .save(target, content, expectedFingerprint, true)
        .catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigSetDefaultContract,
    isTrustedSender,
    ({ providerId, modelId }) =>
      controller
        .setDefault(providerId, modelId)
        .catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigGetDefaultsContract,
    isTrustedSender,
    () => controller.defaults().catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigListRemoteContract,
    isTrustedSender,
    ({ baseUrl, api, apiKey }) => listRemoteModels({ baseUrl, api, apiKey }).catch((error: unknown) => {
      if (error instanceof RemoteModelListError) throw new MainProcessError(error.code, error.message)
      throw new MainProcessError('MODELS_LIST_UNREACHABLE', 'The endpoint could not be reached.')
    }),
  )
  registerValidatedHandler(
    modelsConfigBuiltinProvidersContract,
    isTrustedSender,
    () => controller.builtinProviders().catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigSetProviderKeyContract,
    isTrustedSender,
    ({ providerId, key }) => controller.setProviderKey(providerId, key).catch(mapModelsConfigError),
  )
  registerValidatedHandler(
    modelsConfigProviderCatalogContract,
    isTrustedSender,
    ({ providerId }) => controller.providerCatalog(providerId),
  )
  registerValidatedHandler(
    modelsConfigLookupCatalogContract,
    isTrustedSender,
    ({ baseUrl, ids }) => controller.lookupCatalog(baseUrl, ids),
  )
  registerValidatedHandler(
    modelsConfigTestContract,
    isTrustedSender,
    ({ content, providerId, modelId }) =>
      controller
        .test(content, providerId, modelId)
        .catch(mapModelsConfigError),
  )
}
