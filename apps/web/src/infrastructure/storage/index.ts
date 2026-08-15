export {
  CURRENT_IDENTITY_MARKER,
  loadCurrentIdentity,
  clearCurrentIdentity,
  deleteIdentity,
  loadCachedResource,
  loadCachedResources,
  markIdentityEnrolled,
  prepareIdentity,
  saveCachedResource,
  setCurrentIdentity,
} from "./deviceStore"
export type { CachedResource, DeviceIdentity } from "./deviceStore"
export { currentDeviceName, deviceName } from "./deviceName"
export type { DeviceHints } from "./deviceName"
