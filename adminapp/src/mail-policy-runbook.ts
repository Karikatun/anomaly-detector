const mailProtectionAlertRunbookPath = 'docs/YANDEX_CLOUD.md#mail-protection-alert-recovery'

export function resolveMailProtectionAlertRunbookUrl(buildSha: string | undefined) {
  return /^[a-f0-9]{40}$/.test(buildSha ?? '')
    ? `https://github.com/Karikatun/anomaly-detector/blob/${buildSha}/${mailProtectionAlertRunbookPath}`
    : null
}

export { mailProtectionAlertRunbookPath }
