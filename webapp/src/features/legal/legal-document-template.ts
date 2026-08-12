export type PublicLegalOperator = {
  name: string
  recipient: string
  address: string
}

const placeholders: Record<string, keyof PublicLegalOperator> = {
  LEGAL_OPERATOR_NAME: 'name',
  LEGAL_OPERATOR_RECIPIENT: 'recipient',
  LEGAL_OPERATOR_ADDRESS: 'address',
}

export function applyLegalDocumentTemplate(markdown: string, operator: PublicLegalOperator) {
  return markdown.replaceAll(/\{\{([A-Z_]+)\}\}/g, (placeholder, name: string) => {
    const field = placeholders[name]
    if (!field) throw new Error(`Unknown legal document placeholder: ${placeholder}`)
    return operator[field]
  })
}

export function publicLegalOperatorFromBuildEnvironment(): PublicLegalOperator {
  return {
    name: import.meta.env.VITE_PUBLIC_LEGAL_OPERATOR_NAME ?? '',
    recipient: import.meta.env.VITE_PUBLIC_LEGAL_OPERATOR_RECIPIENT ?? '',
    address: import.meta.env.VITE_PUBLIC_LEGAL_OPERATOR_ADDRESS ?? '',
  }
}
