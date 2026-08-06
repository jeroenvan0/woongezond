# Firmware provisioning — one image, per-device identity, self-service Wi-Fi

**Status: design only, written 2026-08-05, before the hardware arrived.** Nothing here is
implemented. Hardware expected ~2026-08-06. Everything marked ⚠️ is an assumption to
confirm against the real firmware and boards.

Companion to [milestone-2-device-trust-design.md](milestone-2-device-trust-design.md) —
that doc decides *how a device authenticates*; this one decides *how that credential and
the household's Wi-Fi get onto the device* without it becoming a per-unit hand-build.

## The requirement

From Jeroen, 2026-08-05:

> The firmware must be different per device, since the number is different and the wifi
> passwords etc are different. But I want the user to be able to install it easily.

Two variables, and they are **not** the same kind of variable — which is the whole design:

| Variable | Known when? | By whom? |
|---|---|---|
| Device number / identity / credential | At the bench, before shipping | Jeroen |
| Wi-Fi SSID + password | Only in the resident's home | The resident |

Wi-Fi therefore *cannot* be baked in at flash time, and device identity *shouldn't* be
compiled in. Which leads to the core recommendation:

## Recommendation: build one firmware image. Never recompile per device.

The instinct — "each device is different, so build each device its own firmware" — is the
expensive path, and it's worth being explicit about why it should be rejected:

- A 10-minute compile × 10 devices, repeated on every firmware change, forever.
- Ten binaries that are each individually untested; you validate one build and ship a
  different one.
- No way to answer "what firmware is device 7 running?" — the version is per-unit.
- OTA updates become ten separate artefacts.
- A typo'd Wi-Fi password means a **recompile and a physical reflash**, in someone's home.

Instead: **one binary, identical on all devices**, and per-device data supplied as *data*.
On ESP32 that means the NVS (non-volatile storage) partition ⚠️.

```
┌─────────────────── flash layout ───────────────────┐
│ bootloader │ partition table │  app (identical)    │
│                              │  ← one build, all   │
│                              │    devices, OTA-able│
├────────────────────────────────────────────────────┤
│ nvs   ← per-device: device_id, token, serial no.   │
│         written at the bench, 2 seconds            │
├────────────────────────────────────────────────────┤
│ nvs   ← Wi-Fi creds, written by the resident       │
│         at first boot via captive portal           │
└────────────────────────────────────────────────────┘
```

Identity is written with `nvs_partition_gen.py` + `esptool.py write_flash` at a fixed
offset — no toolchain, no compile, ~2 seconds per unit ⚠️.

## Bench flow (Jeroen, once per device, target < 60 s)

A single script, `scripts/provision-device.mjs` (to be written), does end-to-end:

```bash
npm run provision -- --number 7 --label "Woning 7 — slaapkamer"
```

1. **Mint the credential.** Calls the M2 admin enrollment endpoint, which creates the
   `devices` row and returns a `wg_dev_…` bearer token *once*. The token is never stored
   in plaintext server-side (hash only, per the M2 design).
2. **Generate the NVS blob** containing `device_id`, `device_token`, `device_number`, and
   the ingest base URL.
3. **Flash** the shared app image (only if the board is blank or out of date) plus the
   NVS blob.
4. **Verify** — reboot the board, watch serial for `provisioned ok`, and confirm
   server-side that the device can authenticate (a `POST /api/ingest` dry-run that
   validates the token without inserting a reading).
5. **Print the sticker** — device number, a QR code, and a support URL. See below.

If step 4 fails, nothing has shipped. That is the point of doing it at the bench.

**Idempotence matters**: re-running for the same `--number` must rotate the token rather
than create a second device row, or a reflash silently orphans readings.

## Resident flow (target: three steps, no app, no cable)

1. Plug the device in. It finds no Wi-Fi credentials in NVS and starts a **SoftAP
   captive portal** named `Woongezond-0007` ⚠️.
2. The resident connects their phone to that network. The captive portal opens by itself
   (iOS and Android both auto-open on a captive-portal probe failure). They pick their
   home network from a scanned list and type the password.
3. The device stores the credentials in NVS, reboots into station mode, and posts its
   first reading. The LED goes solid green ⚠️; the dashboard shows the device as online.

This is the standard `WiFiManager` / ESP-IDF `wifi_provisioning` pattern ⚠️ — worth using
the library rather than hand-rolling it, because the fiddly parts (captive-portal DNS
hijack, iOS's probe URL, WPA2-Enterprise refusal, 2.4 GHz-only discovery) are already
solved there.

**The QR code on the sticker should encode the SoftAP join**, not a URL:
`WIFI:S:Woongezond-0007;T:WPA;P:<ap-password>;;` — scanning it with the stock camera app
joins the setup network directly, removing the most error-prone step. This is a different
QR code from the *claim* QR in the M2 design; if both exist, put only one on the device
and let the portal chain to the other, or residents will scan the wrong one.

### The failure modes to design for now, not after 10 support calls

| Failure | Design response |
|---|---|
| Wrong Wi-Fi password | Portal must **verify the association before storing** and say "wrong password", not reboot into a silent retry loop |
| 5 GHz-only network | Detect and say so explicitly — ESP32 is 2.4 GHz only ⚠️ and this will happen with modern ISP routers |
| Resident moves house / changes router | Long press (10 s) clears Wi-Fi NVS *only*, never the identity NVS — otherwise the device is bricked to its owner |
| Router down at 3am | Exponential backoff + **buffer readings in RAM/flash and replay on reconnect** (see M2 design §6 Q4 — this decides whether `/api/ingest` accepts an array) |
| Device never phones home after setup | Server-side liveness alerting (M3) — currently a device can be dead for 2½ months unnoticed, see [known-issues.md](known-issues.md#ki-3) |

## Why this ordering is safe

The bench flow depends on the M2 admin enrollment endpoint existing, and the resident
flow depends on `/api/ingest` existing. **Neither is built yet** — so the sequencing is:

1. M2 lands (`/api/ingest`, `devices` credential columns, admin enrollment).
2. `scripts/provision-device.mjs` is written against it.
3. First device is provisioned end-to-end **with someone watching the serial console**.
4. Only then the remaining nine, in a batch.

Do not provision ten devices before one has completed a full round trip.

## Open questions — need the hardware / firmware

Additional to the five in [milestone-2-device-trust-design.md §6](milestone-2-device-trust-design.md):

1. **Board + framework.** ESP32-S3 assumed from the M2 doc and the "Feather S3" device
   row. Arduino or ESP-IDF? That decides `WiFiManager` vs `wifi_provisioning`.
2. **Is there a partition table with a second NVS?** If the current firmware uses a
   single default NVS for everything, separating identity from Wi-Fi credentials (so the
   reset button can clear one and not the other) needs a partition-table change — which
   *is* a reflash, best done before the units ship.
3. **Is there a factory-reset button, and an LED?** The resident flow above assumes both.
   If not, the portal needs another escape hatch.
4. **OTA today: present or absent?** If absent, adding it before shipping ten units is
   worth far more than it costs — otherwise every future fix is ten house visits.
5. **Secure boot / flash encryption?** If enabled, the NVS-blob approach needs the
   encrypted-NVS variant and the bench script changes shape.
