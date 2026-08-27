import type { BrowserWindow } from 'electron'
import {
  modelsConfigGetDefaultsContract,
  modelsConfigLoadContract,
  modelsConfigSaveAndRestartContract,
  modelsConfigSaveContract,
  modelsConfigSetDefaultContract,
  modelsConfigTestContract,
} from '../../shared/ipc/contracts'
import {
  ModelsConfigError,
  type ModelsConfigController,
} from '../models-config/models-config-service'
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
    modelsConfigTestContract,
    isTrustedSender,
    ({ content, providerId, modelId }) =>
      controller
        .test(content, providerId, modelId)
        .catch(mapModelsConfigError),
  )
}
