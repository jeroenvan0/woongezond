// WiFi-provisioning adapter — DELIBERATE STUB.
//
// The web app cannot put an ESP sensor on WiFi without firmware cooperation. This module
// is the single seam where that firmware contract plugs in; the provisioning UI already
// calls it. It does NOT fake a connection — until the firmware ships one of the two
// endpoints below, `provisionWifi` returns { status: 'unsupported' } and the UI shows the
// manual fallback. See docs/device-provisioning-design.md ("WiFi-provisioning").
//
// Firmware contract — pick ONE and implement it here:
//   1. SoftAP + captive HTTP: device serves POST http://192.168.4.1/provision
//      { ssid, password } while the phone is joined to its "Woongezond-XXXX" AP.
//   2. BLE (WebBluetooth): device advertises a GATT service; write ssid+password to a
//      characteristic. The QR/claim payload can carry the BLE pairing secret.

export interface WifiCredentials {
  ssid: string
  password: string
}

export type WifiProvisionResult =
  | { status: 'ok' }
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; reason: string }

/**
 * Attempt to hand WiFi credentials to a nearby sensor. Stub: returns 'unsupported' until
 * the firmware endpoint exists. Kept async + typed so wiring the real transport later is a
 * one-function change with no UI churn.
 */
export async function provisionWifi(_creds: WifiCredentials): Promise<WifiProvisionResult> {
  // TODO(firmware): implement SoftAP POST or WebBluetooth GATT write per the contract above.
  return {
    status: 'unsupported',
    reason: 'WiFi-provisioning wacht op firmware. Verbind de sensor voorlopig handmatig met het netwerk.',
  }
}

/** Whether this browser could support the BLE path, for progressive enhancement in the UI. */
export function bleAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator
}
