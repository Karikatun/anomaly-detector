export type PublicLegalDocumentTemplateValues = {
  address: string
  effectiveDate: string
  name: string
  recipient: string
}

const placeholders: Record<string, keyof PublicLegalDocumentTemplateValues> = {
  LEGAL_OPERATOR_NAME: 'name',
  LEGAL_OPERATOR_RECIPIENT: 'recipient',
  LEGAL_OPERATOR_ADDRESS: 'address',
  LEGAL_DOCUMENTS_EFFECTIVE_DATE: 'effectiveDate',
}

export function applyLegalDocumentTemplate(
  markdown: string,
  values: PublicLegalDocumentTemplateValues,
) {
  return markdown.replaceAll(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => {
    const field = placeholders[name]
    if (!field) throw new Error(`Unknown legal document placeholder: ${placeholder}`)
    return values[field]
  })
}

export function publicLegalDocumentTemplateValuesFromBuildEnvironment(): PublicLegalDocumentTemplateValues {
  return {
    address: import.meta.env.VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS ?? '',
    effectiveDate: import.meta.env.VITE_PUBLIC_LEGAL_DOCUMENTS_EFFECTIVE_DATE ?? '',
    name: import.meta.env.VITE_PUBLIC_LEGAL_OPERATOR_NAME ?? '',
    recipient: import.meta.env.VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT ?? '',
  }
}
